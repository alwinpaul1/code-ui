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
 * with no trailing text. The message sits INSIDE the block; the ~90-word
 * boilerplate after it is the same on every message and says nothing about
 * this one, so it is not drawn (Jev 0.80, 2026-09-20). Anthropic's Claude
 * app draws these turns verbatim minus XML, which leaves the boilerplate
 * WITHOUT the message; the user asked for that before the bytes were read.
 *
 * Orca's reader classes the whole turn as harness machinery and the fold's
 * noise filter hides it; this runs before that filter and turns the row into
 * a `system` notice (`PEER_MESSAGE_PRESENTATION`) the filter keeps, so the
 * reply has a visible cause. Only rows Orca publishes reach here: most such
 * deliveries are `attachment` or `isMeta` records it drops, which the screen
 * witness in mobile-terminal-peer-notices.ts covers.
 */

/** The phone-local display hint on the notice's text block. A build that
 *  does not know it draws the text as prose, which still reads. */
export const PEER_MESSAGE_PRESENTATION = 'peer-message'

const OPENING = /^\s*Another Claude session sent a message:\s*\n/
const FROM_NAME = /<cross-session-message\b[^>]*\bfrom-name="([^"]*)"/
const TEAMMATE_ID = /<teammate-message\b[^>]*\bteammate_id="([^"]*)"/
const AGENT_FROM = /<agent-message\b[^>]*\bfrom="([^"]*)"/
/** The innermost message: an agent-message inside a cross-session block, or
 *  the teammate block itself. */
const AGENT_BODY = /<agent-message\b[^>]*>([\S\s]*?)<\/agent-message>/
const TEAMMATE_BODY = /<teammate-message\b[^>]*>([\S\s]*?)<\/teammate-message>/

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

/** Runs before the noise filter. Returns the same array when no row changed. */
export function surfacePeerMessages(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
  let out: NativeChatMessage[] | null = null
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const surfaced = message.role === 'user' ? surfacedPeerRow(message) : null
    if (surfaced) {
      out ??= messages.slice(0, index)
      out.push(surfaced)
    } else {
      out?.push(message)
    }
  }
  return out ?? (messages as NativeChatMessage[])
}

function surfacedPeerRow(message: NativeChatMessage): NativeChatMessage | null {
  const texts = message.blocks.filter(isTextBlock)
  if (texts.length !== 1 || message.blocks.length !== 1) {
    return null
  }
  const peer = parsePeerMessage(texts[0]!.text)
  if (!peer) {
    return null
  }
  return {
    ...message,
    role: 'system',
    blocks: [{ type: 'text', text: peerMessageText(peer), presentation: PEER_MESSAGE_PRESENTATION }]
  }
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
