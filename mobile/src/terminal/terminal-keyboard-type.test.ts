import { describe, expect, it } from 'vitest'
import {
  getTerminalCommandKeyboardType,
  getTerminalLiveInputKeyboardType
} from './terminal-keyboard-type'

describe('terminal keyboard type', () => {
  it('disables the Android IME composing region for live terminal input (#12251/keystroke streaming)', () => {
    // Samsung's default keyboard holds typed text as composing until a commit,
    // which the live-input mirror never streams; visible-password commits each key.
    expect(getTerminalLiveInputKeyboardType('android')).toBe('visible-password')
  })

  it('uses the Android system keyboard for buffered command input', () => {
    expect(getTerminalCommandKeyboardType('android', false)).toBe('default')
    expect(getTerminalCommandKeyboardType('android', true)).toBe('default')
  })

  it('keeps iOS IME keyboards available for terminal input', () => {
    expect(getTerminalLiveInputKeyboardType('ios')).toBe('default')
    expect(getTerminalCommandKeyboardType('ios', false)).toBe('default')
    expect(getTerminalCommandKeyboardType('ios', true)).toBe('default')
  })
})
