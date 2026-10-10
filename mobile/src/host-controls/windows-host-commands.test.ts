import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { MAC_HOST_COMMAND_DONE_PATTERN, MAC_HOST_REFUSAL_REASONS, readMacHostRefusal } from './mac-host-commands'
import { WINDOWS_HOST_COMMAND_TIMEOUT_MS } from './run-mac-host-command'
import {
  COMPRESSED_WINDOWS_ACTIONS,
  DIM_WAIT_MS,
  PACKED_BYTE_BASE,
  WINDOWS_AUDIO_TYPE,
  WINDOWS_DIM_PROGRESS,
  WINDOWS_HOST_ACTION_LABELS,
  WINDOWS_HOST_ACTION_PROGRESS,
  buildWindowsHostCommand,
  readWindowsDimReport,
  windowsDimDoneToast,
  windowsHostActionProgress,
  windowsHostScript,
  type WindowsHostAction
} from './windows-host-commands'
import {
  DIM_READY_SEMAPHORE,
  DISPLAY_WAKE_EVENT,
  KEEPER_MUTEX,
  WINDOWS_DISPLAY_COVER_MEMBERS,
  WINDOWS_DISPLAY_COVER_STATEMENT,
  WINDOWS_DISPLAY_DIM_KEEPER_MEMBERS,
  WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT,
  WINDOWS_DISPLAY_KEEPER_TYPE,
  WINDOWS_DISPLAY_LIFT_SCRIPT,
  WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS
} from './windows-display-dim-keeper'
import {
  WINDOWS_DISPLAY_NAMESPACE,
  WINDOWS_DISPLAY_TYPE,
  WINDOWS_HOST_STATE_PROBE_COMMAND,
  WINDOWS_HOST_STATE_SCRIPT,
  parseWindowsHostState,
  readWindowsHostStateMarker,
  windowsHostStateScript
} from './windows-host-state'

const ACTIONS = Object.keys(WINDOWS_HOST_ACTION_LABELS) as WindowsHostAction[]

