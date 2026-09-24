import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persistMirrored, readMirroredStorage } from './mirrored-storage-keys'
import { saveHostDockWidth } from './preferences'

/**
 * A save the device's store took, followed by a read-back that failed.
 *
 * `persistMirrored` (#21977, ruling 35) reads each key back after writing it, so the mirror notes
 * what the store holds rather than what was asked for. Upstream chains that read onto the write,
 * so a rejected read rejects the save: the preference is on disk and its caller is told it is
 * not. The structured-send journal then reports "Message not sent" for an operation id it did
 * store, and the custom-key drawer stays open over a key it saved. Only the device's AsyncStorage
 * can do this: the page's adapter never rejects a read.
 *
 * Driven against a store that really rejects its reads, because the defect is in the failure
 * path and a store that answers can never reach it.
 */
const store = vi.hoisted(() => ({
  held: new Map<string, string>(),
  readsFail: false,
  writesFail: false
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: async (key: string, value: string) => {
      if (store.writesFail) {
        throw new Error('the store would not take it')
      }
      store.held.set(key, value)
    },
    removeItem: async (key: string) => {
      if (store.writesFail) {
        throw new Error('the store would not take it')
      }
      store.held.delete(key)
    },
    getItem: async (key: string) => {
      if (store.readsFail) {
        throw new Error('the store would not answer')
      }
      return store.held.get(key) ?? null
    },
    multiGet: async (keys: readonly string[]) =>
      keys.map((key) => [key, store.held.get(key) ?? null] as const)
  }
}))

const DOCK_WIDTH = 'orca:hostDockWidth'

let warned: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  store.held.clear()
  store.readsFail = false
  store.writesFail = false
  await persistMirrored(DOCK_WIDTH, '320')
  warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warned.mockRestore()
})

describe('a save whose read-back fails', () => {
  it('still resolves for its caller, because the store took the value', async () => {
    store.readsFail = true
    await expect(saveHostDockWidth(480)).resolves.toBeUndefined()
    expect(store.held.get(DOCK_WIDTH)).toBe('480')
  })

  it('notes the value the store took, so the next init is not one write behind', async () => {
    store.readsFail = true
    await persistMirrored(DOCK_WIDTH, '480')
    expect(readMirroredStorage([DOCK_WIDTH])[DOCK_WIDTH]).toBe('480')
  })

  it('drops a removed key from the mirror when the read-back of the removal fails', async () => {
    store.readsFail = true
    await persistMirrored(DOCK_WIDTH, null)
    expect(readMirroredStorage([DOCK_WIDTH])[DOCK_WIDTH]).toBeUndefined()
  })

  it('says which key it could not read back, rather than passing silently', async () => {
    store.readsFail = true
    await persistMirrored(DOCK_WIDTH, '480')
    expect(warned).toHaveBeenCalledWith(
      '[mirrored-storage] read-back failed after an accepted write',
      expect.objectContaining({ key: DOCK_WIDTH })
    )
  })

  it('still rejects a write the store refused, and leaves the mirror where it was', async () => {
    store.writesFail = true
    await expect(persistMirrored(DOCK_WIDTH, '480')).rejects.toThrow('would not take it')
    expect(readMirroredStorage([DOCK_WIDTH])[DOCK_WIDTH]).toBe('320')
  })
})
