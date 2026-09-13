import { describe, expect, it } from 'vitest'
import {
  TERMINAL_ACCESSORY_KEY_DEFINITIONS,
  TERMINAL_SHORTCUT_SPECIAL_KEY_DEFINITIONS
} from './terminal-key-definitions'
import { stripTerminalScreenControl } from './terminal-screen-control-strip'

const ESC = String.fromCharCode(0x1b)

describe('stripping screen control on the way to the PTY', () => {
  it("drops the cursor restore a host snapshot ends with", () => {
    // 2026-09-13: this landed in the desktop Claude Code composer, where ink ate
    // the CSI and drew the rest, so the user saw "54;1H" typed into their prompt.
    expect(stripTerminalScreenControl(`${ESC}[54;1H`)).toBe('')
    expect(stripTerminalScreenControl(`hello${ESC}[54;1H`)).toBe('hello')
  })

  it('drops erase and scrolling-region sequences too', () => {
    for (const sequence of [`${ESC}[2J`, `${ESC}[K`, `${ESC}[1;54r`, `${ESC}[3;1f`]) {
      expect(stripTerminalScreenControl(sequence)).toBe('')
    }
  })

  it('leaves every key the phone can actually send alone', () => {
    const keys = [
      ...TERMINAL_ACCESSORY_KEY_DEFINITIONS,
      ...TERMINAL_SHORTCUT_SPECIAL_KEY_DEFINITIONS
    ]
    expect(keys.length).toBeGreaterThan(8)
    for (const key of keys) {
      const bytes = (key as { bytes?: string }).bytes
      if (typeof bytes === 'string') {
        expect(stripTerminalScreenControl(bytes)).toBe(bytes)
      }
    }
  })

  it('leaves mouse reports, pastes and the input-line clear alone', () => {
    for (const sequence of [
      `${ESC}[<0;12;34M`,
      `${ESC}[<64;1;1m`,
      `${ESC}[M !!`,
      `${ESC}[200~a message${ESC}[201~`,
      '\x15\x0b',
      `${ESC}[A`,
      `${ESC}[3~`,
      `${ESC}[Z`
    ]) {
      expect(stripTerminalScreenControl(sequence)).toBe(sequence)
    }
  })

  it('leaves ordinary prose untouched and does not scan it', () => {
    const prose = 'fix the H in J K r and [2J in the docs'
    expect(stripTerminalScreenControl(prose)).toBe(prose)
  })
})
