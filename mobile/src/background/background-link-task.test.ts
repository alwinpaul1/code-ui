import { beforeEach, describe, expect, it, vi } from 'vitest'

let registered: (() => (data: unknown) => Promise<void>) | null = null

vi.mock('react-native', () => ({
  AppRegistry: {
    registerHeadlessTask: vi.fn((_key: string, provider: () => (d: unknown) => Promise<void>) => {
      registered = provider
    })
  }
}))

vi.mock('@codeui/expo-background-link', () => ({ BACKGROUND_LINK_TASK_KEY: 'CodeUIBackgroundLink' }))

const syncBackgroundLinkFromPreferences = vi.fn(async () => true)
vi.mock('./background-link', () => ({
  syncBackgroundLinkFromPreferences: () => syncBackgroundLinkFromPreferences()
}))

await import('./background-link-task')
const { isBackgroundLinkTaskParked, releaseBackgroundLinkTask } = await import(
  './background-link-task-hold'
)

function runTask(): Promise<void> {
  if (!registered) {
    throw new Error('the headless task was never registered')
  }
  return registered()({})
}

describe('the background task Android holds a wake lock for', () => {
  beforeEach(() => {
    releaseBackgroundLinkTask()
    syncBackgroundLinkFromPreferences.mockReset()
  })

  it('ends instead of parking when the startup sync throws', async () => {
    // A task that neither returns nor rejects cleanly leaves Android holding a
    // partial wake lock with nothing running behind it. Its config carries no
    // timeout, so nothing else would ever end it.
    syncBackgroundLinkFromPreferences.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(runTask()).resolves.toBeUndefined()
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })

  it('ends immediately when delivery is already switched off', async () => {
    syncBackgroundLinkFromPreferences.mockResolvedValueOnce(false)

    await expect(runTask()).resolves.toBeUndefined()
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })

  it('stays parked while delivery is on, so timers keep running with the screen off', async () => {
    syncBackgroundLinkFromPreferences.mockResolvedValueOnce(true)
    let ended = false
    const task = runTask().then(() => {
      ended = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(isBackgroundLinkTaskParked()).toBe(true)
    expect(ended).toBe(false)

    releaseBackgroundLinkTask()
    await task

    expect(ended).toBe(true)
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })

  /**
   * The service dying seconds after every open (a Pixel on 0.9.54, 2026-09-27:
   * "Nothing ran for 1h 0m … background service not running" every hour all
   * night). The native service started a SECOND link task while the first was
   * still parked. The second park released the first, as it should, and then
   * the first task's `finally` released whatever was parked, which by then
   * was the second. Both tasks ended, the service saw no task left and
   * stopped itself.
   */
  it('a second headless start while one is parked leaves exactly one task parked', async () => {
    syncBackgroundLinkFromPreferences.mockResolvedValue(true)
    let firstEnded = false
    let secondEnded = false
    const first = runTask().then(() => {
      firstEnded = true
    })
    await flushMicrotasks()
    const second = runTask().then(() => {
      secondEnded = true
    })
    await flushMicrotasks()

    // The first is let go so it cannot hold the lock forever; the second must
    // stay parked, or nothing keeps the service alive.
    expect(firstEnded).toBe(true)
    expect(secondEnded).toBe(false)
    expect(isBackgroundLinkTaskParked()).toBe(true)

    releaseBackgroundLinkTask()
    await Promise.all([first, second])
    expect(secondEnded).toBe(true)
    expect(isBackgroundLinkTaskParked()).toBe(false)
  })

  // The failure path of the same shape: a task that never parked must not end
  // one that did on its way out.
  it('a start whose sync throws leaves the task already parked alone', async () => {
    syncBackgroundLinkFromPreferences.mockResolvedValueOnce(true)
    let parkedEnded = false
    const parked = runTask().then(() => {
      parkedEnded = true
    })
    await flushMicrotasks()

    syncBackgroundLinkFromPreferences.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(runTask()).resolves.toBeUndefined()
    await flushMicrotasks()

    expect(parkedEnded).toBe(false)
    expect(isBackgroundLinkTaskParked()).toBe(true)

    releaseBackgroundLinkTask()
    await parked
    expect(parkedEnded).toBe(true)
  })
})

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve()
  }
}
