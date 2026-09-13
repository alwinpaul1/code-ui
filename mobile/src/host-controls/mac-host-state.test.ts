import { describe, expect, it } from 'vitest'
import {
  MAC_HOST_STATE_PROBE_COMMAND,
  UNKNOWN_MAC_HOST_STATE,
  parseMacHostState
} from './mac-host-state'

describe('the Mac state probe command', () => {
  it('asks the two questions this Mac can actually answer', () => {
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('CGSSessionScreenIsLocked')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toContain('pmset -g log')
    expect(MAC_HOST_STATE_PROBE_COMMAND).toMatch(/; exit$/)
  })

  it('cannot be mistaken for its own echo on the screen', () => {
    // The shell paints the command line itself, so the printf format must not
    // match the marker the parser looks for.
    expect(parseMacHostState([MAC_HOST_STATE_PROBE_COMMAND])).toEqual(UNKNOWN_MAC_HOST_STATE)
  })
})

describe('reading the Mac state off the screen', () => {
  it('reads a locked Mac with its display off', () => {
    expect(parseMacHostState(['$ probe', 'CUIMAC lock=1 display=off', '$ '])).toEqual({
      lock: 'locked',
      display: 'off'
    })
  })

  it('reads an awake, unlocked Mac', () => {
    expect(parseMacHostState(['CUIMAC lock=0 display=on'])).toEqual({
      lock: 'unlocked',
      display: 'on'
    })
  })

  it('reads the other two combinations too', () => {
    expect(parseMacHostState(['CUIMAC lock=1 display=on'])).toEqual({
      lock: 'locked',
      display: 'on'
    })
    expect(parseMacHostState(['CUIMAC lock=0 display=off'])).toEqual({
      lock: 'unlocked',
      display: 'off'
    })
  })

  it('takes the last marker when the screen still holds an older one', () => {
    expect(
      parseMacHostState(['CUIMAC lock=1 display=off', 'CUIMAC lock=0 display=on'])
    ).toEqual({ lock: 'unlocked', display: 'on' })
  })

  it('stays unknown rather than guessing when no marker was painted', () => {
    expect(parseMacHostState([])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['zsh: command not found: ioreg'])).toEqual(UNKNOWN_MAC_HOST_STATE)
    expect(parseMacHostState(['CUIMAC lock=2 display=maybe'])).toEqual(UNKNOWN_MAC_HOST_STATE)
  })
})
