import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * Messages from another Claude session or a subagent, surfaced as their own
 * row instead of hidden.
 *
 * Claude Code injects such a message as a USER-role turn (real records on
 * this machine, 2.1.25x–2.1.276):
 *
 *     Another Claude session sent a message:
 *     <cross-session-message from="uds:/tmp/cc-socks/66525.sock" from-name="observer-sessions-17" from-mode="prompting">
 *     <agent-message from="a379d31745861b502">
 *     <the message>
 *     </agent-message>
 *     </cross-session-message>
 *
 *     This came from another Claude session — not typed by your user … that's permission laundering.
 *
 * or, older, `<teammate-message teammate_id="…" summary="…">…</teammate-message>`
 * with no trailing text. The message sits INSIDE the block.
 *
 * Two rows come out of one turn. The card (`PEER_MESSAGE_PRESENTATION`) is
 * the sender and the message, which Anthropic's Claude app never shows: it
 * draws the turn verbatim minus XML, i.e. a user bubble holding only the
 * harness's words around the block. The bubble (`PEER_BOILERPLATE_PRESENTATION`)
 * is that: the same words, derived from the turn, drawn as a user bubble
 * after the card and before the reply, because the user put the two apps
 * side by side and asked for it (2026-09-21; the 2026-09-20 call to leave
 * the boilerplate out is reversed by that).
 *
 * Orca's reader classes the whole turn as harness machinery and the fold's
 * noise filter hides it; this runs before that filter and makes both rows
 * `system`. The card's text starts with "From", which the filter keeps; the
 * bubble's starts with the very words the filter hides by, so the fold keeps
 * it explicitly (mobile-native-chat-render-data.ts). Only rows Orca publishes
 * reach here: most such deliveries are `attachment` or `isMeta` records it
 * drops, which the screen witness in mobile-terminal-peer-notices.ts covers.
 */

/** The phone-local display hint on the notice's text block. A build that
 *  does not know it draws the text as prose, which still reads. */
export const PEER_MESSAGE_PRESENTATION = 'peer-message'

/** The harness's own words around the block, drawn as a user bubble. */
export const PEER_BOILERPLATE_PRESENTATION = 'peer-boilerplate'

/** The bubble row's id, from its turn's: the card keeps the turn's id, since
 *  everything that anchors on a transcript row (split points, echo placement,
 *  screen-read notices) resolves it, and the bubble hangs off the card. */
export function peerBoilerplateRowId(turnId: string): string {
  return `${turnId}:peer-boilerplate`
}

export function isPeerBoilerplateRow(message: NativeChatMessage): boolean {
  const block = message.blocks[0]
  return message.role === 'system' && block?.type === 'text' && block.presentation === PEER_BOILERPLATE_PRESENTATION
}

/** Where a row anchored at `index` is drawn: after the bubble when the row
 *  there is a peer card with its bubble next, else where it was. A prompt
 *  sent right after a peer turn anchors on the RAW tail id, which is the
 *  card's, and would otherwise split the card from its bubble. */
export function afterPeerBoilerplate(rows: readonly NativeChatMessage[], index: number): number {
  const row = rows[index]
  const next = rows[index + 1]
  return row && next && next.id === peerBoilerplateRowId(row.id) && isPeerBoilerplateRow(next) ? index + 1 : index
}

const OPENING = /^\s*Another Claude session sent a message:\s*\n/
const FROM_NAME = /<cross-session-message\b[^>]*\bfrom-name="([^"]*)"/
const TEAMMATE_ID = /<teammate-message\b[^>]*\bteammate_id="([^"]*)"/
const AGENT_FROM = /<agent-message\b[^>]*\bfrom="([^"]*)"/
/** The innermost message: an agent-message inside a cross-session block, or
 *  the teammate block itself. */
const AGENT_BODY = /<agent-message\b[^>]*>([\S\s]*?)<\/agent-message>/
const TEAMMATE_BODY = /<teammate-message\b[^>]*>([\S\s]*?)<\/teammate-message>/
/** The outermost block, contents and all: what the Claude app strips. */
const OUTER_BLOCK = /<(cross-session-message|teammate-message)\b[^>]*>[\S\s]*?<\/\1>/

export type PeerMessage = { sender: string; body: string }

/** The sender and message of an injected peer turn, or null for anything
 *  else — a person's own prompt that merely mentions one, or a shape with no
 *  message inside it (drawing an empty bubble would be worse than hiding). */
export function parsePeerMessage(text: string): PeerMessage | null {
  if (!OPENING.test(text)) {
    return null
  }
  const body = (AGENT_BODY.exec(text)?.[1] ?? TEAMMATE_BODY.exec(text)?.[1] ?? '').trim()
  if (body.length === 0) {
    return null
  }
  const sender = (FROM_NAME.exec(text)?.[1] ?? TEAMMATE_ID.exec(text)?.[1] ?? AGENT_FROM.exec(text)?.[1] ?? '').trim()
  return { sender: sender.length > 0 ? sender : 'another session', body }
}

/** The turn's words outside the block, whitespace collapsed: exactly what the
 *  Claude app's bubble reads. Derived, not a constant, so a harness that
 *  rewords its paragraph is drawn as it wrote it, and the teammate shape,
 *  which has no paragraph, gets its one line. */
export function peerBoilerplateText(text: string): string {
  return text.replace(OUTER_BLOCK, ' ').replace(/\s+/g, ' ').trim()
}

/** Runs before the noise filter. Returns the same array when no row changed. */
export function surfacePeerMessages(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
  let out: NativeChatMessage[] | null = null
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const surfaced = message.role === 'user' ? surfacedPeerRows(message) : null
    if (surfaced) {
      out ??= messages.slice(0, index)
      out.push(...surfaced)
    } else {
      out?.push(message)
    }
  }
  return out ?? (messages as NativeChatMessage[])
}

function surfacedPeerRows(message: NativeChatMessage): NativeChatMessage[] | null {
  const texts = message.blocks.filter(isTextBlock)
  if (texts.length !== 1 || message.blocks.length !== 1) {
    return null
  }
  const text = texts[0]!.text
  const peer = parsePeerMessage(text)
  if (!peer) {
    return null
  }
  const card: NativeChatMessage = {
    ...message,
    role: 'system',
    blocks: [{ type: 'text', text: peerMessageText(peer), presentation: PEER_MESSAGE_PRESENTATION }]
  }
  const bubble: NativeChatMessage = {
    ...message,
    id: peerBoilerplateRowId(message.id),
    role: 'system',
    blocks: [{ type: 'text', text: peerBoilerplateText(text), presentation: PEER_BOILERPLATE_PRESENTATION }]
  }
  return [card, bubble]
}

/** The block's text: the label on its first line, the message under it. One
 *  string because the shared block type has no field for a sender, and a
 *  build that does not know the hint then still shows who wrote it. */
function peerMessageText(peer: PeerMessage): string {
  return `From ${peer.sender}\n${peer.body}`
}

export function peerMessageLabelAndBody(text: string): { label: string; body: string } {
  const newline = text.indexOf('\n')
  return newline === -1
    ? { label: text, body: '' }
    : { label: text.slice(0, newline), body: text.slice(newline + 1) }
}
