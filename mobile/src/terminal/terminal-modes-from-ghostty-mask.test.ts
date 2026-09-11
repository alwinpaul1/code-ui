import { describe, expect, it } from 'vitest'
import { GHOSTTY_MODE_BIT, terminalModesFromGhosttyMask } from './terminal-modes-from-ghostty-mask'

describe('what the program asked the terminal for, read from libghostty', () => {
  it('reads Claude Code 2.1.x as a mouse-driven alt-screen program', () => {
    // Recorded 2026-09-11: Claude Code's first chunk enables 1000, 1002, 1003
    // and 1006 and enters the alternate screen (captures/stage0-claude.json).
    const mask =
      GHOSTTY_MODE_BIT.normalMouse |
      GHOSTTY_MODE_BIT.buttonMouse |
      GHOSTTY_MODE_BIT.anyMouse |
      GHOSTTY_MODE_BIT.sgrMouse |
      GHOSTTY_MODE_BIT.altScreen

    expect(terminalModesFromGhosttyMask(mask)).toEqual({
      bracketedPasteMode: false,
      altScreen: true,
      mouseTrackingMode: 'any',
      sgrMouseMode: true,
      sgrMousePixelsMode: false
    })
  })

  it('reads Codex 0.153.4 as a main-screen program that scrolls its own history', () => {
    // Recorded 2026-09-11: no mouse mode, no alt screen; only 2026 and 25.
    expect(terminalModesFromGhosttyMask(0)).toEqual({
      bracketedPasteMode: false,
      altScreen: false,
      mouseTrackingMode: 'none',
      sgrMouseMode: false,
      sgrMousePixelsMode: false
    })
  })

  it('prefers the most specific tracking mode when several are on', () => {
    expect(
      terminalModesFromGhosttyMask(GHOSTTY_MODE_BIT.normalMouse | GHOSTTY_MODE_BIT.buttonMouse)
        .mouseTrackingMode
    ).toBe('drag')
    expect(terminalModesFromGhosttyMask(GHOSTTY_MODE_BIT.normalMouse).mouseTrackingMode).toBe(
      'vt200'
    )
  })

  it('does not mistake alt-scroll for mouse tracking', () => {
    const modes = terminalModesFromGhosttyMask(GHOSTTY_MODE_BIT.altScroll | GHOSTTY_MODE_BIT.altScreen)
    expect(modes.mouseTrackingMode).toBe('none')
    expect(modes.altScreen).toBe(true)
  })

  it('reports bracketed paste so a multi-line paste arrives as one block', () => {
    // Why: use-mobile-terminal-paste.ts wraps in ESC[200~ only on this flag;
    // reviewed 2026-09-11, the mask hardcoded it false and a pasted script ran
    // line by line.
    expect(terminalModesFromGhosttyMask(GHOSTTY_MODE_BIT.bracketedPaste).bracketedPasteMode).toBe(true)
    expect(terminalModesFromGhosttyMask(0).bracketedPasteMode).toBe(false)
  })
})
