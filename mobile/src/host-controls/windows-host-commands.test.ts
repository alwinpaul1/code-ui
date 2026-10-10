import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAC_HOST_COMMAND_DONE_PATTERN, readMacHostRefusal } from './mac-host-commands'
import {
  WINDOWS_AUDIO_TYPE,
  WINDOWS_HOST_ACTION_LABELS,
  buildWindowsHostCommand,
  windowsHostScript,
  type WindowsHostAction
} from './windows-host-commands'
import {
  DISPLAY_OFF_READY_EVENT,
  DISPLAY_WAKE_EVENT,
  WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT,
  WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS
} from './windows-display-off-keeper'
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

describe('the Windows host commands', () => {
  it('offers the Mac set without Unlock, which Windows only takes at the PC', () => {
    expect(ACTIONS.sort()).toEqual(['lock', 'mute', 'sleep-display', 'unmute', 'wake-display'])
  })

  it.each(ACTIONS)('sends %s as one quote-free encoded PowerShell call, whatever shell the PC runs', (action) => {
    const command = buildWindowsHostCommand(action)
    expect(command).toMatch(/^powershell -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/)
    expect(decode(command)).toBe(windowsHostScript(action))
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

  // 2026-10-10, Danny: on a Modern Standby PC (AoAc, byte 20) SC_MONITORPOWER
  // starts standby (2026-10-08), so the script hands the display-off to a keeper
  // that holds the PC awake first, and says done only once the keeper says so.
  describe('Sleep display on a PC with Modern Standby', () => {
    const script = windowsHostScript('sleep-display')
    const ask = script.indexOf('GetPwrCapabilities($c)')
    const branchEnd = script.indexOf(';exit}', ask)
    const branch = script.slice(ask, branchEnd)
    // The keeper's own text rides inside the branch as a literal; what the branch
    // itself runs is the rest.
    const keeper = /GetBytes\('((?:[^']|'')*)'\)/.exec(branch)?.[1] ?? ''
    const outer = branch.replace(keeper, '')

    it('asks whether the PC has Modern Standby first, and keeps the post for every other PC', () => {
      expect(ask).toBeGreaterThan(-1)
      expect(script).toContain('$c[20]')
      expect(branchEnd).toBeGreaterThan(ask)
      // The classic path: the same post as before, after the branch.
      expect(script.indexOf('[IntPtr]0xF170,[IntPtr]2')).toBeGreaterThan(branchEnd)
    })

    it('never posts the display off itself on that PC: the keeper does, once it holds the PC awake', () => {
      expect(keeper.length).toBeGreaterThan(0)
      expect(outer).not.toContain('0xF170')
      expect(outer).not.toContain('PostMessage')
    })

    it('starts the keeper hidden and detached, encoding it on the PC rather than embedding base64', () => {
      expect(branch).toContain('[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(')
      expect(branch).toContain(
        "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',$k"
      )
      // The outer command is base64 already; base64 inside it would cost 2.7x again.
      expect(script).not.toMatch(/[A-Za-z0-9+/]{120,}/)
      // The keeper the PC encodes is exactly the keeper this repo tests.
      expect(keeper.replace(/''/g, "'")).toBe(WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT)
    })

    it('waits for the keeper to say it holds the PC before printing done, and refuses otherwise', () => {
      const ready = outer.indexOf(`Threading.EventWaitHandle($false,'ManualReset','${DISPLAY_OFF_READY_EVENT}')`)
      const start = outer.indexOf('Start-Process')
      const wait = outer.indexOf('.WaitOne(')
      const done = outer.indexOf(`'CUIDONE '+'ok'`)
      const refuse = outer.indexOf(`'CUIREF'+'USED keepawake'`)
      expect(ready).toBeGreaterThan(-1)
      expect(start).toBeGreaterThan(ready)
      expect(wait).toBeGreaterThan(start)
      expect(done).toBeGreaterThan(wait)
      expect(refuse).toBeGreaterThan(done)
      expect(readMacHostRefusal(script.split('\n'))).toBeNull()
      expect(readMacHostRefusal(['CUIREFUSED keepawake'])).toBe('keepawake')
    })
  })

  // 2026-10-10: "suddenly we open the sheet and do wake display too". A keeper still
  // waiting for the off notification must end at once, not hold the PC for 12 h.
  it('tells a waiting keeper to stop before it turns the display on', () => {
    const script = windowsHostScript('wake-display')
    const signal = script.indexOf(`[Threading.EventWaitHandle]::TryOpenExisting('${DISPLAY_WAKE_EVENT}',[ref]$w)`)
    const set = script.indexOf('$w.Set()')
    const on = script.indexOf('[IntPtr]0xF170,[IntPtr](-1)')
    expect(signal).toBeGreaterThan(-1)
    expect(set).toBeGreaterThan(signal)
    expect(on).toBeGreaterThan(set)
  })

  // 2026-10-10: "there must be no timer". The power plan is never touched.
  it('never touches the power plan', () => {
    for (const script of [...ACTIONS.map(windowsHostScript), WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT]) {
      expect(script).not.toMatch(/ActiveScheme|ValueIndex|powercfg|VIDEOIDLE|3c0bc021/i)
    }
  })

  it("keeps Sleep display under cmd.exe's 8,191 characters with the keeper inside it", () => {
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
    expect(WINDOWS_DISPLAY_OFF_KEEPER_MEMBERS).not.toContain("'")
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
    expect(compiles[0]?.startsWith('try{Add-Type -IgnoreWarnings -TypeDefinition ($u+$a+$p)}catch{')).toBe(true)
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain(`$a='${WINDOWS_AUDIO_TYPE}'`)
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain(`$p='${WINDOWS_DISPLAY_NAMESPACE}'`)
  })

  // Add-Type fails a unit its compiler only warns about, and none of this C# has met
  // Windows PowerShell 5.1's compiler. A warning there must not cost a read or an action.
  it('lets every compile the phone sends through its warnings', () => {
    const scripts = [WINDOWS_HOST_STATE_SCRIPT, ...ACTIONS.map(windowsHostScript)]
    const compiles = scripts.flatMap((script) => script.match(/Add-Type(?: -[A-Za-z]+)*/g) ?? [])
    expect(compiles.length).toBeGreaterThanOrEqual(ACTIONS.length + 3)
    for (const compile of compiles) {
      expect(compile).toContain('-IgnoreWarnings')
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
      .filter((line) => line.startsWith('Add-Type'))
    const unique = [...new Set(declarations)]
    const out = powershell(`$ErrorActionPreference='Stop'\n${unique.join('\n')}\n'compiled'`)
    expect(out.trim()).toBe('compiled')
  })

  // The keeper runs on its own, from the base64 the sleep script builds on the PC,
  // so its text is parsed and its C# compiled here as well. Its calls (named
  // events, the power request) need Windows and are not run.
  run('parses the display-off keeper and compiles its type', () => {
    const errors = powershell(
      `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseInput(@'\n${WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT}\n'@,[ref]$null,[ref]$e);$e.Count`
    )
    expect(errors.trim()).toBe('0')
    const out = powershell(
      `$ErrorActionPreference='Stop'\n${WINDOWS_DISPLAY_OFF_KEEPER_SCRIPT.split('\n')[0]}\n[bool]('CodeUI.Keeper' -as [type])`
    )
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
