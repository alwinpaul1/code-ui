// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isGestureSequenceWantedByProgram } from '../session/mobile-session-route-helpers'
import type { TerminalModes } from './terminal-webview-contract'
import { ESC, useTerminalMouseWebViewHarness } from './terminal-webview-mouse-test-harness'

// Orca 1.4.219 (#23943) ends a desktop pane's screen copy with the mouse REPORT FORMAT its
// program chose: `?1006h` (SGR), `?1016h` (SGR pixels), or `?1006l` while tracking with the
// default format. Before, the copy kept tracking and dropped the format, so after an Orca restart
// the phone held tracking with the default format for a program (Codex) that had asked for SGR,
// and a swipe typed `ESC[M` bytes into its input box.
//
// The WebView document reads the format itself: xterm.js does not expose the mouse encoding, so
// `updateMouseModeFromData` scans the snapshot for DECSET/DECRST 1006 and 1016 and the `modes`
// notify carries the result to the session. Tracking comes from xterm's own parse, which the
// harness's terminal stub does not run, so each case sets it the way a real parse would leave it
// and pins the half this document owns: what format it reports for the copy it was given.
// (This replaces the pin the removed Ghostty engine had, which read libghostty's mode mask.)
const csi = (body: string) => `${ESC}[${body}`

const CODEX_PANE_COPY = `shell prompt\r\n${csi('?1049h')}${csi('?1000h')}${csi('?1002h')}${csi('?1003h')}${csi('?1015h')}${csi('?1006h')}codex`
const LEGACY_PANE_COPY = `${csi('?1049h')}${csi('?1006h')}${csi('?1000h')}${csi('?1002h')}${csi('?1003h')}legacy${csi('?1006l')}`
const PRE_1_4_219_PANE_COPY = `${csi('?1049h')}${csi('?1000h')}${csi('?1002h')}${csi('?1003h')}codex`
const PIXELS_PANE_COPY = `${csi('?1049h')}${csi('?1003h')}${csi('?1006h')}${csi('?1016h')}pixels`

const SGR_WHEEL_UP = csi('<64;10;10M')
const LEGACY_WHEEL_UP = `${csi('M')}${String.fromCharCode(96, 42, 42)}`

describe('a swipe on a Codex terminal after Orca restarted, with the 1.4.219 pane copy', () => {
  const doc = useTerminalMouseWebViewHarness()

  /**
   * The modes the session holds after the document replayed `copy`: the last `modes` notify, or
   * the all-off defaults when the copy changed nothing and so the document said nothing.
   */
  function modesAfterReplay(copy: string): TerminalModes {
    doc.boot(copy)
    const notices = doc.postedMessages().filter((message) => message.type === 'modes')
    return {
      bracketedPasteMode: false,
      altScreen: false,
      mouseTrackingMode: 'none',
      sgrMouseMode: false,
      sgrMousePixelsMode: false,
      ...(notices.at(-1) as Partial<TerminalModes> | undefined)
    }
  }

  it('reads SGR from a copy that ends in ?1006h, and lets only SGR wheel reports through', () => {
    const modes = modesAfterReplay(CODEX_PANE_COPY)
    expect(modes.sgrMouseMode).toBe(true)
    const tracking = { ...modes, mouseTrackingMode: 'any' as const }
    expect(isGestureSequenceWantedByProgram(SGR_WHEEL_UP, tracking)).toBe(true)
    expect(isGestureSequenceWantedByProgram(LEGACY_WHEEL_UP, tracking)).toBe(false)
  })

  it('reads the default format from a copy that ends in ?1006l, and lets only legacy reports through', () => {
    const modes = modesAfterReplay(LEGACY_PANE_COPY)
    expect(modes.sgrMouseMode).toBe(false)
    const tracking = { ...modes, mouseTrackingMode: 'any' as const }
    expect(isGestureSequenceWantedByProgram(LEGACY_WHEEL_UP, tracking)).toBe(true)
    expect(isGestureSequenceWantedByProgram(SGR_WHEEL_UP, tracking)).toBe(false)
  })

  it('reads SGR pixels from a copy that ends in ?1016h', () => {
    const modes = modesAfterReplay(PIXELS_PANE_COPY)
    expect(modes.sgrMousePixelsMode).toBe(true)
    expect(modes.sgrMouseMode).toBe(false)
  })

  it('reads the format when the copy is cut so only what follows the last alternate-screen switch survives', () => {
    const tail = CODEX_PANE_COPY.slice(CODEX_PANE_COPY.lastIndexOf(csi('?1049h')))
    expect(modesAfterReplay(tail).sgrMouseMode).toBe(true)
  })

  it('a copy from before 1.4.219 still reads as the default format, the case the desktop fix removes', () => {
    // Why pinned: this is the shape that typed `[M` text into Codex. The phone cannot tell it from a
    // real default-format program, which is why the fix had to be on the desktop's copy.
    const modes = modesAfterReplay(PRE_1_4_219_PANE_COPY)
    expect(modes.sgrMouseMode).toBe(false)
  })

  it('treats a plain shell as no SGR format and asks for no mouse report at all', () => {
    const modes = modesAfterReplay('plain shell')
    expect(modes.sgrMouseMode).toBe(false)
    const none = { ...modes, mouseTrackingMode: 'none' as const }
    expect(isGestureSequenceWantedByProgram(SGR_WHEEL_UP, none)).toBe(false)
    expect(isGestureSequenceWantedByProgram(LEGACY_WHEEL_UP, none)).toBe(false)
  })
})
