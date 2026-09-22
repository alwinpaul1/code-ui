import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, HostProfile } from '../transport/types'
import { publishLiveHostClient, reusableParkedHostClient } from '../transport/live-host-clients'

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
 * comes back, a live relay is handed over still open — closing it made the
 * screen dial again and show Reconnecting. A dead one is closed. A network
 * change while this watcher is listening replaces that relay here, so the
 * screen opens already connected.
 */
export type BackgroundNotificationWatcher = {
  setEnabled(enabled: boolean): void
  setUiVisible(visible: boolean): void
  isListening(): boolean
  /** The connected link this watcher listens to a host on, or null. A
   *  notification's Approve answers over a client, and the tap handler once
   *  looked only in the UI's registry — empty exactly when the watcher is the
   *  one listening (app in the background, 2026-09-18). Borrowed or owned,
   *  it is the link the banner's event came in on. */
  peekClient(hostId: string): RpcClient | null
  /** Replace the relay this watcher holds. The screen is not up to do it. */
  reconnectForNetworkChange(): void
  stop(): void
}

type BackgroundNotificationWatcherDependencies = {
  loadHosts: () => Promise<HostProfile[]>
  openClient: (host: HostProfile) => RpcClient
  subscribeNotifications: (client: RpcClient, hostId: string) => () => void
  /** The UI's live client for a host, if it holds one. Borrowing it instead of
   *  dialling beside it spares a redundant, billed relay session per background. */
  peekLiveClient?: (hostId: string) => RpcClient | null
  log: (message: string, detail?: string) => void
}

let backgroundRelayListening = false

/** True while this process, not the screen, is holding the relay. */
export function isBackgroundRelayListening(): boolean {
  return backgroundRelayListening
}

type HostLink = {
  client: RpcClient
  /** False for a client borrowed from the UI: unsubscribe on hand-back, never close. */
  owned: boolean
  /** One replace per drop. State events during that replace must not queue another. */
  replacing: boolean
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

  function noteListening(): void {
    backgroundRelayListening = shouldListen() && links.size > 0
  }

  function wire(host: HostProfile, client: RpcClient, owned: boolean): void {
    const link: HostLink = {
      client,
      owned,
      replacing: false,
      unsubscribeState: () => {},
      unsubscribeNotifications: null
    }
    const onState = (state: ConnectionState): void => {
      if (state === 'connected') {
        link.replacing = false
        link.unsubscribeNotifications ??= deps.subscribeNotifications(client, host.id)
        return
      }
      link.unsubscribeNotifications?.()
      link.unsubscribeNotifications = null
      // The screen still holds this socket. Dialling a second one left the
      // row on the dead socket while the new one connected in the background
      // (device, 2026-09-22). Ask this socket to replace itself. A rejected
      // login cannot, so that one gets a link of its own.
      if (!owned && links.get(host.id) === link && state === 'auth-failed') {
        link.unsubscribeState()
        links.delete(host.id)
        noteListening()
        if (shouldListen()) {
          void open()
        }
        return
      }
      if (!owned && links.get(host.id) === link && !link.replacing) {
        link.replacing = true
        client.notifyForeground('network-change')
      }
    }
    link.unsubscribeState = client.onStateChange(onState)
    links.set(host.id, link)
    onState(client.getState())
  }

  async function open(): Promise<void> {
    const opened = ++generation
    let hosts: HostProfile[]
    try {
      hosts = await deps.loadHosts()
    } catch (error) {
      deps.log('background link: host list unavailable', error instanceof Error ? error.message : '')
      if (opened === generation) {
        noteListening()
      }
      return
    }
    if (opened !== generation || !shouldListen()) {
      // A newer close or open owns the flag. Touching it here cleared a
      // relay the replacement had just borrowed.
      if (opened === generation) {
        noteListening()
      }
      return
    }
    for (const host of hosts) {
      if (links.has(host.id)) {
        continue
      }
      // Measured: dialling a second session beside the UI's retained relay was a
      // billed 2.3–2.8 s relay splice on every background, for a link the UI
      // already held. Ride the UI's connection whenever it has one up.
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
    noteListening()
  }

  function closeAll(): void {
    generation += 1
    const handOver = uiVisible
    if (links.size === 0) {
      noteListening()
      return
    }
    for (const [hostId, link] of links) {
      link.unsubscribeNotifications?.()
      link.unsubscribeState()
      if (!link.owned) {
        continue
      }
      // The screen adopts this socket. Closing it started a second dial.
      if (handOver && reusableParkedHostClient(link.client)) {
        publishLiveHostClient(hostId, link.client)
        continue
      }
      link.client.close()
    }
    links.clear()
    noteListening()
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
    peekClient(hostId) {
      const link = links.get(hostId)
      return link && link.client.getState() === 'connected' ? link.client : null
    },
    reconnectForNetworkChange() {
      if (!shouldListen()) {
        return
      }
      for (const link of links.values()) {
        link.client.notifyForeground('network-change')
      }
    },
    stop() {
      enabled = false
      closeAll()
    }
  }
}
