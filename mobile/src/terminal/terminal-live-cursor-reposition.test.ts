import { describe, expect, it } from 'vitest'
import { isTerminalLiveCursorRepositionBytes } from './terminal-live-text-commit'

describe('isTerminalLiveCursorRepositionBytes', () => {
  it('matches the cursor-move and line-mutating control bytes', () => {
    for (const bytes of [
      '\x1b[A',
      '\x1b[B',
      '\x1b[C',
      '\x1b[D',
      '\x1b[H',
      '\x1b[F',
      '\x01',
      '\x05',
      '\x17'
    ]) {
      expect(isTerminalLiveCursorRepositionBytes(bytes)).toBe(true)
    }
  })

  it('leaves plain text and non-cursor controls alone', () => {
    for (const bytes of ['a', 'Z', ' ', '\r', '\x1b', '\t', '\x1b[Z', '\x03', '\x7f']) {
      expect(isTerminalLiveCursorRepositionBytes(bytes)).toBe(false)
    }
  })
})