function decode(command: string): string {
  const encoded = command.split(' ').at(-1)!
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

const INFLATER = /^iex\(\[IO\.StreamReader\]::new\(\[IO\.Compression\.DeflateStream\]::new\(\[IO\.MemoryStream\]\[byte\[\]\]\('([^']*)'\.ToCharArray\(\)\|%\{\$_-256\}\),\[IO\.Compression\.CompressionMode\]0\)\)\.ReadToEnd\(\)\)$/

/** The script a command makes the PC run: decoded, and inflated when it ships deflated. */
function sent(command: string): string {
  const decoded = decode(command)
  const packed = INFLATER.exec(decoded)?.[1]
  if (packed === undefined) {
    return decoded
  }
  const bytes = Buffer.from([...packed].map((char) => char.charCodeAt(0) - PACKED_BYTE_BASE))
  return inflateRawSync(bytes).toString('utf8')
}

describe('the Windows host commands', () => {
  it('offers the Mac set without Unlock, which Windows only takes at the PC', () => {
    expect(ACTIONS.sort()).toEqual(['lock', 'mute', 'sleep-display', 'unmute', 'wake-display'])
  })

  it.each(ACTIONS)('sends %s as one quote-free encoded PowerShell call, whatever shell the PC runs', (action) => {
    const command = buildWindowsHostCommand(action)
    // -nop, -noni, -enc: -NoProfile, -NonInteractive, -EncodedCommand (for cmd.exe's 8,191).
    expect(command).toMatch(/^powershell -nop -noni -enc [A-Za-z0-9+/=]+$/)
    expect(sent(command)).toBe(windowsHostScript(action))
  })

  // 2026-10-10: the keeper, the covers and DDC/CI took Sleep display past cmd.exe's
  // 8,191. It ships deflated, inflated in memory on the PC: nothing on its disk.
  it('ships Sleep display and Wake display deflated, and the PC inflates exactly the script', () => {
    expect([...COMPRESSED_WINDOWS_ACTIONS].sort()).toEqual(['sleep-display', 'wake-display'])
    for (const action of ACTIONS) {
      const decoded = decode(buildWindowsHostCommand(action))
      expect(INFLATER.test(decoded)).toBe(COMPRESSED_WINDOWS_ACTIONS.includes(action))
      expect(sent(buildWindowsHostCommand(action))).toBe(windowsHostScript(action))
    }
    // One character per byte, U+0100..U+01FF: no quote can end the literal early.
    const packed = INFLATER.exec(decode(buildWindowsHostCommand('sleep-display')))?.[1] ?? ''
    expect(packed.length).toBeGreaterThan(0)
    for (const char of packed) {
      expect(char.charCodeAt(0)).toBeGreaterThanOrEqual(0x100)
      expect(char.charCodeAt(0)).toBeLessThanOrEqual(0x1ff)
    }
    expect(PACKED_BYTE_BASE).toBe(256)
  })

  it.each(ACTIONS)('never paints the done marker with the command line itself (%s)', (action) => {
    // The shell echoes the command it runs; only the script's output may match.
    expect(MAC_HOST_COMMAND_DONE_PATTERN.test(buildWindowsHostCommand(action))).toBe(false)
    expect(MAC_HOST_COMMAND_DONE_PATTERN.test(windowsHostScript(action))).toBe(false)
  })

  it.each(ACTIONS)('stops on the first failure, so a refusal cannot print the done marker (%s)', (action) => {
    const script = windowsHostScript(action)
    expect(script.startsWith("$ErrorActionPreference='Stop'")).toBe(true)
    expect(script.split('\n').at(-1)).toBe(`'CUIDONE '+'ok'`)
  })

  it('asks the APIs that own each answer', () => {
    expect(windowsHostScript('lock')).toContain('LockWorkStation')
    expect(windowsHostScript('sleep-display')).toContain('[IntPtr]0xF170,[IntPtr]2')
    expect(windowsHostScript('wake-display')).toContain('[IntPtr]0xF170,[IntPtr](-1)')
    expect(windowsHostScript('wake-display')).toContain('SetThreadExecutionState(2)')
    expect(windowsHostScript('mute')).toContain('SetMute($true)')
    expect(windowsHostScript('unmute')).toContain('SetMute($false)')
  })

  // 2026-10-08 and 0.9.122: on a Modern Standby PC (AoAc, byte 20) a display turned
  // off starts standby. 2026-10-10, the user: dim every screen and cover it with
  // black instead; the display never turns off, so standby never starts.
  describe('Sleep display on a PC with Modern Standby', () => {
    const script = windowsHostScript('sleep-display')
    const ask = script.indexOf('GetPwrCapabilities($c)')
    // The branch ends at its last refusal; an earlier `exit}` refuses a busy semaphore.
    const branchEnd = script.indexOf("'USED keepawake'};exit}", ask) + "'USED keepawake'}".length
    const branch = script.slice(ask, branchEnd)
    // The keeper's own text rides inside the branch as a literal; what the branch
    // itself runs is the rest.
    const keeper = /\$env:CUIK='((?:[^']|'')*)'/.exec(branch)?.[1] ?? ''
    const outer = branch.replace(keeper, '')

    it('asks whether the PC has Modern Standby first, and keeps the classic post unchanged for every other PC', () => {
      expect(ask).toBeGreaterThan(-1)
      expect(script).toContain('$c[20]')
      expect(branchEnd).toBeGreaterThan(ask)
      // The classic path: the same post, line for line, as before 2026-10-10.
      expect(script.split('\n').at(-2)).toBe(
        "if(-not [CodeUI.Display]::PostMessage([IntPtr]0xFFFF,0x0112,[IntPtr]0xF170,[IntPtr]2)){throw 'PostMessage refused'}"
      )
      expect(script.indexOf('[IntPtr]0xF170,[IntPtr]2')).toBeGreaterThan(branchEnd)
    })

    it('never turns a display off on that PC: no post, no display timeout', () => {
      expect(keeper.length).toBeGreaterThan(0)
      for (const text of [outer, keeper]) {
        expect(text).not.toContain('0xF170')
        expect(text).not.toContain('PostMessage')
        expect(text).not.toMatch(/ValueIndex|ActiveScheme|powercfg|3c0bc021/i)
      }
    })

    // Review, 2026-10-10: Start-Process without redirection goes through
    // ShellExecuteEx, whose parameters Microsoft limits to about 2,048 characters,
    // and the keeper as -EncodedCommand was 13,000. It rides in an environment
    // variable the hidden child inherits (32,767 at most), never on disk.
    it('starts the dim keeper hidden and detached, handing it over in its environment', () => {
      expect(branch).toContain(`$env:CUIK='`)
      expect(branch).toContain("start powershell -Win Hidden -Args '-nop','-noni','-c','iex $env:CUIK'")
      expect(branch).not.toContain('-enc')
      expect(script).not.toMatch(/[A-Za-z0-9+/]{120,}/)
      expect(keeper.replace(/''/g, "'")).toBe(WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT)
      expect(WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT.length).toBeLessThan(32_767)
    })

    // The keeper releases 1 + 2 x dimmed + covered; the wait takes one and Release
    // hands back the rest.
    it('prints done with what was dimmed and covered, refuses when nothing was, and puts everything back when the keeper is silent', () => {
      // Review, 2026-10-10: only a semaphore this run created is its own answer.
      const ready = outer.indexOf(`$n=$false;$r=[Threading.Semaphore]::new(0,99,'${DIM_READY_SEMAPHORE}',[ref]$n);if(!$n){'CUIREF'+'USED keepawake';exit}`)
      const start = outer.indexOf('start powershell')
      const wait = outer.indexOf(`if($r.WaitOne(${DIM_WAIT_MS})){$t=$r.Release();`)
      const report = outer.indexOf(`if($t){'CUIDIM'+"MED $(($t-$t%2)/2) covered=$($t%2)";'CUIDONE '+'ok'}`)
      const none = outer.indexOf(`else{'CUIREF'+'USED nodim'}`)
      const silent = outer.indexOf(
        // Review, 2026-10-10: closed first, so a keeper that has not opened it yet
        // never can, and one that has sees the wake event set after its reset.
        `else{$r.Close();$w=$null;if([Threading.EventWaitHandle]::TryOpenExisting('${DISPLAY_WAKE_EVENT}',[ref]$w)){[void]$w.Set()};'CUIREF'+'USED keepawake'}`
      )
      expect(ready).toBeGreaterThan(-1)
      expect(start).toBeGreaterThan(ready)
      expect(wait).toBeGreaterThan(start)
      expect(report).toBeGreaterThan(wait)
      expect(none).toBeGreaterThan(report)
      expect(silent).toBeGreaterThan(none)
      expect(DIM_WAIT_MS).toBeLessThanOrEqual(WINDOWS_HOST_COMMAND_TIMEOUT_MS - 3_000)
      expect(readMacHostRefusal(script.split('\n'))).toBeNull()
      expect(readMacHostRefusal(['CUIREFUSED nodim'])).toBe('nodim')
      expect(MAC_HOST_REFUSAL_REASONS.nodim).toBe("This PC's displays can't be dimmed from here, so nothing was changed.")
      expect(readMacHostRefusal(['CUIREFUSED keepawake'])).toBe('keepawake')
      expect(readWindowsDimReport(script.split('\n'))).toBeNull()
    })

    it('words the progress and the toast for what it did', () => {
      expect(windowsHostActionProgress('sleep-display', true)).toBe(WINDOWS_DIM_PROGRESS)
      expect(WINDOWS_DIM_PROGRESS).toBe('Dimming the displays…')
      expect(windowsHostActionProgress('sleep-display', false)).toBe(WINDOWS_HOST_ACTION_PROGRESS['sleep-display'])
      expect(windowsHostActionProgress('mute', true)).toBe(WINDOWS_HOST_ACTION_PROGRESS.mute)
      expect(readWindowsDimReport(['CUIDIMMED 2 covered=1'])).toEqual({ dimmed: 2, covered: true })
      expect(readWindowsDimReport(['CUIDIMMED 0 covered=1'])).toEqual({ dimmed: 0, covered: true })
      expect(readWindowsDimReport(['CUIDIMMED 1 covered=0'])).toEqual({ dimmed: 1, covered: false })
      expect(readWindowsDimReport(['CUIDIMMED 1'])).toBeNull()
      expect(readWindowsDimReport([])).toBeNull()
      expect(windowsDimDoneToast({ dimmed: 0, covered: true })).toBe(
        'Screens off. Tap Wake display or touch the PC to turn them back on.'
      )
      expect(windowsDimDoneToast({ dimmed: 1, covered: false })).toBe(
        '1 display dimmed. Tap Wake display or touch the PC to restore.'
      )
      expect(windowsDimDoneToast({ dimmed: 2, covered: false })).toBe(
        '2 displays dimmed. Tap Wake display or touch the PC to restore.'
      )
    })
  })

  // 2026-10-10: "suddenly we open the sheet and do wake display too". A keeper still
  // waiting for the off notification must end at once, not hold the PC for 12 h.
  // The display goes on FIRST and the keeper is told after (review, 2026-10-10):
  // the other order left a moment with the display off and no request held, which
  // on a Modern Standby laptop is the moment it can slip into standby.
  it('turns the display on, then tells a waiting keeper to stop', () => {
    const script = windowsHostScript('wake-display')
    const signal = script.indexOf(`[Threading.EventWaitHandle]::TryOpenExisting('${DISPLAY_WAKE_EVENT}',[ref]$w)`)
    const set = script.indexOf('$w.Set()')
    const on = script.indexOf('[IntPtr]0xF170,[IntPtr](-1)')
    expect(on).toBeGreaterThan(-1)
    expect(signal).toBeGreaterThan(on)
    expect(set).toBeGreaterThan(signal)
  })

  // 2026-10-10: a keeper that died between writing the 1-second display timeout and
  // restoring it leaves a PC whose display goes off a second after every touch. Wake
  // display repairs that on every PC, before it lets a running keeper go, so the
  // keeper's own restore of the originals comes last.
  it('puts a display timeout a dead keeper left at 1 second back, before it tells the keeper to stop', () => {
    const script = windowsHostScript('wake-display')
    expect(script).toContain(WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS)
    const on = script.indexOf('[IntPtr]0xF170,[IntPtr](-1)')
    const unstick = script.indexOf('[CodeUI.Fix]::Unstick()')
    const signal = script.indexOf('TryOpenExisting(')
    expect(unstick).toBeGreaterThan(on)
    expect(signal).toBeGreaterThan(unstick)
    // Its own compile, and one that may fail: the repair leans on the using-alias
    // trick (USING_ALIASES), unproven under 5.1, and must never take Wake down with it.
    const line = script.split('\n').find((l) => l.includes('Unstick()')) ?? ''
    expect(line.startsWith('try{Add-Type -IgnoreWarnings -Namespace CodeUI -Name Fix ')).toBe(true)
    expect(line.endsWith('[CodeUI.Fix]::Unstick()}catch{}')).toBe(true)
    expect(script.split('\n').find((l) => l.includes('-Name Wake '))).not.toContain('UsingNamespace')
  })

  // 2026-10-10: a keeper killed mid-hold leaves its displays at 0. With no keeper
  // to tell, Wake display on a Modern Standby PC lifts a display at 0 to 70%; a
  // classic PC never dims, so its 0 is the user's own.
  it('lifts displays left at 0 only on a Modern Standby PC with no keeper to put them back', () => {
    const script = windowsHostScript('wake-display')
    const keeper = script.indexOf(`TryOpenExisting('${DISPLAY_WAKE_EVENT}',[ref]$w)){[void]$w.Set()}else{`)
    const modern = script.indexOf('$c=New-Object byte[] 128;if([CodeUI.Wake]::GetPwrCapabilities($c) -and $c[20]){', keeper)
    const lift = script.indexOf(WINDOWS_DISPLAY_LIFT_SCRIPT, modern)
    expect(keeper).toBeGreaterThan(script.indexOf('[CodeUI.Fix]::Unstick()'))
    expect(modern).toBeGreaterThan(keeper)
    expect(lift).toBeGreaterThan(modern)
  })

  // Since 2026-10-10 the power plan is touched only by Wake display's repair of a
  // 1-second timeout 0.9.126 may have left. Nothing reads powercfg's text.
  it("touches the power plan only in Wake display's repair", () => {
    for (const action of ['lock', 'mute', 'unmute', 'sleep-display'] as const) {
      expect(windowsHostScript(action)).not.toMatch(/ActiveScheme|ValueIndex|powercfg|3c0bc021/i)
    }
    const wake = windowsHostScript('wake-display').replace(WINDOWS_VIDEO_IDLE_UNSTICK_MEMBERS, '')
    expect(wake).not.toMatch(/ActiveScheme|ValueIndex|powercfg|3c0bc021/i)
  })

  it("keeps Sleep display under cmd.exe's 8,191 characters with the keeper and the covers inside it", () => {
    expect(buildWindowsHostCommand('sleep-display').length).toBeLessThan(8191)
  })

  // 2026-09-24 review: adding the display read took the probe to 8,438
  // characters. cmd.exe refuses a line past 8,191 (Microsoft KB830473), and
  // Orca offers cmd as a Windows shell, so a cmd user's probe would print no
  // marker and lose lock and mute along with the display.
  it("fits cmd.exe's 8,191-character command line, so a PC whose terminal is cmd still answers", () => {
    const CMD_EXE_MAX = 8191
    for (const command of [WINDOWS_HOST_STATE_PROBE_COMMAND, ...ACTIONS.map(buildWindowsHostCommand)]) {
      expect(command.length).toBeLessThanOrEqual(CMD_EXE_MAX)
    }
  })

  it('keeps the C# inside a single-quoted PowerShell string', () => {
    expect(WINDOWS_AUDIO_TYPE).not.toContain("'")
    expect(WINDOWS_DISPLAY_TYPE).not.toContain("'")
    expect(WINDOWS_DISPLAY_DIM_KEEPER_MEMBERS).not.toContain("'")
    expect(WINDOWS_DISPLAY_COVER_MEMBERS).not.toContain("'")
  })
})

