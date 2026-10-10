import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WINDOWS_AUDIO_TYPE } from './windows-host-commands'
import {
  WINDOWS_HOST_STATE_PROBE_COMMAND,
  WINDOWS_HOST_STATE_SCRIPT,
  parseWindowsHostState,
  readWindowsHostStateMarker
} from './windows-host-state'

const statements = WINDOWS_HOST_STATE_SCRIPT.split('\n')

describe('what the Windows probe asks', () => {
  // 2026-10-10, the user removed Sleep display from Windows. Nothing on the sheet
  // reads a PC's display any more, so the probe stops paying for the question: the
  // console display state, Modern Standby and the dim keeper's mutex are all gone.
  it('asks only mute: no display state, no Modern Standby, no dim keeper', () => {
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toMatch(/DisplayPower|6FE69556|PowerSettingRegisterNotification/)
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toMatch(/GetPwrCapabilities|AoAc/)
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toMatch(/CUIKeep|Mutex/)
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toMatch(/display=|standby=/)
    expect(statements).toContain("try{$m=if([CodeUI.Audio]::GetMute()){'true'}else{'false'}}catch{}")
  })

  // 2026-09-26: the sheet offers Lock PC whatever the PC says.
  it('never asks whether the PC is locked', () => {
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toContain('LogonUI')
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toContain('lock=')
  })

  // Every Add-Type in Windows PowerShell 5.1 starts csc.exe: one, for Core Audio.
  // A compile that fails must still leave a marker, or the phone waits out 15 s.
  it('compiles Core Audio once, inside a try, and prints the marker whatever happens', () => {
    expect(statements.filter((line) => line.includes('Add-Type'))).toEqual([
      `try{Add-Type -Ig -TypeDefinition '${WINDOWS_AUDIO_TYPE}'}catch{}`
    ])
    expect(statements[0]).toBe('$ErrorActionPreference=0')
    expect(statements.at(-1)).toBe(`'CUI'+"WIN mute=$m end"`)
  })

  it('keeps the C# inside a single-quoted PowerShell string', () => {
    expect(WINDOWS_AUDIO_TYPE).not.toContain("'")
  })

  // 0.9.126 could leave "Turn off display after" at 1 s, and Wake display repaired
  // it. That repair is not carried over (windows-host-state.ts says why): the probe
  // writes nothing to the PC.
  it('writes nothing to the PC: no power plan, no display timeout', () => {
    expect(WINDOWS_HOST_STATE_SCRIPT).not.toMatch(/ValueIndex|ActiveScheme|powercfg|3c0bc021|::SetMute/i)
  })

  // 2026-09-24 review: cmd.exe refuses a line past 8,191 (KB830473), and Orca offers
  // cmd as a Windows shell, so a cmd user's probe would print no marker at all.
  it("fits cmd.exe's 8,191-character command line with room to spare", () => {
    expect(WINDOWS_HOST_STATE_PROBE_COMMAND).toMatch(/^powershell -nop -noni -enc [A-Za-z0-9+/=]+$/)
    expect(WINDOWS_HOST_STATE_PROBE_COMMAND.length).toBeLessThanOrEqual(6000)
  })
})

describe('reading what a Windows PC says about itself', () => {
  it('reads mute, and leaves lock and display unknown', () => {
    expect(parseWindowsHostState(['CUIWIN mute=true end'])).toEqual({ lock: 'unknown', display: 'unknown', mute: 'muted' })
    expect(parseWindowsHostState(['CUIWIN mute=false end'])).toEqual({ lock: 'unknown', display: 'unknown', mute: 'unmuted' })
    expect(parseWindowsHostState(['CUIWIN mute=unknown end'])).toEqual({ lock: 'unknown', display: 'unknown', mute: 'unknown' })
  })

  // A probe started by an older build prints the old shape. The phone only reads the
  // tab it opened with its own command, so this should never reach it; reading it
  // anyway costs nothing. Its display and Modern Standby fields are ignored: no row
  // depends on them, and the flag must not come back through an old line.
  it('still reads mute from the old line shape, and ignores its display and standby', () => {
    expect(parseWindowsHostState(['CUIWIN mute=true display=off standby=modern'])).toEqual({
      lock: 'unknown',
      display: 'unknown',
      mute: 'muted'
    })
    expect(parseWindowsHostState(['CUIWIN mute=false display=dimmed standby=classic'])).toEqual({
      lock: 'unknown',
      display: 'unknown',
      mute: 'unmuted'
    })
  })

  it('does not take a line that has not finished painting for an answer', () => {
    for (const partial of [
      'CUIWIN',
      'CUIWIN mute=',
      'CUIWIN mute=tr',
      'CUIWIN mute=true',
      'CUIWIN mute=true e',
      'CUIWIN mute=true display=on',
      'CUIWIN mute=true display=on standby=mod'
    ]) {
      expect(readWindowsHostStateMarker([partial])).toBeNull()
    }
  })

  it('takes the last marker on the screen', () => {
    expect(parseWindowsHostState(['CUIWIN mute=true end', 'PS C:\\>', 'CUIWIN mute=false end'])).toEqual({
      lock: 'unknown',
      display: 'unknown',
      mute: 'unmuted'
    })
  })

  it('answers nothing when nothing was painted, and for an empty screen', () => {
    expect(readWindowsHostStateMarker(['PS C:\\> powershell ...'])).toBeNull()
    expect(readWindowsHostStateMarker([])).toBeNull()
    expect(parseWindowsHostState([])).toEqual({ lock: 'unknown', display: 'unknown', mute: 'unknown' })
  })

  it('never matches its own command line', () => {
    expect(readWindowsHostStateMarker([WINDOWS_HOST_STATE_PROBE_COMMAND])).toBeNull()
    expect(readWindowsHostStateMarker(statements)).toBeNull()
  })
})

// PowerShell 7 parses the probe, compiles its C# and runs it end to end. The Win32
// and Core Audio calls, and Windows PowerShell 5.1's older compiler, need Windows.
describe('the Windows probe under a real PowerShell', () => {
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

  run('parses with no errors', () => {
    const errors = powershell(
      `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseInput(@'\n${WINDOWS_HOST_STATE_SCRIPT}\n'@,[ref]$null,[ref]$e);$e.Count`
    )
    expect(errors.trim()).toBe('0')
  })

  run('prints the marker end to end, unknown mute off Windows', () => {
    const out = powershell(WINDOWS_HOST_STATE_SCRIPT)
    expect(out.trim().split('\n').at(-1)).toBe('CUIWIN mute=unknown end')
    expect(readWindowsHostStateMarker(out.split('\n'))).toEqual({ lock: 'unknown', display: 'unknown', mute: 'unknown' })
  })

  run('runs from the encoded command the phone sends', () => {
    const encoded = WINDOWS_HOST_STATE_PROBE_COMMAND.split(' ').at(-1)!
    const out = execFileSync(pwsh!, ['-nop', '-noni', '-enc', encoded], { encoding: 'utf8' })
    expect(out.trim().split('\n').at(-1)).toBe('CUIWIN mute=unknown end')
  })

  // A compile that fails (here, an Add-Type that throws) still prints the marker.
  run('still prints the marker when Core Audio will not compile', () => {
    const out = powershell(`function Add-Type { throw 'no compiler' }\n${WINDOWS_HOST_STATE_SCRIPT}`)
    expect(out.trim().split('\n').at(-1)).toBe('CUIWIN mute=unknown end')
  })
})
