import { createContext, useContext } from 'react'
import type { ConnectionVerdict } from '../transport/connection-health'
import type { ConnectionState } from '../transport/types'
import type { CcrLinkPhase } from './ccr-session-link-types'

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
  kind: 'connecting' | 'lost' | 'offline'
  text: string
  /** Said of a matched Claude tab's Anthropic stream: drawn while that turn is open even when the
   *  relay calls the agent idle (MobileNativeChatStatusLine). */
  anthropic?: true
}

/** A matched Claude tab's Anthropic stream, for its status line (claude-chat-live.ts). */
export type NativeChatAnthropicConnection = { phase: CcrLinkPhase | null; turnOpen: boolean }

const CONNECTING = 'Connecting…'
const LOST = 'Connection lost'

/** How `nl7.b` draws a message state: any trailing "..." then any trailing "…" is removed
 *  (`u1x.B0`, removeSuffix, applied inside out) and an ASCII "..." is put back. */
export function waitingText(text: string): string {
  const withoutDots = text.endsWith('...') ? text.slice(0, -3) : text
  const withoutEllipsis = withoutDots.endsWith('…') ? withoutDots.slice(0, -1) : withoutDots
  return `${withoutEllipsis}...`
}

/** The notice for the chat's status line, which draws it in place of its verb as the app's one
 *  line does (MobileNativeChatStatusLine). Provided by the route, which holds the connection. */
export const NativeChatConnectionNoticeContext = createContext<NativeChatConnectionNotice | null>(null)

export function useNativeChatConnectionNotice(): NativeChatConnectionNotice | null {
  return useContext(NativeChatConnectionNoticeContext)
}

export function nativeChatConnectionNotice(input: {
  connState: ConnectionState
  verdict: ConnectionVerdict['kind']
  agentWorking: boolean
  /** A Claude tab whose Anthropic stream is live: that stream is the chat's connection, as the
   *  app's backplane is its own, so the relay's state is not this row's to say (claude-chat-live.ts). */
  anthropicLive?: boolean
  /** A Claude tab matched to its Anthropic session: the line follows that stream, not the relay. */
  anthropic?: NativeChatAnthropicConnection | null
  /** The phone itself has no network (use-phone-offline.ts); read only for a matched tab. */
  phoneOffline?: boolean
}): NativeChatConnectionNotice | null {
  if (input.anthropic) {
    return anthropicNotice(input.anthropic, input.agentWorking || input.anthropic.turnOpen, input.phoneOffline === true)
  }
  if (input.connState === 'connected' || !input.agentWorking || input.anthropicLive === true) {
    return null
  }
  // One object per kind, so the route can hand it down a context without redrawing every reader
  // on each render.
  return input.verdict === 'normal' ? CONNECTING_NOTICE : LOST_NOTICE
}

/** The app's line over its own stream: busy only (`z3`), offline first (zr8.java:1097-1099), then
 *  the stream's phase (uq30.i: not yet live is connecting; failed is lost). */
function anthropicNotice(stream: NativeChatAnthropicConnection, busy: boolean, offline: boolean): NativeChatConnectionNotice | null {
  if (!busy) {
    return null
  }
  if (offline) {
    return ANTHROPIC_OFFLINE_NOTICE
  }
  switch (stream.phase) {
    case 'live':
      return null
    case null:
    case 'idle':
    case 'loading':
    case 'reconnecting':
      return ANTHROPIC_CONNECTING_NOTICE
    case 'lost':
    case 'error':
      return ANTHROPIC_LOST_NOTICE
    default: {
      const unhandled: never = stream.phase
      return unhandled
    }
  }
}

const CONNECTING_NOTICE: NativeChatConnectionNotice = Object.freeze({ kind: 'connecting', text: waitingText(CONNECTING) })
const LOST_NOTICE: NativeChatConnectionNotice = Object.freeze({ kind: 'lost', text: waitingText(LOST) })
const ANTHROPIC_CONNECTING_NOTICE: NativeChatConnectionNotice = Object.freeze({ ...CONNECTING_NOTICE, anthropic: true as const })
const ANTHROPIC_LOST_NOTICE: NativeChatConnectionNotice = Object.freeze({ ...LOST_NOTICE, anthropic: true as const })
// `chat_footer_polling_offline`, drawn as the app's footer draws it: verbatim, no dots added.
const ANTHROPIC_OFFLINE_NOTICE: NativeChatConnectionNotice = Object.freeze({
  kind: 'offline',
  text: 'You’re offline. The rest of Claude’s reply will appear when you reconnect.',
  anthropic: true as const
})
