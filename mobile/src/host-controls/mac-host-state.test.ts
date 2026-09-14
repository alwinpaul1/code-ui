import { describe, expect, it } from 'vitest'
import {
  MAC_HOST_STATE_PROBE_COMMAND,
  UNKNOWN_MAC_HOST_STATE,
  parseMacHostState
} from './mac-host-state'

describe('the Mac state probe command', () => {
  it('asks the two questions this Mac can actually answer', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGSSessionScreenIsLocked')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('output muted of (get volume settings)')
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

describe('reading the Mac state off the screen', () => {
  it('reads a locked Mac with its display off', () => {
    expect(parseMacHostState(['$ probe', 'CUIMAC lock=1 mute=true', '$ '])).toEqual({
      lock: 'locked',
      display: 'unknown',
      mute: 'muted'
    })
  })

  it('reads an awake, unlocked Mac', () => {
    expect(parseMacHostState(['CUIMAC lock=0 mute=false'])).toEqual({
      lock: 'unlocked',
      display: 'unknown',
      mute: 'unmuted'
    })
  })

  it('reads the other two combinations too', () => {
    expect(parseMacHostState(['CUIMAC lock=1 mute=false'])).toEqual({
      lock: 'locked',
      display: 'unknown',
      mute: 'unmuted'
    })
    expect(parseMacHostState(['CUIMAC lock=0 mute=true'])).toEqual({
      lock: 'unlocked',
      display: 'unknown',
      mute: 'muted'
    })
  })

  it('takes the last marker when the screen still holds an older one', () => {
    expect(
      parseMacHostState(['CUIMAC lock=1 mute=true', 'CUIMAC lock=0 mute=false'])
    ).toEqual({ lock: 'unlocked', display: 'unknown', mute: 'unmuted' })
  })

  it('stays unknown rather than guessing when no marker was painted', () => {
    expect(parseMacHostState([])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['zsh: command not found: ioreg'])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['CUIMAC lock=2 mute=maybe'])).toEqual(UNKNOWN_MAC_HOST_STATE)
    // An older probe's line must not be read as an answer to this one.
    expect(parseMacHostState(['CUIMAC lock=0 display=on'])).toEqual(UNKNOWN_MAC_HOST_STATE)
  })
})

describe('what the probe is willing to ask', () => {
  it('never asks for display state, because the only honest source took 28 seconds', () => {
    // 2026-09-14, from the phone: every Mac row showed at once on an unlocked,
    // unmuted Mac. `pmset -g log` dumps the whole power log — measured at 28s
    // against a 4s budget — so the probe always timed out and lock and mute,
    // which answer in about a second each, were lost with it.
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('pmset')
    expect(MAC_HOST_STATE_PROBE_COMMAND).not.toContain('log show')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGSSessionScreenIsLocked')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('output muted of (get volume settings)')
  })

  it('answers display as unknown, so both display rows are offered', () => {
    expect(parseMacHostState(['CUIMAC lock=0 mute=false']).display).toBe('unknown')
  })
})
