import { beforeEach, describe, expect, it } from 'vitest'
import {
  isBackgroundLinkTaskParked,
  parkBackgroundLinkTask,
  releaseBackgroundLinkTask
} from './background-link-task-hold'

describe('the wake lock the background task holds', () => {
  beforeEach(() => releaseBackgroundLinkTask())

  it('is given up when background delivery is switched off', async () => {
    // Android holds a partial wake lock for the life of a headless task and
    // releases it only once the task finishes and the service stops. This
    // task parks forever on purpose so timers keep running with the screen
    // off, and its config carries no timeout, so without a way to end it the
    // lock outlives the work.
    let ended = false
    const parked = parkBackgroundLinkTask().parked.then(() => {
      ended = true
    })
    expect(isBackgroundLinkTaskParked()).toBe(true)
    expect(ended).toBe(false)

    releaseBackgroundLinkTask()
    await parked

    expect(ended).toBe(true)
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })

  it('does nothing when nothing is parked, so any caller may release', () => {
    expect(() => releaseBackgroundLinkTask()).not.toThrow()
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })

  it('never strands an earlier park behind a second one', async () => {
    const first = parkBackgroundLinkTask()
    const second = parkBackgroundLinkTask()

    // The first must already be settled; only the newest task may hold the lock.
    await expect(first.parked).resolves.toBeUndefined()

    releaseBackgroundLinkTask()
    await expect(second.parked).resolves.toBeUndefined()
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })

  // What the headless task's own cleanup calls. Releasing the park that was
  // already replaced must not reach the one that replaced it (2026-09-27: it
  // did, and the service stopped seconds after every open).
  it('lets a replaced park clean up without ending the park that replaced it', async () => {
    const first = parkBackgroundLinkTask()
    const second = parkBackgroundLinkTask()
    let secondEnded = false
    void second.parked.then(() => {
      secondEnded = true
    })

    first.release()
    await Promise.resolve()

    expect(secondEnded).toBe(false)
    expect(isBackgroundLinkTaskParked()).toBe(true)
    second.release()
    await second.parked
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })
})
