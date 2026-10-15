import { createContext, useContext } from 'react'
import type { CcrLiveState, CcrRateLimitState } from './ccr-live-state'
import type { CcrEvent } from './ccr-session-api'
import type { CcrLinkPhase } from './ccr-session-link-types'
import type { ClaudeFooterLiveInput } from './claude-working-footer-stats'
import type { ConnectionState } from '../transport/types'

/**
 * Which source drives a Claude tab's live chat state: the relay to the desktop (Orca's tab status,
 * the beacon, the screen) or Anthropic's copy of the session (ccr-live-state.ts).
 *
 *  - Anthropic stream live: Anthropic drives working/idle, the running count, the footer's stats
 *    and the limit state, relay up or down, so the tab says what the Claude app says on the same
 *    session (2026-10-15: relay up, the app "3 running tasks", the desktop's count "4").
 *  - Relay DOWN as well: Anthropic also gives the header's word for the session, so the tab stays
 *    live as the Claude app does (2026-10-15 12:29-12:31: the relay down, the app on the same
 *    session still "Generating… · 2 running tasks"). The terminal view and the files keep the
 *    relay's own state: they need the desktop.
 *  - Anthropic stream not live (reconnecting, lost, never matched): nothing is overridden.
 */
export type ClaudeChatLive = {
  /** The footer's stats inputs while Anthropic says a turn is open; null otherwise. */
  footer: ClaudeFooterLiveInput | null
  /** Working/idle in place of the relay's, or null to keep the relay's. */
  working: boolean | null
  /** The running-task count in place of the relay's, or null to keep the relay's. */
  runningCount: number | null
  /** The chat header's word for the session while the relay is down: the app's "Connected" /
   *  "Disconnected" (`ccr_session_connected` / `ccr_session_disconnected`, na20.java:1003-1006);
   *  null keeps the relay's label. */
  sessionConnection: 'connected' | 'disconnected' | null
  /** Whether the Anthropic stream is live (the relay's connection notice is then not the chat's). */
  linkLive: boolean
  /** The newest `rate_limit_event`, for the limit banner; null when none was read. */
  rateLimit: CcrRateLimitState | null
  /** While the stream is live: its events and the session they are in, for the Background tasks
   *  sheet's list, its Stop and its agents' transcripts (ccr-background-tasks.ts); else null. */
  stream: ClaudeChatLiveStream | null
}

export type ClaudeChatLiveStream = { events: readonly CcrEvent[]; accountId: string; sessionId: string }

export function claudeChatLive(input: {
  live: CcrLiveState | null
  linkPhase: CcrLinkPhase | null
  connectionStatus: string | null
  relayConnected: boolean
  /** The matched session and its events; absent or null leaves `stream` null. */
  stream?: ClaudeChatLiveStream | null
}): ClaudeChatLive | null {
  const { live } = input
  if (!live) {
    return null
  }
  const linkLive = input.linkPhase === 'live'
  const takeOver = linkLive && !input.relayConnected
  const footer = linkLive && live.working ? { turnStartedAt: live.turnStartedAt, thinking: live.thinking, thinkingTokens: live.thinkingTokens } : null
  // Unknown connection status with a turn streaming in: the turn is the evidence its Claude Code is attached.
  const sessionConnection = !takeOver
    ? null
    : input.connectionStatus === 'disconnected'
      ? 'disconnected'
      : input.connectionStatus === 'connected' || live.working
        ? 'connected'
        : null
  return {
    footer,
    working: linkLive ? live.working : null,
    runningCount: linkLive ? live.runningTasks : null,
    sessionConnection,
    linkLive,
    rateLimit: live.rateLimit,
    stream: linkLive ? (input.stream ?? null) : null
  }
}

/** The chat's live state from Anthropic, for the rows below the controller that draw it (the
 *  footer, the tasks provider). Null outside a matched Claude tab. */
export const ClaudeChatLiveContext = createContext<ClaudeChatLive | null>(null)

export function useClaudeChatLive(): ClaudeChatLive | null {
  return useContext(ClaudeChatLiveContext)
}

/** The session header's line while the chat is shown: the session's own word from Anthropic when
 *  the relay is down and Anthropic's stream is live, else null (the relay's label stays). The
 *  terminal view never asks: it needs the desktop, so it says the relay's state. */
export function claudeChatHeaderConnection(input: {
  chatShown: boolean
  live: ClaudeChatLive | null | undefined
}): { label: 'Connected' | 'Disconnected'; dot: ConnectionState } | null {
  const word = input.chatShown ? (input.live?.sessionConnection ?? null) : null
  if (word === null) {
    return null
  }
  return word === 'connected' ? { label: 'Connected', dot: 'connected' } : { label: 'Disconnected', dot: 'disconnected' }
}
