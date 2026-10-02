/**
 * Whether the host behind a client has answered a screen read on THIS
 * connection. A read that fails (a timeout, a rejection) says nothing about
 * what the host can do: an older Orca (1.4.178-rc.2 and before) has no
 * `screen: true` handling and a current one (1.4.218) has it, and the phone has
 * no capability flag to tell them apart (`status.get` lists none). What it does
 * have is the reply: Orca 1.4.218 puts `source` on every `terminal.read` reply
 * to a screen request (`'screen'`, or `'screen-unavailable'` when it has no rows
 * to show), and an older host puts none. A host that has said so once can read
 * screens, so a read that then fails is a failure now, not a host that cannot.
 *
 * Per connection: the note is stamped with the client's `getLastConnectedAt`,
 * so a reconnect (possibly to a host that changed under the same client) starts
 * from "not known" again. A client with no such method keeps one stamp.
 */
type ConnectionStamp = { connectedAt: number | null }

const answered = new WeakMap<object, ConnectionStamp>()

function stampOf(client: object): ConnectionStamp {
  const read = (client as { getLastConnectedAt?: () => number | null }).getLastConnectedAt
  return { connectedAt: typeof read === 'function' ? read.call(client) : null }
}

/** Records the `source` of a screen-read reply; only a host's own words count. */
export function noteScreenReplySource(client: object, source: unknown): void {
  if (source === 'screen' || source === 'screen-unavailable') {
    answered.set(client, stampOf(client))
  }
}

/** Whether the host has answered a screen read on the client's current connection. */
export function hostAnswersScreens(client: object): boolean {
  const note = answered.get(client)
  return note !== undefined && note.connectedAt === stampOf(client).connectedAt
}
