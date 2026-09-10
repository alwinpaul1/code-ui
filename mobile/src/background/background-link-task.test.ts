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
})
