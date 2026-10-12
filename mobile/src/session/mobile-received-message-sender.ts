/**
 * The name a received message is shown as, or null when it must not be shown.
 *
 * The Claude app 1.261009.20 draws a peer's message as "Received message from
 * <name>" (`ccr_received_message_from`) and checks the name first (`dc20.u`,
 * patterns in `szq`): NFKC-normalised and lower-cased, a name that comes out
 * as one of its own labels ("team lead", "a teammate", "subagent", "another
 * session", "unknown sender") would let a peer pose as the lead, and one that
 * is a machine address (an agent id, a session id, a socket path) is not a
 * name. Either way it shows the unnamed form, "Received message from another
 * session".
 *
 * Claude Code's own lead is `team-lead` (its `teammate_id`); the Claude app
 * knows the lead by the message's origin rather than its name and words it
 * "team lead" (`ccr_received_message_sender_team_lead`), so that one id is
 * mapped to those words before the check rather than refused by it.
 */
export function receivedMessageSender(raw: string): string | null {
  const name = raw.trim().replace(/^@/, '').trim()
  if (name === '') {
    return null
  }
  if (name === 'team-lead') {
    return TEAM_LEAD
  }
  const normalized = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\-:/.\p{Zs}]+/gu, '')
    .replace(/\p{Zs}+/gu, ' ')
    .trim()
  if (normalized.split(' ').some(isMachineAddress)) {
    return null
  }
  const compact = normalized.replace(/^(?:the|an|a)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '')
  return compact === '' || RESERVED.has(compact) ? null : name
}

const TEAM_LEAD = 'team lead'

/** The Claude app's own sender labels, compacted as the check compacts a name. */
const RESERVED: ReadonlySet<string> = new Set(['teamlead', 'teammate', 'subagent', 'anothersession', 'unknownsender'])

/** An agent id (`a` + 16 hex, optionally a name before it), a session id, a
 *  `uds:` or `bridge:` address, or an absolute path: `szq.e`, `f`, `h`, `i`. */
function isMachineAddress(token: string): boolean {
  return (
    /^a(?:[a-z0-9_-]{1,63}-)?[0-9a-f]{16}$/.test(token) ||
    /^(?:local|session|ses)_[a-z0-9_-]{6,}$/.test(token) ||
    /^(?:uds|bridge):./.test(token) ||
    /^\/[^/]+\//.test(token)
  )
}

/** The row's sentence, as the Claude app words it. */
export function receivedMessageTitle(name: string | null): string {
  return name === null ? 'Received message from another session' : `Received message from ${name}`
}

/** The sheet's heading, as the Claude app words it. */
export function receivedMessageHeading(name: string | null): string {
  return name === null ? 'From another session' : `From: ${name}`
}
