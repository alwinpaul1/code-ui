import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, HostProfile } from '../transport/types'

/**
 * Owns the host connections while the UI is not on screen.
 *
 * Why it exists: the UI's connections live in the React tree, and Android
 * tears that tree down when the app is swiped out of Recents (and suspends
 * the relay 30 s after backgrounding either way). Agent notifications reach
 * the phone over those connections, so with the app closed nothing arrived.
 * This watcher is a module-level singleton driven from the foreground
 * service's headless task, so it survives both.
 *
 * Hand-over rule: it listens only while `enabled && !uiVisible`. When the UI
 * comes back it closes everything and the UI's own reconnect catch-up
 * (`notifications.getMissedSince`) covers the seam.
 */
export type BackgroundNotificationWatcher = {
  setEnabled(enabled: boolean): void
  setUiVisible(visible: boolean): void
  isListening(): boolean
  stop(): void
}

type BackgroundNotificationWatcherDependencies = {
  loadHosts: () => Promise<HostProfile[]>
  openClient: (host: HostProfile) => RpcClient
  subscribeNotifications: (client: RpcClient, hostId: string) => () => void
  /** The UI's live client for a host, if it holds one. Borrowing it instead of
   *  dialling beside it is what keeps the relay session — and the bytes in
   *  flight on it — across a background/foreground hand-back. */
  peekLiveClient?: (hostId: string) => RpcClient | null
  log: (message: string, detail?: string) => void
}

type HostLink = {
  client: RpcClient
  /** False for a client borrowed from the UI: unsubscribe on hand-back, never close. */
  owned: boolean
  unsubscribeState: () => void
  unsubscribeNotifications: (() => void) | null
}

export function createBackgroundNotificationWatcher(
  deps: BackgroundNotificationWatcherDependencies
): BackgroundNotificationWatcher {
  let enabled = false
  let uiVisible = true
  // Bumped on every close so a host list that resolves late opens nothing.
  let generation = 0
  const links = new Map<string, HostLink>()

  const shouldListen = (): boolean => enabled && !uiVisible

  function wire(host: HostProfile, client: RpcClient, owned: boolean): void {
    const link: HostLink = {
      client,
      owned,
      unsubscribeState: () => {},
      unsubscribeNotifications: null
    }
    const onState = (state: ConnectionState): void => {
      if (state === 'connected') {
        link.unsubscribeNotifications ??= deps.subscribeNotifications(client, host.id)
        return
      }
      link.unsubscribeNotifications?.()
      link.unsubscribeNotifications = null
    }
    link.unsubscribeState = client.onStateChange(onState)
    links.set(host.id, link)
    onState(client.getState())
  }

  async function open(): Promise<void> {
    if (links.size > 0) {
      return
    }
    const opened = ++generation
    let hosts: HostProfile[]
    try {
      hosts = await deps.loadHosts()
    } catch (error) {
      deps.log('background link: host list unavailable', error instanceof Error ? error.message : '')
      return
    }
    if (opened !== generation || !shouldListen()) {
      return
    }
    for (const host of hosts) {
      if (links.has(host.id)) {
        continue
      }
      // Measured: dialling a second session beside the UI's retained relay cost a
      // fresh 2.3–3.2 s dial on every return and lost whatever the PTY wrote in
      // the gap. Ride the UI's connection whenever it has one up.
      const live = deps.peekLiveClient?.(host.id) ?? null
      if (live && live.getState() === 'connected') {
        wire(host, live, false)
        continue
      }
      try {
        wire(host, deps.openClient(host), true)
      } catch (error) {
        deps.log(`background link: could not open ${host.name}`, error instanceof Error ? error.message : '')
      }
    }
    deps.log('background link: listening', `${links.size} host${links.size === 1 ? '' : 's'}`)
  }

  function closeAll(): void {
    generation += 1
    if (links.size === 0) {
      return
    }
    for (const link of links.values()) {
      link.unsubscribeNotifications?.()
      link.unsubscribeState()
      if (link.owned) {
        link.client.close()
      }
    }
    links.clear()
    deps.log('background link: handed back to the app')
  }

  function reconcile(): void {
    if (shouldListen()) {
      void open()
    } else {
      closeAll()
    }
  }

  return {
    setEnabled(next) {
      if (enabled === next) {
        return
      }
      enabled = next
      reconcile()
    },
    setUiVisible(next) {
      if (uiVisible === next) {
        return
      }
      uiVisible = next
      reconcile()
    },
    isListening: () => links.size > 0,
    stop() {
      enabled = false
      closeAll()
    }
  }
}