describe('what the Windows probe spends its time on', () => {
  const statements = WINDOWS_HOST_STATE_SCRIPT.split('\n')

  // 2026-09-26: the sheet offers Lock PC whatever the PC says, so the LogonUI read
  // decided no row and only held up the display and mute rows behind it.
  it('never asks whether the PC is locked', () => {
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toContain('LogonUI')
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toContain('lock=')
  })

  // Every Add-Type in Windows PowerShell 5.1 starts csc.exe. The probe used to start
  // it twice, once per type, on every open of the sheet.
  it('compiles Core Audio and the display type in one Add-Type, and each alone only when that one fails', () => {
    const compiles = statements.filter((line) => line.includes('Add-Type'))
    expect(compiles).toHaveLength(1)
    expect(compiles[0]?.startsWith('try{Add-Type -Ig -TypeDefinition ($u+$a+$p)}catch{')).toBe(true)
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain(`$a='${WINDOWS_AUDIO_TYPE}'`)
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain(`$p='${WINDOWS_DISPLAY_NAMESPACE}'`)
  })

  // Add-Type fails a unit its compiler only warns about, and none of this C# has met
  // Windows PowerShell 5.1's compiler. A warning there must not cost a read or an action.
  // Sleep display and its keeper write it as -Ig, its unambiguous prefix (2026-10-10,
  // for cmd.exe's 8,191: no other Add-Type parameter or common parameter starts so).
  it('lets every compile the phone sends through its warnings', () => {
    const scripts = [WINDOWS_HOST_STATE_SCRIPT, ...ACTIONS.map(windowsHostScript), WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT]
    const compiles = scripts.flatMap((script) => script.match(/Add-Type(?: -[A-Za-z]+)*/g) ?? [])
    expect(compiles.length).toBeGreaterThanOrEqual(ACTIONS.length + 4)
    for (const compile of compiles) {
      expect(compile).toMatch(/ -Ig(noreWarnings)?( |$)/)
    }
  })

  it('reads mute and display each on their own, so one failing leaves the other', () => {
    expect(statements).toContain("try{$m=if([CodeUI.Audio]::GetMute()){'true'}else{'false'}}catch{}")
    expect(
      statements.some((line) => line.startsWith('try{$d=') && line.includes('[CodeUI.DisplayPower]::Read(1000)'))
    ).toBe(true)
  })
})

