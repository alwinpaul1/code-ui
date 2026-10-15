import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "It must match the session when i open asap", for an already running tab too (2026-10-15): the
// app coming back to the foreground is one of the events that matches the open chat's tab to its
// Remote Control session at once, whatever back-off was recorded while the app was away. The OS
// signal reaches the app through the relay's revival triggers, so that is where it is wired.

const revival = vi.hoisted(() => ({ callback: null as null | ((reason: 'app-resume' | 'network-change') => void), onBackground: null as null | (() => void) }))
const links = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('./host-logical-client', () => ({ openHostLogicalClient: vi.fn() }))
vi.mock('./host-store', () => ({ loadHosts: async () => [], loadHostCatalog: async () => [] }))
vi.mock('./connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: (callback: (reason: 'app-resume' | 'network-change') => void, options?: { onBackground?: () => void }) => {
    revival.callback = callback
    revival.onBackground = options?.onBackground ?? null
    return () => {
      revival.callback = null
      revival.onBackground = null
    }
  }
}))
vi.mock('../session/ccr-link-registry', () => ({
  foregroundCcrLinks: () => links.calls.push('foreground'),
  pauseCcrLinks: () => links.calls.push('pause')
}))

import { RpcClientProvider } from './client-context'
import { ccrMayRun, ccrTriggerVersion, recordCcrFailure, resetCcrCacheForTests } from '../session/ccr-session-cache'

let renderer: ReactTestRenderer | null = null

beforeEach(async () => {
  resetCcrCacheForTests()
  links.calls = []
  await act(async () => {
    renderer = create(createElement(RpcClientProvider, null))
  })
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the app back in the foreground', () => {
  it('matches the open tab again at once: the back-off recorded while away no longer holds it', () => {
    recordCcrFailure('tab-1', 1, Date.now())
    const before = ccrTriggerVersion()
    revival.callback!('app-resume')
    expect(ccrMayRun('tab-1', 1)).toBe(true)
    expect(ccrTriggerVersion()).toBe(before + 1)
  })

  it('does not on a network change, which the relay reconnect (a new connection) already covers', () => {
    recordCcrFailure('tab-1', 1, Date.now())
    const before = ccrTriggerVersion()
    revival.callback!('network-change')
    expect(ccrMayRun('tab-1', 1)).toBe(false)
    expect(ccrTriggerVersion()).toBe(before)
  })
})

// Review 2026-10-15: retryCcrLinks() had no production caller, so a lost Anthropic stream stayed
// lost after the app came back, and the streams ran on with the app in the background.
describe('the Claude session streams', () => {
  it('close when the app goes to the background and resume when it comes back', () => {
    expect(revival.onBackground).not.toBeNull()
    revival.onBackground!()
    expect(links.calls).toEqual(['pause'])
    revival.callback!('app-resume')
    expect(links.calls).toEqual(['pause', 'foreground'])
  })

  it('are not restarted by a network change, which the relay reconnect covers', () => {
    revival.callback!('network-change')
    expect(links.calls).toEqual([])
  })
})
