import { describe, expect, it } from 'vitest'
import { buildTerminalScreenFenceBlock } from './mobile-terminal-ask-about-screen'

describe('building the fenced block for "Ask about this screen"', () => {
  it('fences the visible lines as-is when the screen is fully painted', () => {
    const lines = ['$ npm test', 'PASS  src/foo.test.ts', '$ ']
    expect(buildTerminalScreenFenceBlock(lines)).toBe('```\n$ npm test\nPASS  src/foo.test.ts\n$ \n```')
  })

  it('trims the blank rows a short-lived command leaves below the real content', () => {
    const lines = ['$ echo hi', 'hi', '', '', '']
    expect(buildTerminalScreenFenceBlock(lines)).toBe('```\n$ echo hi\nhi\n```')
  })

  it('keeps leading blanks — a screen still filling has its content at the top, not padding', () => {
    const lines = ['', '', '$ echo hi']
    expect(buildTerminalScreenFenceBlock(lines)).toBe('```\n\n\n$ echo hi\n```')
  })

  it('is disabled (null, nothing to append) on an empty screen', () => {
    expect(buildTerminalScreenFenceBlock([])).toBeNull()
  })

  it('is disabled on a screen that is only the agent\'s own prompt row surrounded by blanks', () => {
    // A screen where the sole content is a bare prompt glyph with nothing typed —
    // every row reduces to whitespace once trimmed, so there is nothing worth asking about.
    expect(buildTerminalScreenFenceBlock(['', '   ', ''])).toBeNull()
  })

  it('still sends a screen whose only real content is one prompt row', () => {
    // Distinguishes "blank" from "a prompt glyph" — the row has visible
    // content (not just whitespace), so it is not the degenerate case above.
    expect(buildTerminalScreenFenceBlock(['', '❯ ', ''])).toBe('```\n\n❯ \n```')
  })
})
