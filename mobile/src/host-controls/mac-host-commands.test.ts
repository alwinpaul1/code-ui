import { describe, expect, it } from 'vitest'
import {
  MAC_HOST_ACTION_LABELS,
  MAC_HOST_ACTION_PROGRESS,
  buildMacHostCommand,
  buildMacUnlockCommand
} from './mac-host-commands'

describe('mac host commands', () => {
  it('closes its own throwaway tab whatever the action', () => {
    for (const action of ['lock', 'sleep-display', 'wake-display'] as const) {
      expect(buildMacHostCommand(action)).toMatch(/; exit$/)
    }
    expect(buildMacUnlockCommand('pw')).toMatch(/; exit$/)
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
    expect(buildMacHostCommand('sleep-display')).toBe('pmset displaysleepnow; exit')
    expect(buildMacHostCommand('wake-display')).toBe('caffeinate -u -t 2; exit')
  })

  it('wakes the display, waits, then types the password and Return', () => {
    expect(buildMacUnlockCommand('hunter2')).toBe(
      `caffeinate -u -t 2; sleep 1; osascript -e 'tell application "System Events" to keystroke "hunter2"' -e 'tell application "System Events" to keystroke return'; exit`
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
      `caffeinate -u -t 2; sleep 1; osascript -e 'tell application "System Events" to keystroke "a'\\''b"' -e 'tell application "System Events" to keystroke return'; exit`
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
      'wake-display': 'Wake display'
    })
  })

  it('tells the user what is happening without quoting the command', () => {
    for (const action of ['lock', 'unlock', 'sleep-display', 'wake-display'] as const) {
      const progress = MAC_HOST_ACTION_PROGRESS[action]
      expect(progress).toBeTruthy()
      expect(progress).not.toContain('osascript')
      expect(progress).not.toContain('keystroke')
    }
  })
})
