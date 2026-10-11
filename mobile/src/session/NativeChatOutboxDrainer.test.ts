// The root-mounted outbox drainer's triggers: it reads the stored outbox at start, and starts a
// fresh pass on every new connection to a host with messages waiting and every return of the app
// to the front (the user: "All messages must be send reliability and must not drop", 2026-10-11).
// The drainer itself is the real one; the desktop is a stub that takes every send.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  hydrateNativeChatOutbox,
  nativeChatOutboxEntries,
  resetNativeChatOutboxForTests,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import { releaseOutboxSend, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import type { OutboxDrainDeps } from './native-chat-outbox-drainer'

const harness = vi.hoisted(() => ({
  lastConnectedAt: null as number | null,
  appState: null as ((state: string) => void) | null
}))

vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_type: string, listener: (state: string) => void) => {
      harness.appState = listener
      return {
        remove: () => {
          harness.appState = null
        }
      }
    }
  }
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => harness.lastConnectedAt
}))
vi.mock('./native-chat-outbox-drain-deps', () => ({ nativeChatOutboxDrainDeps: {} }))

const { NativeChatOutboxDrainer } = await import('./NativeChatOutboxDrainer')

const client = { getState: () => 'connected' } as unknown as RpcClient

function stored(id: string, createdAt: number): NativeChatOutboxEntry {
  return {
    id,
    draftKey: 'h\0w\0tab-s',
    pendingKey: 'h\0w\0tab-s\0session-s',
    text: 'ship it',
    normalizedText: 'ship it',
    baselineOccurrences: 0,
    baselineTailMessageId: null,
    baselineResolved: true,
    createdAt,
    operationId: `op-${id}`,
    autoAttempts: 0,
    route: {
      hostId: 'h',
      worktreeId: 'w',
      tabId: 'tab-s',
      lane: 'session',
      agent: 'claude',
      sessionId: 'session-s',
      terminal: null,
      transcriptPath: null
    }
  }
}

describe('NativeChatOutboxDrainer', () => {
  let renderer: ReactTestRenderer | null = null
  let linkUp = true
  const sent: string[] = []

  const deps: OutboxDrainDeps = {
    now: () => Date.now(),
    connectedClient: () => (linkUp ? client : null),
    observe: async () => ({ kind: 'busy' }),
    send: async (_client, entry) => {
      sent.push(entry.id)
      return 'accepted'
    },
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    log: () => {}
  }

  beforeEach(() => {
    sent.length = 0
    linkUp = true
    harness.lastConnectedAt = null
    harness.appState = null
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
  })
  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    vi.clearAllTimers()
    vi.useRealTimers()
    resetNativeChatOutboxForTests()
    resetOutboxSendsForTests()
    await AsyncStorage.clear()
  })

  async function settle(ms = 1_000): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('sends what the last run left in the outbox when the app starts', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored('left', Date.now() - 60_000)]))
    act(() => {
      renderer = create(createElement(NativeChatOutboxDrainer, { deps }))
    })
    await settle()
    expect(sent).toEqual(['left'])
    expect(nativeChatOutboxEntries()).toEqual([])
  })

  it('sends on the next connection to the host, and on the app’s return to the front', async () => {
    vi.useFakeTimers()
    await AsyncStorage.setItem(
      'orca:chatOutbox',
      JSON.stringify([stored('one', Date.now() - 60_000), stored('two', Date.now() - 30_000)])
    )
    linkUp = false
    act(() => {
      renderer = create(createElement(NativeChatOutboxDrainer, { deps }))
    })
    await settle(5 * 60_000)
    expect(sent).toEqual([])

    // The host connects: the connection metric moves and the root's watch kicks a fresh pass.
    linkUp = true
    harness.lastConnectedAt = Date.now()
    act(() => {
      renderer!.update(createElement(NativeChatOutboxDrainer, { deps }))
    })
    await settle()
    expect(sent).toEqual(['one', 'two'])

    // Another entry waits with the link down; the app comes back to the front with it up.
    linkUp = false
    await AsyncStorage.clear()
    resetNativeChatOutboxForTests()
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored('three', Date.now())]))
    act(() => renderer?.unmount())
    renderer = null
    act(() => {
      renderer = create(createElement(NativeChatOutboxDrainer, { deps }))
    })
    await settle(5 * 60_000)
    expect(sent).toEqual(['one', 'two'])
    linkUp = true
    act(() => harness.appState?.('active'))
    await settle()
    expect(sent).toEqual(['one', 'two', 'three'])
  })

  it('stops with the tree: nothing more is sent, and a held send is no longer handed to it', async () => {
    vi.useFakeTimers()
    act(() => {
      renderer = create(createElement(NativeChatOutboxDrainer, { deps }))
    })
    await settle()
    act(() => renderer?.unmount())
    renderer = null
    await AsyncStorage.setItem('orca:chatOutbox', JSON.stringify([stored('late', Date.now())]))
    resetNativeChatOutboxForTests()
    await hydrateNativeChatOutbox()
    expect(nativeChatOutboxEntries().map((entry) => entry.id)).toEqual(['late'])
    // With no drainer, a routed entry's released send goes back to the old rules (no recovery: false).
    expect(releaseOutboxSend('late')).toBe(false)
    await settle(60_000)
    expect(sent).toEqual([])
  })
})
