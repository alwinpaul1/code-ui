import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { agentHudLaunchFlag } from './agent-hud-launch-args'

const storage = vi.hoisted(() => ({
  items: new Map<string, string>(),
  getFails: false,
  removeFails: false
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (storage.getFails) {
        throw new Error('storage unreadable')
      }
      return storage.items.get(key) ?? null
    },
    setItem: async (key: string, value: string) => {
      storage.items.set(key, value)
    },
    removeItem: async (key: string) => {
      if (storage.removeFails) {
        throw new Error('write refused')
      }
      storage.items.delete(key)
    }
  }
}))

import { syncDesktopHudOnConnect } from './desktop-hud-connect-sync'

// The switch "Desktop agents report model and context" was removed on
// 2026-10-10: the beacon flags are always on. This is the key it stored under.
const OLD_KEY = 'desktopHudLaunchArgsEnabled'

function fakeHost(stored: Record<string, string>, hostPlatform: string) {
  let current = { ...stored }
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'settings.get') {
      return { ok: true, result: { agentDefaultArgs: { ...current } } }
    }
    if (method === 'status.get') {
      return { ok: true, result: { hostPlatform } }
    }
    current = { ...(params as { agentDefaultArgs: Record<string, string> }).agentDefaultArgs }
    return { ok: true, result: {} }
  })
  return { client: { sendRequest } as unknown as RpcClient, stored: () => current }
}

describe('the desktop beacon flags are always on', () => {
  beforeEach(() => {
    storage.items.clear()
    storage.getFails = false
    storage.removeFails = false
  })

  it('writes the flags on connect even when an older version stored "off"', async () => {
    storage.items.set(OLD_KEY, 'false')
    const host = fakeHost({ claude: '--verbose', codex: '' }, 'darwin')
    await syncDesktopHudOnConnect(host.client)
    expect(host.stored()).toEqual({
      claude: `--verbose ${agentHudLaunchFlag('claude', 'darwin')}`,
      codex: agentHudLaunchFlag('codex', 'darwin')
    })
  })

  it('deletes the stale "off" once it has been ignored', async () => {
    storage.items.set(OLD_KEY, 'false')
    await syncDesktopHudOnConnect(fakeHost({}, 'darwin').client)
    expect(storage.items.has(OLD_KEY)).toBe(false)
  })

  it('still writes the flags when storage is unreadable and refuses the delete', async () => {
    storage.items.set(OLD_KEY, 'false')
    storage.removeFails = true
    storage.getFails = true
    const host = fakeHost({}, 'linux')
    await syncDesktopHudOnConnect(host.client)
    expect(host.stored().claude).toContain(agentHudLaunchFlag('claude', 'linux'))
  })

  it('gives a Windows host no flag and takes one already saved there back out', async () => {
    const host = fakeHost({ claude: `--verbose ${agentHudLaunchFlag('claude', 'win32')}`, codex: '' }, 'win32')
    await syncDesktopHudOnConnect(host.client)
    expect(host.stored()).toEqual({ claude: '--verbose', codex: '' })
  })
})
