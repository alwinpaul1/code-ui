import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { TASK_SOURCES_READ_FAILED, type HomeTaskSources } from './home-task-sources'

// AccountUsage draws with react-native; only its decoder is reached here, and not by these reads.
vi.mock('../components/AccountUsage', () => ({ decodeAccountsSnapshot: (value: unknown) => value }))

import { fetchMobileHomeTaskProviders } from './mobile-home-host-requests'

/**
 * Home's Tasks card, from the three reads that say which task sources a desktop has. A refused
 * read wrote ['github'], so the card claimed GitHub, with its icon, until the next new connection
 * for a user whose visible providers were GitLab and Linear only (review, 2026-09-30). The fix
 * left a failed read as "not read yet", which the card drew as "Checking sources…" with nothing
 * checking; a failed read is now marked as one (review round 3).
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
function providersStore(initial: Record<string, HomeTaskSources>) {
  let value = initial
  const set = vi.fn(
    (
      updater: (previous: Record<string, HomeTaskSources>) => Record<string, HomeTaskSources>
    ) => {
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
  it('says the read failed, never GitHub, when the read is dropped', async () => {
    const store = providersStore({})
    const refused = clientAnswering({
      'settings.get': async () => {
        throw new Error('Connection interrupted')
      }
    })
    fetchMobileHomeTaskProviders(refused, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: TASK_SOURCES_READ_FAILED })
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

/**
 * The same false claim, reached by an answer rather than a dropped link. A desktop that replies
 * { ok:false } to a read has not said which sources it has; `interpret` reads that as "not
 * accepted", and falling back to {} or null let GitHub (which needs no setup) stand in for an
 * answer nobody gave (review round 2, 2026-09-30).
 */
function refusedReply(code: string, message: string) {
  return async () => ({ id: 'r', ok: false, error: { code, message } })
}

describe('the task sources Home reads when the desktop answers with a refusal', () => {
  it('says the read failed, never GitHub, when the desktop refuses all three reads', async () => {
    const store = providersStore({})
    const refusedAll = clientAnswering({
      'settings.get': refusedReply('internal_error', 'boom'),
      'preflight.check': refusedReply('internal_error', 'boom'),
      'linear.status': refusedReply('internal_error', 'boom')
    })
    fetchMobileHomeTaskProviders(refusedAll, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: TASK_SOURCES_READ_FAILED })
  })

  it('says the read failed when only the settings read is refused', async () => {
    const store = providersStore({})
    const settingsRefused = clientAnswering({
      ...GITLAB_AND_LINEAR,
      'settings.get': refusedReply('internal_error', 'settings store locked')
    })
    fetchMobileHomeTaskProviders(settingsRefused, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: TASK_SOURCES_READ_FAILED })
  })

  it('keeps GitLab and Linear when only the Linear status read is refused', async () => {
    const store = providersStore({ mac: ['gitlab', 'linear'] })
    const linearRefused = clientAnswering({
      ...GITLAB_AND_LINEAR,
      'linear.status': refusedReply('internal_error', 'keychain unavailable')
    })
    fetchMobileHomeTaskProviders(linearRefused, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: ['gitlab', 'linear'] })
  })

  it('does not drop GitLab, and says the read failed, when the tooling check alone is refused beside two good reads', async () => {
    const store = providersStore({})
    const preflightRefused = clientAnswering({
      ...GITLAB_AND_LINEAR,
      'preflight.check': refusedReply('timeout', 'glab --version did not answer')
    })
    fetchMobileHomeTaskProviders(preflightRefused, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: TASK_SOURCES_READ_FAILED })
  })

  it('keeps the sources it read last when a later round is refused in-band', async () => {
    const store = providersStore({ mac: ['gitlab', 'linear'] })
    const refusedAll = clientAnswering({
      'settings.get': refusedReply('internal_error', 'boom'),
      'preflight.check': refusedReply('internal_error', 'boom'),
      'linear.status': refusedReply('internal_error', 'boom')
    })
    fetchMobileHomeTaskProviders(refusedAll, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: ['gitlab', 'linear'] })
  })

  it('names each refused read and its error code in one log line', async () => {
    const refusedTwo = clientAnswering({
      ...GITLAB_AND_LINEAR,
      'preflight.check': refusedReply('timeout', 'glab --version did not answer'),
      'linear.status': refusedReply('internal_error', 'keychain unavailable')
    })
    fetchMobileHomeTaskProviders(refusedTwo, 'mac', providersStore({}).set, () => false)
    await settle()
    const warned = vi.mocked(console.warn).mock.calls
    expect(warned).toHaveLength(1)
    const line = JSON.stringify(warned[0])
    expect(line).toContain('preflight.check')
    expect(line).toContain('timeout')
    expect(line).toContain('linear.status')
    expect(line).toContain('internal_error')
    expect(line).not.toContain('settings.get')
  })
})

/**
 * A read that ended without an answer, kept apart from one that has not answered yet. Both were
 * "no entry", so the card said "Checking sources…" for as long as the desktop stayed connected
 * after a read had already failed (review round 3, 2026-09-30).
 */
describe('the task sources Home records when a read fails', () => {
  it('says the read failed when a desktop has no tooling check to answer with', async () => {
    const store = providersStore({})
    const noSuchMethod = clientAnswering({
      ...GITLAB_AND_LINEAR,
      'preflight.check': refusedReply('method_not_found', 'Unknown method: preflight.check')
    })
    fetchMobileHomeTaskProviders(noSuchMethod, 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: TASK_SOURCES_READ_FAILED })
  })

  it('names the sources once a later read answers after a failed one', async () => {
    const store = providersStore({ mac: TASK_SOURCES_READ_FAILED })
    fetchMobileHomeTaskProviders(clientAnswering(GITLAB_AND_LINEAR), 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: ['gitlab', 'linear'] })
  })

  it('keeps an empty list it read, rather than calling it failed, when a later read fails', async () => {
    const store = providersStore({ mac: [] })
    fetchMobileHomeTaskProviders(clientAnswering({}), 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ mac: [] })
  })

  it('marks only the desktop whose read failed', async () => {
    const store = providersStore({ studio: ['github'] })
    fetchMobileHomeTaskProviders(clientAnswering({}), 'mac', store.set, () => false)
    await settle()
    expect(store.read()).toEqual({ studio: ['github'], mac: TASK_SOURCES_READ_FAILED })
  })

  it('marks nothing once the screen that asked has gone', async () => {
    const store = providersStore({})
    fetchMobileHomeTaskProviders(clientAnswering({}), 'mac', store.set, () => true)
    await settle()
    expect(store.set).not.toHaveBeenCalled()
    const refusedLate = clientAnswering({
      ...GITLAB_AND_LINEAR,
      'linear.status': refusedReply('internal_error', 'boom')
    })
    fetchMobileHomeTaskProviders(refusedLate, 'mac', store.set, () => true)
    await settle()
    expect(store.set).not.toHaveBeenCalled()
  })
})
