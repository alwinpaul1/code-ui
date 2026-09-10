import { describe, expect, it } from 'vitest'
import {
  FLOOR_RELEASE_RETRY_DELAYS_MS,
  releaseFloorUntilAccepted,
  shouldReleaseFloor
} from './mobile-terminal-floor-release'

describe('handing the desk back its floor', () => {
  it('owes a release for a terminal the phone drove at phone width', () => {
    expect(shouldReleaseFloor({ drivenHandles: new Set(['term-1']), handle: 'term-1' })).toBe(true)
  })

  it('owes nothing for a terminal the phone never drove', () => {
    // Releasing one it never took would narrow a terminal it does not own.
    expect(shouldReleaseFloor({ drivenHandles: new Set(['term-1']), handle: 'term-2' })).toBe(false)
    expect(shouldReleaseFloor({ drivenHandles: new Set(['term-1']), handle: null })).toBe(false)
  })

  it('retries a dropped hand-back, because nothing else will ask', async () => {
    // setDisplayMode opens with `if (!client) return false`, so a relay blip
    // drops the request silently — and showNativeChat does not change twice,
    // so the effect that would re-request never fires again.
    let attempts = 0

    const ok = await releaseFloorUntilAccepted({
      release: async () => ++attempts >= 3,
      wait: async () => undefined,
      isReclaimed: () => false
    })

    expect(ok).toBe(true)
    expect(attempts).toBe(3)
  })

  it('gives up eventually rather than retrying for the life of the app', async () => {
    let attempts = 0

    const ok = await releaseFloorUntilAccepted({
      release: async () => {
        attempts += 1
        return false
      },
      wait: async () => undefined,
      isReclaimed: () => false
    })

    expect(ok).toBe(false)
    expect(attempts).toBe(FLOOR_RELEASE_RETRY_DELAYS_MS.length)
  })

  it('does not treat a backgrounded app as the reader driving the terminal', async () => {
    // The regression this exists for: HOME leaves the terminal as the active
    // view with showNativeChat still false, so a reclaim check reading only
    // those two returns true instantly and the release never goes out.
    // Measured on device: COLS stayed 51 after HOME.
    let appIsForeground = false
    let attempts = 0

    const ok = await releaseFloorUntilAccepted({
      release: async () => {
        attempts += 1
        return true
      },
      wait: async () => undefined,
      isReclaimed: () => appIsForeground && true
    })

    expect(ok).toBe(true)
    expect(attempts).toBe(1)
    expect(appIsForeground).toBe(false)
  })

  it('abandons the moment the reader drives that terminal again', async () => {
    // A late release would pause the desk while the phone legitimately holds
    // the floor — the reader came straight back to the terminal.
    let attempts = 0
    let reclaimed = false

    const ok = await releaseFloorUntilAccepted({
      release: async () => {
        attempts += 1
        reclaimed = true
        return false
      },
      wait: async () => undefined,
      isReclaimed: () => reclaimed
    })

    expect(ok).toBe(false)
    expect(attempts).toBe(1)
  })
})
