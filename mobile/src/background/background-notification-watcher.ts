import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, ForegroundNudgeReason, HostProfile } from '../transport/types'
import {
  handBackLiveHostClient,
  isLiveHostClientHeldByScreen,
  peekLiveHostClient,
  retireLiveHostClient,
  reusableParkedHostClient,
  subscribeLiveHostClientRetired
} from '../transport/live-host-clients'

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
 * Hand-over rule: it listens only while `enabled && !uiVisible`, and a host
 * has ONE client. The watcher borrows whatever client the host already has,
 * connected or not, and nudges it rather than dialling beside it. It dials its
 * own only when there is none, or when the one there is a dead parked socket
 * nobody holds. When the UI comes back, its own live client is parked for the
 * screen to take back — closing it made the screen dial again and show
 * Reconnecting — unless the screen already holds one, in which case it is
 * closed. A dead one is closed. A network change while this watcher is
 * listening replaces that relay here, so the screen opens already connected.
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
  log: (message: string, detail?: string) => void
}

let backgroundRelayListening = false

/** True while this process, not the screen, is holding the relay. */
export function isBackgroundRelayListening(): boolean {
  return backgroundRelayListening
}

type HostLink = {
  client: RpcClient
  /** False for the host's one client, borrowed from the screen or the parked
   *  registry: unsubscribe on hand-back. Closed only when it is a parked one
   *  that was rejected, since nothing else holds it. */
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

  // The holder closed or replaced a client this watcher borrowed: drop that
  // link and listen on whatever the host has now, or dial.
  subscribeLiveHostClientRetired((hostId, client) => {
    const link = links.get(hostId)
    if (!link || link.owned || link.client !== client) {
      return
    }
    link.unsubscribeNotifications?.()
    link.unsubscribeState()
    links.delete(hostId)
    noteListening()
    if (shouldListen()) {
      void open()
    }
  })

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
    // A drop while borrowed is nudged as a network change: replace the relay
    // make-before-break. A client already down when borrowed is nudged as a
    // foreground nudge: nothing changed, and 'network-change' forgets the
    // direct verdict, so every background restarted the wait on a dead LAN.
    const onState = (
      state: ConnectionState,
      nudge: ForegroundNudgeReason = 'network-change'
    ): void => {
      if (state === 'connected') {
        link.replacing = false
        link.unsubscribeNotifications ??= deps.subscribeNotifications(client, host.id)
        return
      }
      link.unsubscribeNotifications?.()
      link.unsubscribeNotifications = null
      // The screen still holds this socket. Dialling a second one left the
      // row on the dead socket while the new one connected in the background
      // (device, 2026-09-22), and the second one was never closed. Ask this
      // socket to replace itself. A rejected login cannot, so a PARKED one
      // that nobody holds is closed and replaced by a link of this watcher's.
      if (
        !owned &&
        links.get(host.id) === link &&
        state === 'auth-failed' &&
        !isLiveHostClientHeldByScreen(host.id)
      ) {
        link.unsubscribeState()
        links.delete(host.id)
        closeParkedClient(host.id, client)
        noteListening()
        if (shouldListen()) {
          void open()
        }
        return
      }
      if (!owned && links.get(host.id) === link && !link.replacing) {
        link.replacing = true
        client.notifyForeground(nudge)
      }
    }
    link.unsubscribeState = client.onStateChange((state) => onState(state))
    links.set(host.id, link)
    onState(client.getState(), 'focus')
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
      // already held. Ride the host's one client whatever its state: a
      // reconnecting one is nudged, and a second dial beside it was orphaned
      // on hand-back (three clients for one desktop, Pixel, 2026-09-27).
      const live = peekLiveHostClient(host.id)
      const borrowable = isLiveHostClientHeldByScreen(host.id) || reusableParkedHostClient(live)
      if (live && borrowable) {
        wire(host, live, false)
        continue
      }
      if (live) {
        closeParkedClient(host.id, live)
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

  /** A dead parked client: nothing holds it, so nothing else will close it. */
  function closeParkedClient(hostId: string, client: RpcClient): void {
    if (peekLiveHostClient(hostId) === client) {
      retireLiveHostClient(hostId, client)
    }
    client.close()
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
      // Parked for the screen to take back: closing it started a second dial.
      // Refused when the screen already holds a client for this host, and
      // then closed, so the host is left with one.
      if (
        handOver &&
        reusableParkedHostClient(link.client) &&
        handBackLiveHostClient(hostId, link.client)
      ) {
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
