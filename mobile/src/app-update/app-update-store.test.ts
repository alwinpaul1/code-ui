import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hydrateAppUpdateState, useAppUpdateStore } from './app-update-store'
import { performUpdateCheck } from './check-update'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(() => Promise.resolve())
  }
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }
}))

vi.mock('./check-update', async () => {
  const actual = await vi.importActual<typeof import('./check-update')>('./check-update')
  return {
    ...actual,
    performUpdateCheck: vi.fn()
  }
})

vi.mock('./installed-version', () => ({
  getInstalledVersion: vi.fn(() => '1.0.0'),
  getInstalledBuildNumber: vi.fn(() => '1')
}))

function makeDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('useAppUpdateStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppUpdateStore.setState({
      status: 'idle',
      latestVersion: null,
      latestBuildNumber: null,
      releaseNotes: null,
      updateUrl: null,
      dismissedUpdateId: null
    })
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null)
    vi.mocked(AsyncStorage.setItem).mockResolvedValue()
  })

  it('deduplicates overlapping update checks before storage resolves', async () => {
    const storageRead = makeDeferred<string | null>()
    vi.mocked(AsyncStorage.getItem).mockReturnValue(storageRead.promise)
    vi.mocked(performUpdateCheck).mockResolvedValue({ status: 'up-to-date' })

    const firstCheck = useAppUpdateStore.getState().checkForUpdate({ force: true })
    const secondCheck = useAppUpdateStore.getState().checkForUpdate({ force: true })

    expect(performUpdateCheck).not.toHaveBeenCalled()

    storageRead.resolve(null)
    await Promise.all([firstCheck, secondCheck])

    expect(performUpdateCheck).toHaveBeenCalledTimes(1)
    expect(useAppUpdateStore.getState().status).toBe('up-to-date')
  })

  it('shows a remembered update again on the next open, and forgets it once installed', async () => {
    const stored = {
      status: 'available',
      latestVersion: '9.9.9',
      latestBuildNumber: '99',
      updateUrl: 'https://x/apk',
      releaseUrl: 'https://x/rel'
    }
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))
    vi.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined)
    useAppUpdateStore.setState({ status: 'idle', latestVersion: null, dismissedUpdateId: null })
    await hydrateAppUpdateState()
    expect(useAppUpdateStore.getState().status).toBe('available')
    expect(useAppUpdateStore.getState().latestVersion).toBe('9.9.9')

    // "Later" hides it for this session only: nothing is written to storage.
    vi.mocked(AsyncStorage.setItem).mockClear()
    await useAppUpdateStore.getState().dismiss()
    expect(useAppUpdateStore.getState().status).toBe('up-to-date')
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()

    // An older remembered update than the installed build is dropped.
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify({ ...stored, latestVersion: '0.0.1', latestBuildNumber: '0' })
    )
    useAppUpdateStore.setState({ status: 'idle', latestVersion: null })
    await hydrateAppUpdateState()
    expect(useAppUpdateStore.getState().status).toBe('idle')
    expect(AsyncStorage.removeItem).toHaveBeenCalled()
  })
})
