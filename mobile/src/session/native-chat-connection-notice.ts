import type { ConnectionVerdict } from '../transport/connection-health'
import type { ConnectionState } from '../transport/types'

/**
 * The Claude app's connection row (com.anthropic.claude 1.261009.20, `au8` case 0 and `nl7.b`).
 *
 * The app's status row, the line above the composer, says what its live connection is doing in place
 * of the agent's own words: "Connecting…" while it is being made (`ccr_backplane_connecting`) and
 * "Connection lost" once it has failed (`ccr_backplane_connection_failed`). Both are drawn only
 * while the row is busy (`z3`: a turn running, or the phone offline with a message waiting), so an
 * idle chat with a dropped connection draws no row. Code UI's header already says the connection
 * state at any time (`terminalSummary`); this row is the one in the chat, beside the work it
 * interrupts.
 *
 * What stands for the app's two connection states here:
 *  - connecting: the phone is dialling or has dropped and is retrying, and has not yet judged the
 *    host out of reach (the verdict is `normal`);
 *  - lost: that verdict is `warning` (three failed attempts, or the relay's own word), `unreachable`
 *    or `auth-failed`. Reusing the verdict keeps the row from flickering "lost" on the first dropped
 *    socket, the hysteresis `classifyConnection` was written for.
 */

export type NativeChatConnectionNotice = {
  kind: 'connecting' | 'lost'
  text: string
}

const CONNECTING = 'Connecting…'
const LOST = 'Connection lost'

/** How `nl7.b` draws a message state: any trailing "..." then any trailing "…" is removed
 *  (`u1x.B0`, removeSuffix, applied inside out) and an ASCII "..." is put back. */
export function waitingText(text: string): string {
  const withoutDots = text.endsWith('...') ? text.slice(0, -3) : text
  const withoutEllipsis = withoutDots.endsWith('…') ? withoutDots.slice(0, -1) : withoutDots
  return `${withoutEllipsis}...`
}

export function nativeChatConnectionNotice(input: {
  connState: ConnectionState
  verdict: ConnectionVerdict['kind']
  agentWorking: boolean
  /** A Claude tab whose Anthropic stream is live: that stream is the chat's connection, as the
   *  app's backplane is its own, so the relay's state is not this row's to say (claude-chat-live.ts). */
  anthropicLive?: boolean
}): NativeChatConnectionNotice | null {
  if (input.connState === 'connected' || !input.agentWorking || input.anthropicLive === true) {
    return null
  }
  return input.verdict === 'normal'
    ? { kind: 'connecting', text: waitingText(CONNECTING) }
    : { kind: 'lost', text: waitingText(LOST) }
}