describe('reading what a Windows PC says about itself', () => {
  it('reads a muted PC whose display is on, and leaves its lock unknown', () => {
    expect(parseWindowsHostState(['CUIWIN mute=true display=on standby=classic'])).toEqual({
      lock: 'unknown',
      display: 'on',
      mute: 'muted'
    })
  })

  // 2026-09-23, from the phone: both Sleep display and Wake display showed on
  // a PC whose display was on, because the probe never asked.
  it('reads the display as on, off, or dimmed (which is on), and unknown when Windows would not say', () => {
    const display = (value: string) => parseWindowsHostState([`CUIWIN mute=false display=${value} standby=classic`]).display
    expect(display('on')).toBe('on')
    expect(display('off')).toBe('off')
    expect(display('dimmed')).toBe('on')
    expect(display('unknown')).toBe('unknown')
  })

  it('asks the power setting that owns the answer: the console display state', () => {
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain('6FE69556-704A-47A0-8F24-C28D936FDA47')
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain('PowerSettingRegisterNotification')
  })

  // 2026-10-08, Danny: Sleep display slept his whole laptop. The probe asks whether
  // the PC has Modern Standby, where the display going off starts standby.
  it('reads a PC that goes to sleep with its display (Modern Standby), and only that one', () => {
    expect(parseWindowsHostState(['CUIWIN mute=false display=on standby=modern'])).toEqual({
      lock: 'unknown',
      display: 'on',
      mute: 'unmuted',
      sleepsWithDisplay: true
    })
    expect(parseWindowsHostState(['CUIWIN mute=false display=on standby=classic'])).not.toHaveProperty(
      'sleepsWithDisplay'
    )
    expect(parseWindowsHostState(['CUIWIN mute=false display=on standby=unknown'])).not.toHaveProperty(
      'sleepsWithDisplay'
    )
  })

  it('asks the power capability that owns the answer: AoAc, byte 20 of SYSTEM_POWER_CAPABILITIES', () => {
    expect(WINDOWS_DISPLAY_NAMESPACE).toContain('GetPwrCapabilities(b)')
    expect(WINDOWS_DISPLAY_NAMESPACE).toContain('b[20]')
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain('[CodeUI.DisplayPower]::AoAc()')
  })

  it('does not take a marker whose standby field has not painted yet for an answer', () => {
    expect(readWindowsHostStateMarker(['CUIWIN mute=true display=on'])).toBeNull()
    expect(readWindowsHostStateMarker(['CUIWIN mute=true display=on standby='])).toBeNull()
    expect(readWindowsHostStateMarker(['CUIWIN mute=true display=on standby=mod'])).toBeNull()
  })

  it('reads a PC whose output device would not say', () => {
    expect(parseWindowsHostState(['CUIWIN mute=unknown display=off standby=classic'])).toEqual({
      lock: 'unknown',
      display: 'off',
      mute: 'unknown'
    })
  })

  it('takes the last marker on the screen', () => {
    expect(
      parseWindowsHostState(['CUIWIN mute=true display=off standby=classic', 'PS C:\\>', 'CUIWIN mute=false display=on standby=classic'])
    ).toEqual({ lock: 'unknown', display: 'on', mute: 'unmuted' })
  })

  it('answers nothing when nothing was painted, and for an empty screen', () => {
    expect(readWindowsHostStateMarker(['PS C:\\> powershell ...'])).toBeNull()
    expect(readWindowsHostStateMarker([])).toBeNull()
    expect(parseWindowsHostState([])).toEqual({ lock: 'unknown', display: 'unknown', mute: 'unknown' })
  })

  it('does not take a line that has not finished painting for an answer', () => {
    expect(readWindowsHostStateMarker(['CUIWIN mute=true'])).toBeNull()
    expect(readWindowsHostStateMarker(['CUIWIN mute=true display='])).toBeNull()
  })

  it('never matches its own command line', () => {
    expect(readWindowsHostStateMarker([WINDOWS_HOST_STATE_PROBE_COMMAND])).toBeNull()
    expect(readWindowsHostStateMarker(WINDOWS_HOST_STATE_SCRIPT.split('\n'))).toBeNull()
  })
})

