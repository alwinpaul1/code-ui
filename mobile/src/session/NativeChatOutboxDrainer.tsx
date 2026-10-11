import { createElement, Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import { AppState } from 'react-native'
import {
  hydrateNativeChatOutbox,
  nativeChatOutboxEntries,
  subscribeNativeChatOutbox
} from '../storage/native-chat-outbox'
import { useLastConnectedAt } from '../transport/client-context-connection-metrics'
import { createOutboxDrainer, type OutboxDrainDeps, type OutboxDrainer } from './native-chat-outbox-drainer'
import { nativeChatOutboxDrainDeps } from './native-chat-outbox-drain-deps'
import { mountOutboxDrainer } from './native-chat-outbox-sends'

function hostsWaiting(): string[] {
  const hosts = new Set<string>()
  for (const entry of nativeChatOutboxEntries()) {
    if (entry.route) {
      hosts.add(entry.route.hostId)
    }
  }
  return [...hosts].sort()
}

/** Kicks a fresh pass on every new connection to one host that has messages waiting. */
function HostConnectionKick(props: { hostId: string; drainer: OutboxDrainer }): null {
  const lastConnectedAt = useLastConnectedAt(props.hostId)
  const { drainer } = props
  useEffect(() => {
    if (lastConnectedAt !== null) {
      drainer.kick({ fresh: true })
    }
  }, [drainer, lastConnectedAt])
  return null
}

/**
 * The app-wide outbox drainer (native-chat-outbox-drainer.ts), mounted once inside the client
 * provider at the root of the app, so it runs whichever route, chat or tab is showing. It reads
 * the stored outbox at start, and starts a fresh pass on every new connection to a host with
 * messages waiting and every return of the app to the front.
 */
export function NativeChatOutboxDrainer(props: { deps?: OutboxDrainDeps }): ReactElement {
  const deps = useRef(props.deps ?? nativeChatOutboxDrainDeps).current
  const [drainer, setDrainer] = useState<OutboxDrainer | null>(null)
  const [hosts, setHosts] = useState<string[]>([])
  useEffect(() => {
    const unmount = mountOutboxDrainer()
    const created = createOutboxDrainer(deps)
    setDrainer(created)
    const refreshHosts = (): void => {
      const next = hostsWaiting()
      setHosts((previous) => (previous.join('\0') === next.join('\0') ? previous : next))
    }
    const unsubscribe = subscribeNativeChatOutbox(refreshHosts)
    let cancelled = false
    void hydrateNativeChatOutbox().then(() => {
      if (!cancelled) {
        refreshHosts()
        created.kick({ fresh: true })
      }
    })
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        created.kick({ fresh: true })
      }
    })
    return () => {
      cancelled = true
      appState.remove()
      unsubscribe()
      created.stop()
      unmount()
    }
  }, [deps])
  return createElement(
    Fragment,
    null,
    drainer ? hosts.map((hostId) => createElement(HostConnectionKick, { key: hostId, hostId, drainer })) : null
  )
}
