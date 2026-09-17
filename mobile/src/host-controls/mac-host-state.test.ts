import { describe, expect, it } from 'vitest'
import {
  MAC_HOST_STATE_PROBE_COMMAND,
  UNKNOWN_MAC_HOST_STATE,
  parseMacHostState
} from './mac-host-state'

describe('the Mac state probe command', () => {
  it('asks the three questions this Mac can answer inside the budget', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGSSessionScreenIsLocked')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('output muted of (get volume settings)')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGDisplayIsAsleep')
    // 2026-09-13: with `; exit` the tab was gone before the first screen read, the
    // probe answered unknown, and the sheet offered every row on a Mac that had said
    // nothing of the sort. The probe closes the tab itself after reading.
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toMatch(/exit\s*$/)
  })

  it('cannot be mistaken for its own echo on the screen', () => {
    // The shell paints the command line itself, so the printf format must not
    // match the marker the parser looks for.
    expect(parseMacHostState([MAC_HOST_STATE_PROBE_COMMAND])).toEqual(UNKNOWN_MAC_HOST_STATE)
  })
})

/**
 * The fixtures are lines the probe actually painted on this Mac (macOS 26,
 * Apple Silicon, 2026-09-18), not paraphrases: `lock=1` because putting the
 * display to sleep to capture the `display=off` line locked the Mac too.
 */
describe('reading the Mac state off the screen', () => {
  it('reads a locked Mac with its display off', () => {
    expect(parseMacHostState(['$ probe', 'CUIMAC lock=1 mute=true display=off', '$ '])).toEqual({
      lock: 'locked',
      display: 'off',
      mute: 'muted'
    })
  })

  it('reads an awake, unlocked Mac', () => {
    expect(parseMacHostState(['CUIMAC lock=0 mute=false display=on'])).toEqual({
      lock: 'unlocked',
      display: 'on',
      mute: 'unmuted'
    })
  })

  it('reads a locked Mac whose display is still on', () => {
    expect(parseMacHostState(['CUIMAC lock=1 mute=false display=on'])).toEqual({
      lock: 'locked',
      display: 'on',
      mute: 'unmuted'
    })
  })

  it('takes the last marker when the screen still holds an older one', () => {
    expect(
      parseMacHostState([
        'CUIMAC lock=1 mute=true display=off',
        'CUIMAC lock=0 mute=false display=on'
      ])
    ).toEqual({ lock: 'unlocked', display: 'on', mute: 'unmuted' })
  })

  it('stays unknown rather than guessing when no marker was painted', () => {
    expect(parseMacHostState([])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['zsh: command not found: ioreg'])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['CUIMAC lock=2 mute=maybe display=dim'])).toEqual(
      UNKNOWN_MAC_HOST_STATE
    )
  })

  /**
   * A line from a build that did not ask about the display — an older phone's
   * probe still on the screen, or a Mac where the JXA call printed nothing — is
   * still two honest answers. Reading it as unknown throws lock and mute away
   * for a field that was never promised.
   */
  it('reads an older two-field line, leaving only the display unknown', () => {
    expect(parseMacHostState(['CUIMAC lock=0 mute=false'])).toEqual({
      lock: 'unlocked',
      display: 'unknown',
      mute: 'unmuted'
    })
  })
})

/**
 * Why the display can be asked now and could not before. On 2026-09-14 the only
 * source that answered correctly was `pmset -g log`, which dumps the entire power
 * log — 28 seconds against a 4-second budget — so the probe timed out and lock
 * and mute were lost with it. Both display rows showed on every Mac since.
 *
 * On 2026-09-18 the ioreg candidates were measured across a real display sleep:
 * IOMobileFramebuffer reads CurrentPowerState=1 awake AND asleep, and a full
 * device-tree diff showed no display node changing state within four seconds —
 * only the video decoder, camera and Neural Engine, which is background work.
 * A power-state proxy was never going to say it.
 *
 * CGDisplayIsAsleep is the CoreGraphics call that owns the answer. Reached
 * through JXA, which every Mac ships, it read awake / asleep / awake across the
 * same sleep and took 70 ms.
 */
describe('what the probe is willing to ask', () => {
  it('never reaches for the sources that blew the budget', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('pmset')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('log show')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('IOMobileFramebuffer')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('IODisplayWrangler')
  })

  it('asks CoreGraphics, which owns the answer', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGDisplayIsAsleep($.CGMainDisplayID())')
  })

  // The whole reason: "Wake display" was offered on a Mac whose display was on.
  it('answers display so only the applicable row is offered', () => {
    expect(parseMacHostState(['CUIMAC lock=0 mute=false display=on']).display).toBe('on')
    expect(parseMacHostState(['CUIMAC lock=0 mute=false display=off']).display).toBe('off')
  })
})
