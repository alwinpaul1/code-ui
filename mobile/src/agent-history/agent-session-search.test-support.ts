import { useEffect, useSyncExternalStore } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { HostProfile } from '../transport/types'
import type { AgentSessionSearchHit, AgentSessionSearchStatus } from './agent-history-search-reply-schema'

/**
 * Doubles for the session-search suites: the host's replies, and the three things outside the
 * panel that decide when it asks (screen focus, app foreground, and which connection is current).
 *
 * The three are module singletons because a `vi.mock` factory runs when the panel is first
 * imported, ahead of anything the suite declares; a suite imports this file first and resets them
 * in `afterEach`.
 */

/** A hit as the relay delivers it to a paired client: source redacted to `{ presence }`. */
export function searchHit(overrides: Partial<AgentSessionSearchHit> = {}): AgentSessionSearchHit {
  return {
    agent: 'claude',
    sessionId: 'session-1',
    title: 'Implement vault filters',
    cwd: '/Users/ada/repo/app',
    branch: 'feature/vault',
    updatedAt: '2026-06-28T23:55:00.000Z',
    messageCount: 3,
    score: 1.5,
    source: { presence: 'present' },
    evidence: {
      snippet: 'add the [[scope]] tabs to the vault',
      role: 'user',
      timestamp: null
    },
    ...overrides
  }
}

export function searchResults(
  hits: readonly AgentSessionSearchHit[],
  page: { cursor?: string | null; hasMore?: boolean; truncated?: boolean } = {}
): Record<string, unknown> {
  const cursor = page.cursor ?? null
  return {
    kind: 'results',
    hits,
    page: { cursor, hasMore: page.hasMore ?? cursor !== null },
    generation: 4,
    truncated: {
      candidates: page.truncated ?? false,
      snippets: 0,
      query: false,
      freshness: false
    }
  }
}

/** A ready index, so a suite states only what it changes. */
export function searchStatus(overrides: Partial<AgentSessionSearchStatus> = {}): AgentSessionSearchStatus {
  return {
    enabled: true,
    phase: 'ready',
    filesIndexed: 40,
    filesDue: 0,
    filesFailed: 0,
    messagesIndexed: 3400,
    degradedRoots: [],
    generation: 4,
    ...overrides
  }
}

type Listener = () => void

/** A value a suite changes from outside React, read by the mocked hook through a subscription. */
export function createExternalValue<T>(initial: T): {
  get: () => T
  set: (next: T) => void
  reset: () => void
  useValue: () => T
} {
  let value = initial
  const listeners = new Set<Listener>()
  const subscribe = (listener: Listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  return {
    get: () => value,
    set(next) {
      value = next
      for (const listener of Array.from(listeners)) {
        listener()
      }
    },
    reset() {
      value = initial
    },
    useValue: () => useSyncExternalStore(subscribe, () => value)
  }
}

type FocusEffect = () => void | (() => void)

/**
 * expo-router's `useFocusEffect`, with focus a suite can take away: the effect runs while the
 * screen is focused and its cleanup runs on blur, as the router's does.
 */
export function createFocusDouble(): {
  useFocusEffect: (effect: FocusEffect) => void
  setFocused: (focused: boolean) => void
  reset: () => void
} {
  let focused = true
  const appliers = new Set<(focused: boolean) => void>()
  return {
    useFocusEffect(effect) {
      useEffect(() => {
        let active = false
        let cleanup: (() => void) | undefined
        const apply = (next: boolean) => {
          if (next && !active) {
            active = true
            cleanup = effect() ?? undefined
          } else if (!next && active) {
            active = false
            cleanup?.()
            cleanup = undefined
          }
        }
        apply(focused)
        appliers.add(apply)
        return () => {
          appliers.delete(apply)
          apply(false)
        }
      }, [effect])
    },
    setFocused(next) {
      focused = next
      for (const apply of Array.from(appliers)) {
        apply(next)
      }
    },
    reset() {
      focused = true
      appliers.clear()
    }
  }
}

type AppStateListener = (state: string) => void

/** React Native's `AppState`, with a suite able to send the app to the background and back. */
export function createAppStateDouble(): {
  AppState: {
    currentState: string
    addEventListener: (type: string, listener: AppStateListener) => { remove: () => void }
  }
  emit: (state: string) => void
  reset: () => void
} {
  const listeners = new Set<AppStateListener>()
  const appState = {
    currentState: 'active',
    addEventListener: (_type: string, listener: AppStateListener) => {
      listeners.add(listener)
      return {
        remove: () => {
          listeners.delete(listener)
        }
      }
    }
  }
  return {
    AppState: appState,
    emit(state) {
      appState.currentState = state
      for (const listener of Array.from(listeners)) {
        listener(state)
      }
    },
    reset() {
      appState.currentState = 'active'
      listeners.clear()
    }
  }
}

export const searchFocus = createFocusDouble()
export const searchAppState = createAppStateDouble()
/** `useLastConnectedAt`: a suite moves it to stand for a new connection. */
export const searchLastConnectedAt = createExternalValue<number | null>(1_000)
/** `useHostClient`: which client the screen holds and whether it is connected. */
export const searchHostConnection = createExternalValue<{ client: RpcClient | null; state: string }>({
  client: null,
  state: 'connected'
})
/** What `loadHosts` answers: the paired hosts the phone has stored. */
export const searchStoredHosts = createExternalValue<HostProfile[]>([])

/** A paired host as the store keeps it. The token is a fixed placeholder, never a real one. */
export function storedHost(id: string, name: string): HostProfile {
  return {
    id,
    name,
    endpoint: 'ws://192.168.1.20:6768',
    deviceToken: 'placeholder',
    publicKeyB64: 'placeholder',
    lastConnected: 0
  }
}
