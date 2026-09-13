import { describe, expect, it } from 'vitest'
import {
  MAC_HOST_ACTION_LABELS,
  MAC_HOST_ACTION_PROGRESS,
  MAC_HOST_COMMAND_DONE_PATTERN,
  buildMacHostCommand,
  buildMacUnlockCommand
} from './mac-host-commands'

describe('mac host commands', () => {
  it('ends by reporting done instead of exiting, so the phone can close a live tab', () => {
    // 2026-09-13: `; exit` left dead "Terminal N" tabs on the desktop.
    for (const action of ['lock', 'sleep-display', 'wake-display', 'mute', 'unmute'] as const) {
      expect(buildMacHostCommand(action)).toMatch(/; printf 'CUIDONE %s\\n' ok$/)
      expect(buildMacHostCommand(action)).not.toMatch(/exit\s*$/)
    }
    expect(buildMacUnlockCommand('pw')).toMatch(/; printf 'CUIDONE %s\\n' ok$/)
    expect(MAC_HOST_COMMAND_DONE_PATTERN.test("printf 'CUIDONE %s\\n' ok")).toBe(false)
    expect(MAC_HOST_COMMAND_DONE_PATTERN.test('CUIDONE ok')).toBe(true)
  })

  it('locks with the Lock Screen shortcut and falls back to display sleep', () => {
    const command = buildMacHostCommand('lock')
    expect(command).toContain(
      `osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}'`
    )
    expect(command).toContain(
      '|| pmset displaysleepnow'
    )
  })

  it('sleeps and wakes the display with pmset and caffeinate', () => {
    expect(buildMacHostCommand('sleep-display')).toBe('pmset displaysleepnow; printf \'CUIDONE %s\\n\' ok')
    expect(buildMacHostCommand('wake-display')).toBe('caffeinate -u -t 2; printf \'CUIDONE %s\\n\' ok')
  })

  it('mutes and unmutes the speakers only, never the microphone', () => {
    expect(buildMacHostCommand('mute')).toBe(`osascript -e 'set volume output muted true'; printf 'CUIDONE %s\\n' ok`)
    expect(buildMacHostCommand('unmute')).toBe(`osascript -e 'set volume output muted false'; printf 'CUIDONE %s\\n' ok`)
    expect(buildMacHostCommand('mute')).not.toContain('input')
  })

  it('wakes the display, waits, then types the password and Return', () => {
    expect(buildMacUnlockCommand('hunter2')).toBe(
      `caffeinate -u -t 2; sleep 1; osascript -e 'tell application "System Events" to keystroke "hunter2"' -e 'tell application "System Events" to keystroke return'; printf 'CUIDONE %s\\n' ok`
    )
  })

  it('keeps a double quote inside the AppleScript string', () => {
    expect(buildMacUnlockCommand('a"b')).toContain(`keystroke "a\\"b"`)
  })

  it('keeps a backslash inside the AppleScript string', () => {
    expect(buildMacUnlockCommand('a\\b')).toContain(`keystroke "a\\\\b"`)
  })

  it('does not let a single quote break the shell quoting', () => {
    // The '\'' idiom: close the quote, hand the shell an escaped one, reopen —
    // so the whole -e argument still reaches osascript as one word.
    expect(buildMacUnlockCommand("a'b")).toBe(
      `caffeinate -u -t 2; sleep 1; osascript -e 'tell application "System Events" to keystroke "a'\\''b"' -e 'tell application "System Events" to keystroke return'; printf 'CUIDONE %s\\n' ok`
    )
  })

  it('leaves $ and backtick literal because single quotes already disarm them', () => {
    expect(buildMacUnlockCommand('a$b`c')).toContain('keystroke "a$b`c"')
  })

  it('names every action for the sheet', () => {
    expect(MAC_HOST_ACTION_LABELS).toEqual({
      lock: 'Lock Mac',
      unlock: 'Unlock Mac',
      'sleep-display': 'Sleep display',
      'wake-display': 'Wake display',
      mute: 'Mute Mac',
      unmute: 'Unmute Mac'
    })
  })

  it('tells the user what is happening without quoting the command', () => {
    for (const action of ['lock', 'unlock', 'sleep-display', 'wake-display', 'mute', 'unmute'] as const) {
      const progress = MAC_HOST_ACTION_PROGRESS[action]
      expect(progress).toBeTruthy()
      expect(progress).not.toContain('osascript')
      expect(progress).not.toContain('keystroke')
    }
  })
})
