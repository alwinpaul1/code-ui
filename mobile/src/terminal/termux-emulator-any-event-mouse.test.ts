import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const EMULATOR = join(
  __dirname,
  '../../packages/expo-termux-terminal/android/src/main/java/com/termux/terminal/TerminalEmulator.java'
)

/**
 * Device, 2026-09-21, Claude Code 2.1.278 on the Termux engine: a swipe walked
 * the prompt history and Claude Code printed "Scroll wheel is sending arrow
 * keys". The host snapshot replays xterm's ONE highest mouse mode, `?1003h`
 * (any-event), and upstream Termux maps 1003 to nothing, so the emulator saw
 * a program on the alternate screen with no mouse tracking and sent arrows.
 * The vendored emulator has no JVM test harness in this repo, so the fix is
 * pinned at the source: the DECSET table must give 1003 a bit and the
 * tracking predicate must read it. Matches code, not comments.
 */
describe('the vendored Termux emulator treats any-event mouse tracking as mouse tracking', () => {
  const source = readFileSync(EMULATOR, 'utf8')

  it('maps DECSET 1003 to its own bit', () => {
    expect(source).toMatch(/case 1003:\s*\n\s*return DECSET_BIT_MOUSE_TRACKING_ANY_EVENT;/)
    expect(source).toMatch(/private static final int DECSET_BIT_MOUSE_TRACKING_ANY_EVENT = 1 << \d+;/)
  })

  it('counts that bit as mouse tracking, so a swipe becomes wheel reports', () => {
    const predicate = /public boolean isMouseTrackingActive\(\) \{\s*\n\s*return ([^;]+);/.exec(source)?.[1] ?? ''
    expect(predicate).toContain('DECSET_BIT_MOUSE_TRACKING_ANY_EVENT')
  })

  it('exposes it to the host as the "any" mode the app already knows', () => {
    expect(source).toMatch(/public boolean isMouseAnyEventTrackingActive\(\) \{\s*\n\s*return isDecsetInternalBitSet\(DECSET_BIT_MOUSE_TRACKING_ANY_EVENT\);/)
  })
})
