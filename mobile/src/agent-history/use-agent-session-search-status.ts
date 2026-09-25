import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { RpcClient } from '../transport/rpc-client'
import { isMethodNotFoundRefusal } from '../transport/rpc-acceptance-policies'
import { isMobileScopeRefusal } from '../transport/mobile-scope-refusal'
import { agentSessionSearchStatusRead } from './agent-history-search-operations'
import {
  searchIndexNeedsPolling,
  searchIndexStateFromStatus,
  type SearchIndexState
} from './agent-history-search-index-state'

/** How often an off, building or paused index is asked again while the panel is on screen. */
export const SEARCH_STATUS_POLL_MS = 3_000
/** After a failed read: slow enough that a host answering errors is not hammered. */
export const SEARCH_STATUS_RETRY_MS = 30_000
const SEARCH_STATUS_TIMEOUT_MS = 15_000

type StatusParams = {
  client: RpcClient | null
  connected: boolean
  lastConnectedAt: number | null
}

/**
 * The host's search index status, kept current while the search panel is on screen.
 *
 * Orca pushes nothing when its owner turns search on: no `runtime.clientEvents` event on origin/main
 * (2026-09-25) carries a settings or session-search change. So the phone asks. While the panel is
 * focused and the app is in the foreground it reads `aiVault.searchStatus` on mount, on every new
 * connection, on return to the foreground and on focus, and again every SEARCH_STATUS_POLL_MS for as
 * long as the index is off, building or paused. A ready index stops the timer.
 *
 * A failed read never spins. It schedules one slow retry (SEARCH_STATUS_RETRY_MS) instead of the
 * poll, and a refusal meaning "no such method" reads as unsupported and stops asking at all.
 *
 * This is also what CLAUDE.md's reconnect rule asks of the status (a failed read must not outlive a
 * new connection): the read effect is keyed on `lastConnectedAt` itself, so every new connection
 * re-reads whatever the last reading was, once, from an effect that no reply can re-trigger.
 */
export function useAgentSessionSearchStatus({ client, connected, lastConnectedAt }: StatusParams): {
  index: SearchIndexState
  recheck: () => Promise<void>
} {
  const [index, setIndex] = useState<SearchIndexState>({ kind: 'checking' })
  const eligible = useSearchPanelOnScreen()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<{ client: RpcClient; promise: Promise<void> } | null>(null)
  const clientRef = useRef(client)
  const liveRef = useRef({ eligible, connected, mounted: true })
  const readRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    clientRef.current = client
    liveRef.current.eligible = eligible
    liveRef.current.connected = connected
  }, [client, eligible, connected])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const schedule = useCallback(
    (reading: SearchIndexState) => {
      clearTimer()
      const live = liveRef.current
      if (!live.mounted || !live.eligible || !live.connected) {
        return
      }
      const delay =
        reading.kind === 'unreadable'
          ? SEARCH_STATUS_RETRY_MS
          : searchIndexNeedsPolling(reading)
            ? SEARCH_STATUS_POLL_MS
            : null
      if (delay === null) {
        return
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void readRef.current()
      }, delay)
    },
    [clearTimer]
  )

  const read = useCallback((): Promise<void> => {
    if (!client) {
      return Promise.resolve()
    }
    if (inFlightRef.current?.client === client) {
      return inFlightRef.current.promise
    }
    clearTimer()
    const promise = readSearchIndexState(client).then((reading) => {
      if (inFlightRef.current?.promise === promise) {
        inFlightRef.current = null
      }
      // A reply for a client this screen has since let go of says nothing about the current host.
      if (!liveRef.current.mounted || clientRef.current !== client) {
        return
      }
      setIndex(reading)
      schedule(reading)
    })
    inFlightRef.current = { client, promise }
    return promise
  }, [client, clearTimer, schedule])

  useEffect(() => {
    readRef.current = read
  }, [read])

  useEffect(() => {
    if (!client || !connected || !eligible) {
      clearTimer()
      return
    }
    void read()
  }, [client, connected, lastConnectedAt, eligible, read, clearTimer])

  useEffect(() => {
    const live = liveRef.current
    live.mounted = true
    return () => {
      live.mounted = false
      clearTimer()
    }
  }, [clearTimer])

  return { index, recheck: read }
}

async function readSearchIndexState(client: RpcClient): Promise<SearchIndexState> {
  try {
    const reply = await agentSessionSearchStatusRead.request(
      client,
      {},
      { timeoutMs: SEARCH_STATUS_TIMEOUT_MS }
    )
    // An Orca older than search has no such method; one whose mobile allowlist predates it
    // refuses by scope. Both are "this host cannot say", not a failure worth retrying.
    if (isMethodNotFoundRefusal(reply) || isMobileScopeRefusal(reply)) {
      return { kind: 'unsupported' }
    }
    return searchIndexStateFromStatus(agentSessionSearchStatusRead.interpret(reply))
  } catch (error) {
    return {
      kind: 'unreadable',
      message: error instanceof Error && error.message ? error.message : 'No reply from the host.'
    }
  }
}

/**
 * True while the search panel is the focused screen and the app is in the foreground: the only
 * time a poll is worth its request. Focus comes from the router, so a screen pushed over this one
 * (a resumed session) stops the poll as surely as the app going to the background does.
 */
function useSearchPanelOnScreen(): boolean {
  const [focused, setFocused] = useState(false)
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active')

  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )

  useEffect(() => {
    setForeground(AppState.currentState === 'active')
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active')
    })
    return () => subscription.remove()
  }, [])

  return focused && foreground
}
