import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAC_HOST_COMMAND_DONE_PATTERN, type MacHostAction } from './mac-host-commands'
import {
  WINDOWS_AUDIO_TYPE,
  WINDOWS_HOST_ACTIONS,
  WINDOWS_HOST_ACTION_LABELS,
  WINDOWS_HOST_ACTION_PROGRESS,
  buildWindowsHostCommand,
  isWindowsHostAction,
  windowsHostScript,
  type WindowsHostAction
} from './windows-host-commands'
import { WINDOWS_HOST_STATE_SCRIPT } from './windows-host-state'

const ACTIONS = Object.keys(WINDOWS_HOST_ACTION_LABELS) as WindowsHostAction[]

function decode(command: string): string {
  const encoded = command.split(' ').at(-1)!
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

describe('the Windows host commands', () => {
  // 2026-10-10, the user: "Completely remove Sleep display features from Windows
  // devices." Unlock was never there: Windows takes a password only at the PC.
  it('offers Lock PC and Mute/Unmute, and no Unlock, Sleep display or Wake display', () => {
    expect([...ACTIONS].sort()).toEqual(['lock', 'mute', 'unmute'])
    expect([...WINDOWS_HOST_ACTIONS].sort()).toEqual(['lock', 'mute', 'unmute'])
    expect(Object.keys(WINDOWS_HOST_ACTION_PROGRESS).sort()).toEqual(['lock', 'mute', 'unmute'])
    const rows: MacHostAction[] = ['lock', 'unlock', 'sleep-display', 'wake-display', 'mute', 'unmute']
    expect(rows.filter(isWindowsHostAction)).toEqual(['lock', 'mute', 'unmute'])
  })

  it.each(ACTIONS)('sends %s as one quote-free encoded PowerShell call, whatever shell the PC runs', (action) => {
    const command = buildWindowsHostCommand(action)
    // -nop, -noni, -enc: -NoProfile, -NonInteractive, -EncodedCommand (for cmd.exe's 8,191).
    expect(command).toMatch(/^powershell -nop -noni -enc [A-Za-z0-9+/=]+$/)
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
    expect(windowsHostScript('mute')).toContain('SetMute($true)')
    expect(windowsHostScript('unmute')).toContain('SetMute($false)')
  })

  it('touches neither the display nor the power plan', () => {
    for (const action of ACTIONS) {
      expect(windowsHostScript(action)).not.toMatch(/0xF170|MONITORPOWER|SetThreadExecutionState|ValueIndex|ActiveScheme|powercfg|GetPwrCapabilities/i)
    }
  })

  // 2026-09-24 review: cmd.exe refuses a line past 8,191 (Microsoft KB830473), and
  // Orca offers cmd as a Windows shell, so a cmd user's command would never run.
  it("fits cmd.exe's 8,191-character command line, so a PC whose terminal is cmd still runs it", () => {
    for (const action of ACTIONS) {
      expect(buildWindowsHostCommand(action).length).toBeLessThanOrEqual(8191)
    }
  })

  it('keeps the C# inside a single-quoted PowerShell string', () => {
    expect(WINDOWS_AUDIO_TYPE).not.toContain("'")
  })

  // Add-Type fails a unit its compiler only warns about, and none of this C# has met
  // Windows PowerShell 5.1's compiler. A warning there must not cost a read or an action.
  it('lets every compile the phone sends through its warnings', () => {
    const scripts = [WINDOWS_HOST_STATE_SCRIPT, ...ACTIONS.map(windowsHostScript)]
    const compiles = scripts.flatMap((script) => script.match(/Add-Type(?: -[A-Za-z]+)*/g) ?? [])
    expect(compiles.length).toBe(ACTIONS.length + 1)
    for (const compile of compiles) {
      expect(compile).toMatch(/ -Ig(noreWarnings)?( |$)/)
    }
  })
})

// ─── Under a real PowerShell ───────────────────────────────────────────────
// PowerShell 7 runs on macOS and Linux, which is enough to parse every script and
// compile the C# each one declares. Found through `CUIHUD_PWSH` or `pwsh` on PATH,
// as the HUD's tests find it; skipped, loudly, when neither exists. The Win32 and
// Core Audio calls themselves, and Windows PowerShell 5.1's older compiler, need a
// Windows machine and remain unrun. The probe has its own (windows-host-state.test.ts).
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

  run('parses every action script with no errors', () => {
    for (const script of ACTIONS.map(windowsHostScript)) {
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
    expect(unique.length).toBe(2)
    const out = powershell(`$ErrorActionPreference='Stop'\n${unique.join('\n')}\n'compiled'`)
    expect(out.trim()).toBe('compiled')
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
