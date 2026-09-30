import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { TaskProvider } from '../tasks/mobile-task-providers'

// AccountUsage draws with react-native; only its decoder is reached here, and not by these reads.
vi.mock('../components/AccountUsage', () => ({ decodeAccountsSnapshot: (value: unknown) => value }))

import { fetchMobileHomeTaskProviders } from './mobile-home-host-requests'

/**
 * Home's Tasks card, from the three reads that say which task sources a desktop has. A refused
 * read wrote ['github'], so the card claimed GitHub, with its icon, until the next new connection
 * for a user whose visible providers were GitLab and Linear only (review, 2026-09-30).
 */

type Replies = Record<string, () => Promise<unknown>>

function clientAnswering(replies: Replies): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string) => {
      const reply = replies[method]
      if (!reply) {
        throw new Error(`no reply scripted for ${method}`)
      }
      return reply()
    })
  } as unknown as RpcClient
}

/** The setter the Home hook hands over, applied to a store this test can read. */
function providersStore(initial: Record<string, TaskProvider[]>) {
  let value = initial
  const set = vi.fn(
    (updater: (previous: Record<string, TaskProvider[]>) => Record<string, TaskProvider[]>) => {
      value = updater(value)
    }
  )
  return { set, read: () => value }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const GITLAB_AND_LINEAR: Replies = {
  'settings.get': async () => ({
    ok: true,
    result: { settings: { visibleTaskProviders: ['gitlab', 'linear'] } }
  }),
  'preflight.check': async () => ({ ok: true, result: { glab: { installed: true } } }),
  'linear.status': async () => ({ ok: true, result: { connected: true } })
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the task sources Home reads for a desktop', () => {
  it('stays unread, never GitHub, when the read is refused', async () => {
    const store = providersStore({})
    const refused = clientAnswering({
      'settings.get': async () => {
        throw new Error('Connection interrupted')
      }
    })
    fetchMobileHomeTaskProviders(refused, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({})
  })

  it('keeps the sources it read last when a later read is refused', async () => {
    const store = providersStore({ mac: ['gitlab', 'linear'] })
    const refused = clientAnswering({})
    fetchMobileHomeTaskProviders(refused, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: ['gitlab', 'linear'] })
  })

  it('says in one line why the sources could not be read', async () => {
    const dropped = async () => {
      throw new Error('Connection interrupted')
    }
    const refused = clientAnswering({
      'settings.get': dropped,
      'preflight.check': dropped,
      'linear.status': dropped
    })
    fetchMobileHomeTaskProviders(refused, 'mac', providersStore({}).set, () => false)
    await settle()
    const warned = vi.mocked(console.warn).mock.calls
    expect(warned).toHaveLength(1)
    expect(JSON.stringify(warned[0])).toContain('Connection interrupted')
  })

  it('names the sources the desktop has once the read answers', async () => {
    const store = providersStore({})
    fetchMobileHomeTaskProviders(clientAnswering(GITLAB_AND_LINEAR), 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: ['gitlab', 'linear'] })
  })
})
