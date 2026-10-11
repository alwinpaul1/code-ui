import { getBackgroundLinkWatcher } from '../background/background-link'
import { peekLiveHostClient } from '../transport/live-host-clients'
import { connectionLogStore } from '../transport/persisted-connection-log-store'
import type { RpcClient } from '../transport/rpc-client'
import type { OutboxDrainDeps } from './native-chat-outbox-drainer'
import { observeTerminalOutboxEntry, sendTerminalOutboxEntry } from './native-chat-outbox-headless'
import { sendSessionOutboxEntry } from './native-chat-outbox-session-send'

/** What the app-wide drainer (native-chat-outbox-drainer.ts) runs on in the app: the live links,
 *  the desktop reads and sends of native-chat-outbox-headless.ts and
 *  native-chat-outbox-session-send.ts, and the connection log. Its own
 *  module, free of React Native, so tests can drive the real reads against a fake desktop. */

let logSequence = 0

/** The UI's client for the host, or the background watcher's, when its link is up now. */
function connectedClient(hostId: string): RpcClient | null {
  const client = peekLiveHostClient(hostId) ?? getBackgroundLinkWatcher().peekClient(hostId)
  return client && client.getState() === 'connected' ? client : null
}

export const nativeChatOutboxDrainDeps: OutboxDrainDeps = {
  now: () => Date.now(),
  connectedClient,
  observe: observeTerminalOutboxEntry,
  send: (client, entry, observation) =>
    entry.route?.lane === 'session'
      ? sendSessionOutboxEntry(client, entry)
      : sendTerminalOutboxEntry(
          client,
          entry,
          (observation.kind === 'clear' ? observation.terminal : undefined) ?? entry.route?.terminal ?? ''
        ),
  setTimer: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
  log: (hostId, line) => {
    const ts = Date.now()
    logSequence += 1
    connectionLogStore.append(hostId, { id: `chat-outbox-${ts}-${logSequence}`, ts, code: 'chat-outbox', ...line })
  }
}
