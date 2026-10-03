import { describe, expect, it } from 'vitest'
import { isGestureSequenceWantedByProgram } from '../session/mobile-session-route-helpers'
import { GHOSTTY_MODE_BIT, terminalModesFromGhosttyMask } from './terminal-modes-from-ghostty-mask'

// Orca 1.4.219 (#23943) ends a desktop pane's screen copy with the mouse REPORT FORMAT its
// program chose: `?1006h` (SGR), `?1016h` (SGR pixels), or `?1006l` while tracking with the
// default format. Before, the copy kept tracking (`?1000h`/`?1002h`/`?1003h`) and dropped the
// format, so after an Orca restart libghostty held tracking with the default format for a program
// (Codex) that had asked for SGR, and the phone's swipe typed `ESC[M` bytes into its input box.
//
// This phone's Ghostty engine never scans those bytes in JS: libghostty reads them and reports
// the result as the `onModes` mask. Nothing in vitest can run libghostty, so `maskAfterReplay`
// below models only the rule these bytes rely on (DECSET/DECRST of 1000/1002/1003/1006, last one
// wins), and the assertions that matter are on the phone's own half: what it does with the mask.
const ESC = '\x1b'
const csi = (body: string) => `${ESC}[${body}`

// Shape of 1.4.219's pane copy for Codex: the alternate screen, every tracking mode, urxvt 1015,
// then the format last, after the final `?1049h`, so a reader that keeps only what follows it
// still has the format.
const CODEX_PANE_COPY = `shell prompt\r\n${csi('?1049h')}${csi('?1000h')}${csi('?1002h')}${csi('?1003h')}${csi('?1015h')}${csi('?1006h')}codex`
// A program that tracks with the default format: 1.4.219 now says so out loud.
const LEGACY_PANE_COPY = `${csi('?1049h')}${csi('?1000h')}${csi('?1002h')}${csi('?1003h')}legacy${csi('?1006l')}`
// The copy 1.4.217 and older desktop panes produced for Codex: tracking, no format at all.
const PRE_1_4_219_PANE_COPY = `${csi('?1049h')}${csi('?1000h')}${csi('?1002h')}${csi('?1003h')}codex`

function maskAfterReplay(bytes: string): number {
  let mask = 0
  const bit = (param: string): number =>
    param === '1000'
      ? GHOSTTY_MODE_BIT.normalMouse
      : param === '1002'
        ? GHOSTTY_MODE_BIT.buttonMouse
        : param === '1003'
          ? GHOSTTY_MODE_BIT.anyMouse
          : param === '1006'
            ? GHOSTTY_MODE_BIT.sgrMouse
            : param === '1049'
              ? GHOSTTY_MODE_BIT.altScreen
              : 0
  for (const match of bytes.matchAll(new RegExp(`${ESC}\\[\\?(\\d+)([hl])`, 'g'))) {
    mask = match[2] === 'h' ? mask | bit(match[1]!) : mask & ~bit(match[1]!)
  }
  return mask
}

const SGR_WHEEL_UP = csi('<64;10;10M')
// Default encoding: button byte 96 is wheel up (64 + 32), then column and row plus 32.
const LEGACY_WHEEL_UP = `${csi('M')}${String.fromCharCode(96, 42, 42)}`

describe('a swipe on a Codex terminal after Orca restarted, with the 1.4.219 pane copy', () => {
  it('reads SGR from a copy that ends in ?1006h, and lets only SGR wheel reports through', () => {
    const modes = terminalModesFromGhosttyMask(maskAfterReplay(CODEX_PANE_COPY))
    expect(modes.mouseTrackingMode).toBe('any')
    expect(modes.sgrMouseMode).toBe(true)
    expect(isGestureSequenceWantedByProgram(SGR_WHEEL_UP, modes)).toBe(true)
    expect(isGestureSequenceWantedByProgram(LEGACY_WHEEL_UP, modes)).toBe(false)
  })

  it('reads the default format from a copy that ends in ?1006l, and lets only legacy reports through', () => {
    const modes = terminalModesFromGhosttyMask(maskAfterReplay(LEGACY_PANE_COPY))
    expect(modes.mouseTrackingMode).toBe('any')
    expect(modes.sgrMouseMode).toBe(false)
    expect(isGestureSequenceWantedByProgram(LEGACY_WHEEL_UP, modes)).toBe(true)
    expect(isGestureSequenceWantedByProgram(SGR_WHEEL_UP, modes)).toBe(false)
  })

  it('keeps the format when the reader keeps only what follows the last alternate-screen switch', () => {
    const tail = CODEX_PANE_COPY.slice(CODEX_PANE_COPY.lastIndexOf(csi('?1049h')))
    expect(maskAfterReplay(tail) & GHOSTTY_MODE_BIT.sgrMouse).not.toBe(0)
  })

  it('a copy from before 1.4.219 still reads as the default format, the case the desktop fix removes', () => {
    // Why pinned: this is the shape that typed `[M` text into Codex. The phone cannot tell it from a
    // real default-format program, which is why the fix had to be on the desktop's copy.
    const modes = terminalModesFromGhosttyMask(maskAfterReplay(PRE_1_4_219_PANE_COPY))
    expect(modes.sgrMouseMode).toBe(false)
    expect(isGestureSequenceWantedByProgram(LEGACY_WHEEL_UP, modes)).toBe(true)
  })

  it('treats a plain shell as no mouse tracking and asks for no mouse report at all', () => {
    const modes = terminalModesFromGhosttyMask(maskAfterReplay('plain shell'))
    expect(modes.mouseTrackingMode).toBe('none')
    expect(isGestureSequenceWantedByProgram(SGR_WHEEL_UP, modes)).toBe(false)
    expect(isGestureSequenceWantedByProgram(LEGACY_WHEEL_UP, modes)).toBe(false)
  })

  it('an empty copy leaves every mouse report refused', () => {
    expect(maskAfterReplay('')).toBe(0)
    expect(isGestureSequenceWantedByProgram(SGR_WHEEL_UP, terminalModesFromGhosttyMask(0))).toBe(
      false
    )
  })
})
