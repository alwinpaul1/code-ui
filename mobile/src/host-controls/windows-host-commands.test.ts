import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAC_HOST_COMMAND_DONE_PATTERN } from './mac-host-commands'
import {
  WINDOWS_AUDIO_TYPE,
  WINDOWS_HOST_ACTION_LABELS,
  buildWindowsHostCommand,
  windowsHostScript,
  type WindowsHostAction
} from './windows-host-commands'
import {
  WINDOWS_DISPLAY_TYPE,
  WINDOWS_HOST_STATE_PROBE_COMMAND,
  WINDOWS_HOST_STATE_SCRIPT,
  parseWindowsHostState
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
  })
})

describe('reading what a Windows PC says about itself', () => {
  it('reads a locked, muted PC', () => {
    expect(parseWindowsHostState(['CUIWIN lock=1 mute=true display=on'])).toEqual({
      lock: 'locked',
      display: 'on',
      mute: 'muted'
    })
  })

  // 2026-09-23, from the phone: both Sleep display and Wake display showed on
  // a PC whose display was on, because the probe never asked.
  it('reads the display as on, off, or dimmed (which is on), and unknown when Windows would not say', () => {
    const display = (value: string) => parseWindowsHostState([`CUIWIN lock=0 mute=false display=${value}`]).display
    expect(display('on')).toBe('on')
    expect(display('off')).toBe('off')
    expect(display('dimmed')).toBe('on')
    expect(display('unknown')).toBe('unknown')
  })

  it('asks the power setting that owns the answer: the console display state', () => {
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain('6FE69556-704A-47A0-8F24-C28D936FDA47')
    expect(WINDOWS_HOST_STATE_SCRIPT).toContain('PowerSettingRegisterNotification')
  })

  it('reads an unlocked PC whose output device would not say', () => {
    expect(parseWindowsHostState(['CUIWIN lock=0 mute=unknown'])).toEqual({
      lock: 'unlocked',
      display: 'unknown',
      mute: 'unknown'
    })
  })

  it('takes the last marker on the screen', () => {
    expect(parseWindowsHostState(['CUIWIN lock=1 mute=true', 'PS C:\\>', 'CUIWIN lock=0 mute=false']).lock).toBe(
      'unlocked'
    )
  })

  it('answers unknown when nothing was painted, and for an empty screen', () => {
    expect(parseWindowsHostState(['PS C:\\> powershell ...']).lock).toBe('unknown')
    expect(parseWindowsHostState([]).lock).toBe('unknown')
  })

  it('never matches its own command line', () => {
    expect(parseWindowsHostState([WINDOWS_HOST_STATE_PROBE_COMMAND]).lock).toBe('unknown')
    expect(parseWindowsHostState(WINDOWS_HOST_STATE_SCRIPT.split('\n')).lock).toBe('unknown')
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

  run('compiles the display power type the probe asks', () => {
    const out = powershell(`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition '${WINDOWS_DISPLAY_TYPE}'\n'compiled'`)
    expect(out.trim()).toBe('compiled')
  })

  run('prints the probe marker end to end, unlocked and unknown mute off Windows', () => {
    // No LogonUI and no Core Audio here: the probe must still say what it knows.
    const out = powershell(WINDOWS_HOST_STATE_SCRIPT)
    expect(parseWindowsHostState(out.split('\n'))).toEqual({
      lock: 'unlocked',
      display: 'unknown',
      mute: 'unknown'
    })
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