// ─── Under a real PowerShell ───────────────────────────────────────────────
// PowerShell 7 runs on macOS and Linux, which is enough to parse every script,
// compile the C# each one declares, and run the probe end to end. Found through
// `CUIHUD_PWSH` or `pwsh` on PATH, as the HUD's tests find it; skipped, loudly,
// when neither exists. The Win32 and Core Audio calls themselves, and Windows
// PowerShell 5.1's older compiler, need a Windows machine and remain unrun.
describe('the Windows scripts under a real PowerShell', () => {
  const pwsh = (() => {
    const fromEnv = process.env.CUIHUD_PWSH
    if (fromEnv && existsSync(fromEnv)) {
      return fromEnv
    }
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (dir && existsSync(join(dir, 'pwsh'))) {
        return join(dir, 'pwsh')
      }
    }
    return null
  })()
  const run = (name: string, fn: () => void) => (pwsh ? it(name, fn, 60_000) : it.skip(name, fn))

  function powershell(script: string): string {
    const file = join(mkdtempSync(join(tmpdir(), 'cui-win-')), 'script.ps1')
    writeFileSync(file, script)
    return execFileSync(pwsh!, ['-NoProfile', '-NonInteractive', '-File', file], { encoding: 'utf8' })
  }

  run('parses every action script and the probe with no errors', () => {
    for (const script of [...ACTIONS.map(windowsHostScript), WINDOWS_HOST_STATE_SCRIPT]) {
      const errors = powershell(
        `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseInput(@'\n${script}\n'@,[ref]$null,[ref]$e);$e.Count`
      )
      expect(errors.trim()).toBe('0')
    }
  })

  run('compiles the Core Audio types and every Win32 declaration', () => {
    const declarations = ACTIONS.map(windowsHostScript)
      .flatMap((script) => script.split('\n'))
      .filter((line) => line.startsWith('Add-Type') && !line.includes("''"))
    const unique = [...new Set(declarations)]
    const out = powershell(`$ErrorActionPreference='Stop'\n${unique.join('\n')}\n'compiled'`)
    expect(out.trim()).toBe('compiled')
  })

  // The keeper runs on its own, from the base64 the sleep script builds on the PC,
  // so its text is parsed and its C# compiled here as well. Its calls (named
  // objects, the power request, WMI, DDC/CI) need Windows and are not run.
  run('parses the dim keeper and compiles its core type', () => {
    const errors = powershell(
      `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseInput(@'\n${WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT}\n'@,[ref]$null,[ref]$e);$e.Count`
    )
    expect(errors.trim()).toBe('0')
    const out = powershell(`$ErrorActionPreference='Stop'\n${WINDOWS_DISPLAY_KEEPER_TYPE}\n[bool]('CodeUI.Keeper' -as [type])`)
    expect(out.trim()).toBe('True')
  })

  run("compiles Wake display's brightness fallback", () => {
    const line = WINDOWS_DISPLAY_LIFT_SCRIPT.split('\n')[0]!
    const compile = line.slice('try{'.length, line.indexOf(';[CodeUI.Lift]::Run()'))
    const out = powershell(`$ErrorActionPreference='Stop'\n${compile}\n[bool]('CodeUI.Lift' -as [type])`)
    expect(out.trim()).toBe('True')
  })

  // The PC runs the inflater; this runs the same expression and writes what it
  // produced, so the PowerShell side of the packing is checked, not just Node's.
  run('inflates, in PowerShell, exactly the script each deflated command carries', () => {
    for (const action of COMPRESSED_WINDOWS_ACTIONS) {
      const dir = mkdtempSync(join(tmpdir(), 'cui-inflate-'))
      const out = join(dir, 'out.txt')
      const decoded = decode(buildWindowsHostCommand(action))
      expect(decoded.startsWith('iex(')).toBe(true)
      powershell(`[IO.File]::WriteAllText('${out}',${decoded.slice('iex('.length)}`)
      expect(readFileSync(out, 'utf8')).toBe(windowsHostScript(action))
    }
  })

  run('runs each deflated command end to end, and prints no done marker off Windows', () => {
    for (const action of COMPRESSED_WINDOWS_ACTIONS) {
      const encoded = buildWindowsHostCommand(action).split(' ').at(-1)!
      let out = ''
      try {
        out = execFileSync(pwsh!, ['-nop', '-noni', '-enc', encoded], { encoding: 'utf8' })
      } catch (error) {
        out = String((error as { stdout?: string }).stdout ?? '')
      }
      expect(MAC_HOST_COMMAND_DONE_PATTERN.test(out)).toBe(false)
    }
  })

  // ─── The keeper's PowerShell half, against stand-ins ─────────────────────
  // The core type is swapped for one that logs, and Get-WmiObject for a function
  // with one panel reading 55. Everything else is the keeper's own text.
  const STUB_KEEPER =
    "Add-Type -TypeDefinition 'namespace CodeUI{public static class Keeper{" +
    'public static System.Threading.EventWaitHandle w;public static System.Threading.Semaphore y;' +
    'public static string log="";public static bool allow=true,boom;' +
    'public static bool Begin(){log+="begin;";return allow;}public static int Dim(){log+="ddc;";return 1;}' +
    'public static void Hold(int n){log+="hold"+n+";";if(boom)throw new System.Exception("x");}' +
    "public static void Restore(){log+=\"restore;\";}}}'"
  const STUB_WMI = [
    "$global:wmi=''",
    'function Get-WmiObject{param($Namespace,$Class)',
    "if($Class -eq 'WmiMonitorBrightness'){[pscustomobject]@{InstanceName='P1';CurrentBrightness=55}}",
    "else{$o=[pscustomobject]@{InstanceName='P1'};$o|Add-Member ScriptMethod WmiSetBrightness {$global:wmi+=\"wmi$($args[1]);\"};$o}}"
  ].join('\n')
  function keeperWith(options: { cover?: string; setup?: string }): string {
    let script = WINDOWS_DISPLAY_DIM_KEEPER_SCRIPT.replace(WINDOWS_DISPLAY_KEEPER_TYPE, STUB_KEEPER)
    if (options.cover !== undefined) {
      script = script.replace(WINDOWS_DISPLAY_COVER_STATEMENT, options.cover)
    }
    script = script.replace(STUB_KEEPER, `${STUB_KEEPER}\n${options.setup ?? ''}`)
    return `${STUB_WMI}\n${script.replace("$ErrorActionPreference='Stop'\n", "$ErrorActionPreference='Stop'\n")}`
  }
  const REPORT_LOG = "\n'log='+[CodeUI.Keeper]::log+$global:wmi"

  run('covers, then puts the panel it dimmed back, and never holds dim-only once covered', () => {
    const out = powershell(
      keeperWith({ cover: '$c=$true;[CodeUI.Keeper]::log+="cover$n;"' }) + REPORT_LOG
    )
    expect(out.trim().split('\n').at(-1)).toBe('log=begin;ddc;cover2;restore;wmi0;wmi55;')
  })

  // On this machine WinForms does not exist, so the keeper's own cover statement
  // fails exactly as it would on a PC that refuses WinForms.
  run('dims only when WinForms will not load, and still puts every display back', () => {
    const out = powershell(keeperWith({}) + REPORT_LOG)
    expect(out.trim().split('\n').at(-1)).toBe('log=begin;ddc;hold2;restore;wmi0;wmi55;')
  })

  run('puts every display back when the hold throws', () => {
    let out = ''
    try {
      powershell(keeperWith({ setup: '[CodeUI.Keeper]::boom=$true' }) + REPORT_LOG)
    } catch (error) {
      out = String((error as { stdout?: string }).stdout ?? '')
    }
    // The throw ends the script after its finally; the finally ran.
    expect(out).not.toContain('log=')
    const logged = powershell(
      keeperWith({ setup: '[CodeUI.Keeper]::boom=$true' }).replace(
        "$ErrorActionPreference='Stop'",
        "$ErrorActionPreference='Stop'\ntrap{'log='+[CodeUI.Keeper]::log+$global:wmi;exit 0}"
      )
    )
    expect(logged.trim().split('\n').at(-1)).toBe('log=begin;ddc;hold2;restore;wmi0;wmi55;')
  })

  run('changes nothing when it cannot hold the display on and the PC awake', () => {
    const out = powershell(keeperWith({ setup: '[CodeUI.Keeper]::allow=$false' }) + REPORT_LOG)
    expect(out.trim().split('\n').at(-1)).toBe('log=begin;')
  })

  // ─── The covers, against WinForms stand-ins ──────────────────────────────
  // WinForms is Windows-only, so the cover compiles against a stand-in assembly with
  // the members it uses, built here into a temporary directory of the test machine.
  // Naming any reference makes PowerShell 7 drop its default set, so the framework
  // assemblies Windows PowerShell 5.1 always references (mscorlib there) are named too.
  // Application.Run is a loop that fires the started timers and calls Step(i), so a
  // test drives the covers' own timer code. The two Win32 imports become managed
  // fakes (input is GetLastInputInfo's tick); every other line is the cover's own.
  const WINFORMS_STAND_IN = [
    'using System;using System.Collections.Generic;using System.Drawing;',
    'namespace System.Windows.Forms{',
    'public enum FormBorderStyle{Sizable,None}public enum FormStartPosition{WindowsDefaultLocation,Manual}',
    'public class KeyEventArgs:EventArgs{}public delegate void KeyEventHandler(object s,KeyEventArgs e);',
    'public class MouseEventArgs:EventArgs{}public delegate void MouseEventHandler(object s,MouseEventArgs e);',
    'public class Form{public static List<Form> All=new List<Form>();public static bool FailShow;',
    'public Color BackColor;public FormBorderStyle FormBorderStyle=FormBorderStyle.Sizable;public bool TopMost,ShowInTaskbar=true,KeyPreview,Shown,Closed;',
    'public FormStartPosition StartPosition;public Rectangle Bounds;',
    'public event KeyEventHandler KeyDown;public event MouseEventHandler MouseDown,MouseMove;',
    'public void Show(){if(FailShow)throw new InvalidOperationException("no desktop");Shown=true;All.Add(this);}',
    'public void Close(){Closed=true;}public void Activate(){}',
    'public void Key(){KeyDown(this,new KeyEventArgs());}public void Click(){MouseDown(this,new MouseEventArgs());}',
    'public void Move(){MouseMove(this,new MouseEventArgs());}}',
    'public class Screen{public Rectangle Bounds;public static Screen[] AllScreens=new Screen[0];}',
    'public class ApplicationContext{public bool Exited;public void ExitThread(){Exited=true;}}',
    'public class Timer{public static List<Timer> Running=new List<Timer>();public int Interval;public event EventHandler Tick;',
    'public void Start(){Running.Add(this);}public void Stop(){Running.Remove(this);}public void Fire(){Tick(this,EventArgs.Empty);}}',
    'public static class Application{public static Action<int> Step;',
    'public static void Run(ApplicationContext c){for(int i=0;!c.Exited;i++){if(i>2000)throw new Exception("never ended");',
    'if(Step!=null)Step(i);foreach(var t in Timer.Running.ToArray())t.Fire();}}}',
    'public static class Cursor{public static Point Position;public static int Hidden;public static void Hide(){Hidden++;}public static void Show(){Hidden--;}}}',
    'namespace Microsoft.Win32{public static class SystemEvents{public static event EventHandler DisplaySettingsChanged;',
    'public static event SessionEndingEventHandler SessionEnding;',
    'public static int Subscribed{get{return (DisplaySettingsChanged==null?0:DisplaySettingsChanged.GetInvocationList().Length)+(SessionEnding==null?0:SessionEnding.GetInvocationList().Length);}}',
    'public static void Raise(){DisplaySettingsChanged(null,EventArgs.Empty);}public static void End(){SessionEnding(null,new SessionEndingEventArgs());}}',
    'public class SessionEndingEventArgs:EventArgs{}public delegate void SessionEndingEventHandler(object s,SessionEndingEventArgs e);}'
  ].join('')
  function coverHarness(test: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cui-forms-'))
    const standIn = join(dir, 'WinFormsStandIn.dll')
    const members = WINDOWS_DISPLAY_COVER_MEMBERS.replace(
      '[DllImport("kernel32")]static extern int SetThreadExecutionState(int f);',
      'static int SetThreadExecutionState(int f){return 0;}'
    ).replace(
      '[DllImport("user32")]static extern bool GetLastInputInfo(ref L l);',
      'public static int input;static bool GetLastInputInfo(ref L l){l.c=input;return true;}'
    )
    const seamed = members
      .replace('y.Release(n*2+2);y.Close();', 'told=n*2+2+y.Release(n*2+2);y.Close();')
      .replace(
        '[DllImport("user32")]static extern IntPtr SetWindowsHookEx(int i,K f,IntPtr m,int t);',
        'public static int hooks;public static K hooked;static IntPtr SetWindowsHookEx(int i,K f,IntPtr m,int t){hooks++;hooked=f;return (IntPtr)7;}'
      )
      .replace('[DllImport("user32")]static extern bool UnhookWindowsHookEx(IntPtr h);', 'static bool UnhookWindowsHookEx(IntPtr h){hooks--;return true;}')
      .replace(
        '[DllImport("user32")]static extern IntPtr CallNextHookEx(IntPtr h,int c,IntPtr w,IntPtr l);',
        'static IntPtr CallNextHookEx(IntPtr h,int c,IntPtr w,IntPtr l){return IntPtr.Zero;}'
      )
      .replace('[DllImport("kernel32")]static extern IntPtr GetModuleHandle(string n);', 'static IntPtr GetModuleHandle(string n){return IntPtr.Zero;}')
    expect(seamed).not.toContain('DllImport')
    expect(seamed).toContain('told=')
    const statement = WINDOWS_DISPLAY_COVER_STATEMENT.replace(
      WINDOWS_DISPLAY_COVER_MEMBERS,
      `public static int told;${seamed}`
    )
    const compile = statement
      .slice('try{'.length, statement.indexOf(';$c=[CodeUI.Cover]::Run('))
      .replace('-ReferencedAssemblies System.Windows.Forms,System.Drawing ', `-ReferencedAssemblies '${standIn}',System.Drawing.Primitives,System.Runtime,System.Threading,System.Collections,System.Runtime.InteropServices `)
    return [
      "$ErrorActionPreference='Stop'",
      `Add-Type -TypeDefinition '${WINFORMS_STAND_IN}' -ReferencedAssemblies System.Drawing.Primitives,System.Collections -OutputAssembly '${standIn}'`,
      `Add-Type -Path '${standIn}'`,
      compile,
      'function screen($x){$s=[System.Windows.Forms.Screen]::new();$s.Bounds=[System.Drawing.Rectangle]::new($x,0,1920,1080);$s}',
      '[System.Windows.Forms.Screen]::AllScreens=@((screen 0),(screen 1920))',
      '$w=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset)',
      '$y=[Threading.Semaphore]::new(0,99)',
      'function forms{[System.Windows.Forms.Form]::All}',
      // PowerShell 7 ships the real Microsoft.Win32.SystemEvents; the cover was
      // compiled against the stand-in's, so that is the one to read and raise.
      "$events=[System.Windows.Forms.Form].Assembly.GetType('Microsoft.Win32.SystemEvents')",
      test
    ].join('\n')
  }
  const AFTER =
    "'ran='+$ran+' told='+[CodeUI.Cover]::told+' closed='+$y.SafeWaitHandle.IsClosed+' open='+@(forms|?{!$_.Closed}).Count+' hidden='+[System.Windows.Forms.Cursor]::Hidden+' subscribed='+$events::Subscribed+' hooks='+[CodeUI.Cover]::hooks"

  run('compiles the covers against WinForms stand-ins', () => {
    const out = powershell(coverHarness("[bool]('CodeUI.Cover' -as [type])"))
    expect(out.trim().split('\n').at(-1)).toBe('True')
  })

  run('covers each screen with a black, topmost, borderless window, hidden cursor, and ends on Wake display', () => {
    const out = powershell(
      coverHarness(
        [
          '$script:seen=""',
          '[System.Windows.Forms.Application]::Step={param($i);if($i -eq 1){',
          '$f=@(forms);$script:seen="forms="+$f.Count+" black="+@($f|?{$_.BackColor -eq [System.Drawing.Color]::Black}).Count+' +
            '" top="+@($f|?{$_.TopMost}).Count+" borderless="+@($f|?{$_.FormBorderStyle -eq "None"}).Count+' +
            '" taskbar="+@($f|?{$_.ShowInTaskbar}).Count+" x="+(($f|%{$_.Bounds.X}) -join ",")+" hidden="+[System.Windows.Forms.Cursor]::Hidden+" hooks="+[CodeUI.Cover]::hooks',
          '[void]$w.Set()}}',
          '$ran=[CodeUI.Cover]::Run($w,$y,3)',
          '$script:seen',
          AFTER
        ].join('\n')
      )
    )
    const lines = out.trim().split('\n')
    // Told "covered" with 3 dimmed: 3 x 2 + 2 = 8, of which the wait would take one.
    expect(lines.at(-2)).toBe('forms=2 black=2 top=2 borderless=2 taskbar=0 x=0,1920 hidden=1 hooks=1')
    expect(lines.at(-1)).toBe('ran=True told=8 closed=True open=0 hidden=0 subscribed=0 hooks=0')
  })

  run('ends on input Windows saw after the first half second, and on a key or click on a cover', () => {
    for (const touch of [
      'if($i -eq 1){Start-Sleep -Milliseconds 600};if($i -eq 2){[CodeUI.Cover]::input=5}',
      'if($i -eq 1){(forms)[1].Key()}',
      'if($i -eq 1){(forms)[0].Click()}',
      // A key swallowed by the hook (it never reaches the app underneath) ends it too.
      'if($i -eq 1){$script:swallowed=[CodeUI.Cover]::hooked.Invoke(0,[IntPtr]256,[IntPtr]0)}',
      // So does the Windows session ending.
      'if($i -eq 1){$events::End()}'
    ]) {
      const out = powershell(
        coverHarness(
          [`[System.Windows.Forms.Application]::Step={param($i);${touch}}`, '$ran=[CodeUI.Cover]::Run($w,$y,0)', AFTER].join('\n')
        )
      )
      expect(out.trim().split('\n').at(-1)).toBe('ran=True told=2 closed=True open=0 hidden=0 subscribed=0 hooks=0')
    }
  })

  run('swallows the key that ends the hold, so it never reaches the app underneath', () => {
    const out = powershell(
      coverHarness(
        [
          '[System.Windows.Forms.Application]::Step={param($i);if($i -eq 1){$script:swallowed=[CodeUI.Cover]::hooked.Invoke(0,[IntPtr]256,[IntPtr]0)}}',
          '$ran=[CodeUI.Cover]::Run($w,$y,0)',
          "'swallowed='+$script:swallowed",
          AFTER
        ].join('\n')
      )
    )
    const lines = out.trim().split('\n')
    expect(lines.at(-2)).toBe('swallowed=1')
    expect(lines.at(-1)).toBe('ran=True told=2 closed=True open=0 hidden=0 subscribed=0 hooks=0')
  })

  run('ignores input in the first half second, and a mouse that moves only a few pixels', () => {
    const out = powershell(
      coverHarness(
        [
          '[System.Windows.Forms.Application]::Step={param($i)',
          'if($i -eq 1){[CodeUI.Cover]::input=3;(forms)[0].Move()}',
          'if($i -eq 2){Start-Sleep -Milliseconds 600}',
          'if($i -eq 3){$p=[System.Windows.Forms.Cursor]::Position;$p.X+=3;[System.Windows.Forms.Cursor]::Position=$p;(forms)[0].Move()}',
          'if($i -eq 5){$script:alive=@(forms|?{!$_.Closed}).Count}',
          'if($i -eq 6){$p=[System.Windows.Forms.Cursor]::Position;$p.X+=20;[System.Windows.Forms.Cursor]::Position=$p;(forms)[0].Move()}}',
          '$ran=[CodeUI.Cover]::Run($w,$y,0)',
          "'alive='+$script:alive",
          AFTER
        ].join('\n')
      )
    )
    const lines = out.trim().split('\n')
    expect(lines.at(-2)).toBe('alive=2')
    expect(lines.at(-1)).toBe('ran=True told=2 closed=True open=0 hidden=0 subscribed=0 hooks=0')
  })

  run('covers every screen again when a display is added', () => {
    const out = powershell(
      coverHarness(
        [
          '[System.Windows.Forms.Application]::Step={param($i)',
          'if($i -eq 1){[System.Windows.Forms.Screen]::AllScreens=@((screen 0),(screen 1920),(screen 3840));$events::Raise()}',
          'if($i -eq 3){$script:open=@(forms|?{!$_.Closed}|%{$_.Bounds.X}) -join ",";$script:all=@(forms).Count;[void]$w.Set()}}',
          '$ran=[CodeUI.Cover]::Run($w,$y,0)',
          "'open='+$script:open+' all='+$script:all",
          AFTER
        ].join('\n')
      )
    )
    const lines = out.trim().split('\n')
    expect(lines.at(-2)).toBe('open=0,1920,3840 all=5')
    expect(lines.at(-1)).toBe('ran=True told=2 closed=True open=0 hidden=0 subscribed=0 hooks=0')
  })

  // A cover that cannot be shown tells the script nothing and returns false, so the
  // keeper holds dim-only and the toast says the screens were dimmed.
  run('tells nothing and returns false when no cover can be shown', () => {
    const out = powershell(
      coverHarness(['[System.Windows.Forms.Form]::FailShow=$true', '$ran=[CodeUI.Cover]::Run($w,$y,2)', AFTER].join('\n'))
    )
    expect(out.trim().split('\n').at(-1)).toBe('ran=False told=0 closed=False open=0 hidden=0 subscribed=0 hooks=0')
  })

  // The probe reads a running keeper's mutex as the screens being off, so the
  // sheet offers Wake display while the PC is dimmed and covered.
  run('reads the screens as off while a keeper holds them', () => {
    const out = powershell(`$k=[Threading.Mutex]::new($false,'${KEEPER_MUTEX}')\n${WINDOWS_HOST_STATE_SCRIPT}`)
    expect(out.trim().split('\n').at(-1)).toBe('CUIWIN mute=unknown display=off standby=unknown')
  })

  // Wake display's repair compiles inside a try that swallows a failure, so only
  // this test can see it broken.
  run("compiles Wake display's stuck-timeout repair", () => {
    const line = windowsHostScript('wake-display')
      .split('\n')
      .find((l) => l.includes('-Name Fix '))!
    const compile = line.slice('try{'.length, line.indexOf(';[CodeUI.Fix]::Unstick()'))
    const out = powershell(`$ErrorActionPreference='Stop'\n${compile}\n[bool]('CodeUI.Fix' -as [type])`)
    expect(out.trim()).toBe('True')
  })

  run('compiles the display power type the probe asks', () => {
    const out = powershell(`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition '${WINDOWS_DISPLAY_TYPE}'\n'compiled'`)
    expect(out.trim()).toBe('compiled')
  })

  run('prints the probe marker end to end, unknown mute and display off Windows', () => {
    // No Core Audio and no console display state here: the probe must still end
    // with a marker, so the phone stops waiting.
    const out = powershell(WINDOWS_HOST_STATE_SCRIPT)
    expect(out.trim().split('\n').at(-1)).toBe('CUIWIN mute=unknown display=unknown standby=unknown')
    expect(readWindowsHostStateMarker(out.split('\n'))).toEqual({
      lock: 'unknown',
      display: 'unknown',
      mute: 'unknown'
    })
  })

  // Counts Add-Type calls by shadowing the cmdlet with a function of the same name,
  // which PowerShell resolves first.
  const COUNT_COMPILES = [
    '$script:compiles=0',
    'function Add-Type { $script:compiles++; Microsoft.PowerShell.Utility\\Add-Type @args }'
  ].join('\n')
  const REPORT =
    "'compiles='+$script:compiles+' audio='+[bool]('CodeUI.Audio' -as [type])+' display='+[bool]('CodeUI.DisplayPower' -as [type])"

  run('compiles once when both types compile, and loads both', () => {
    const out = powershell(`${COUNT_COMPILES}\n${WINDOWS_HOST_STATE_SCRIPT}\n${REPORT}`)
    expect(out.trim().split('\n').at(-1)).toBe('compiles=1 audio=True display=True')
  })

  // Review, 2026-09-26: Add-Type fails a unit the compiler only warns about. Windows
  // PowerShell 5.1's older compiler has never seen these types, and a warning there
  // would have cost three compiles, one more than before, and the display read.
  run('still compiles once, and loads both, when the compiler only warns', () => {
    const warns = WINDOWS_DISPLAY_NAMESPACE.replace('static int v=-1;', 'static int v=-1;static int w;')
    expect(warns).not.toBe(WINDOWS_DISPLAY_NAMESPACE)
    const out = powershell(`${COUNT_COMPILES}\n${windowsHostStateScript(warns)}\n${REPORT}`)
    expect(out.trim().split('\n').at(-1)).toBe('compiles=1 audio=True display=True')
  })

  run('keeps the mute type when the display type will not compile', () => {
    const broken = WINDOWS_DISPLAY_NAMESPACE.replace('public static int Read', 'public static int Read(')
    const out = powershell(`${COUNT_COMPILES}\n${windowsHostStateScript(broken)}\n${REPORT}`)
    const lines = out.trim().split('\n')
    expect(lines.at(-1)).toBe('compiles=3 audio=True display=False')
    expect(readWindowsHostStateMarker(lines)).toEqual({ lock: 'unknown', display: 'unknown', mute: 'unknown' })
  })

  run('prints no done marker when the Windows call is not there to succeed', () => {
    // Off Windows every call fails; the script must stop before the marker, which is
    // what makes the phone report "did not finish" instead of a false success.
    for (const action of ACTIONS) {
      let out = ''
      try {
        out = powershell(windowsHostScript(action))
      } catch (error) {
        out = String((error as { stdout?: string }).stdout ?? '')
      }
      expect(MAC_HOST_COMMAND_DONE_PATTERN.test(out)).toBe(false)
    }
  })
})
