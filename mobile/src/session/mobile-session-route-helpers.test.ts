import { describe, expect, it } from 'vitest'
import {
  isTerminalPhoneDisplayMode,
  mobileVisibleTerminalDisplayMode
} from './mobile-session-route-helpers'

describe('mobileVisibleTerminalDisplayMode', () => {
  it('opens a visible terminal at phone width, including an agent in terminal mode', () => {
    expect(mobileVisibleTerminalDisplayMode('pty-zsh', false)).toBe('auto')
    expect(mobileVisibleTerminalDisplayMode('pty-grok', false)).toBe('auto')
  })

  it('leaves the desk at desktop width while chat covers the PTY', () => {
    expect(mobileVisibleTerminalDisplayMode('pty-grok', true)).toBe('desktop')
  })

  it('does not send a mode when no terminal is active', () => {
    expect(mobileVisibleTerminalDisplayMode(null, false)).toBeNull()
  })
})

describe('isTerminalPhoneDisplayMode', () => {
  it('uses phone mode for automatic, phone, and unreported terminals', () => {
    const modes = new Map([
      ['auto', 'auto'],
      ['phone', 'phone']
    ] as const)

    expect(isTerminalPhoneDisplayMode('auto', modes)).toBe(true)
    expect(isTerminalPhoneDisplayMode('phone', modes)).toBe(true)
    expect(isTerminalPhoneDisplayMode('missing', modes)).toBe(true)
  })

  it('rejects absent handles and desktop terminals', () => {
    const modes = new Map([['desktop', 'desktop']] as const)

    expect(isTerminalPhoneDisplayMode(null, modes)).toBe(false)
    expect(isTerminalPhoneDisplayMode('desktop', modes)).toBe(false)
  })
})
