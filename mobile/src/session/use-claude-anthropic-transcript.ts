import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { anthropicSignedInCount, anthropicSignInPresenceVersion, subscribeAnthropicSignInPresence } from './anthropic-sign-in-presence'
import { acquireCcrLink } from './ccr-link-registry'
import { ccrMatchOutcome, ccrMatchOutcomesVersion, subscribeCcrMatchOutcomes } from './ccr-match-outcome'
import { ccrAccountForTab, ccrSessionForTab } from './ccr-session-cache'
import type { CcrLinkState, CcrSessionLink } from './ccr-session-link'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { deriveCcrLiveState, type CcrLiveState } from './ccr-live-state'
import type { CcrLinkPhase } from './ccr-session-link-types'
import { readCcrTranscript } from './ccr-transcript-persist'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'

/**
 * What a Claude tab's chat shows. Since 2026-10-15 (the user: "stop reading from Orca and only
 * from Anthropic, and the user needs to be signed in"), a Claude Code tab's transcript comes only
 * from Anthropic's copy of its Remote Control session: no Orca row is drawn, and nothing falls
 * back to Orca without saying so.
 *
 *  - `signed-out`: nobody is signed in to Anthropic on the phone. The chat shows a sign-in line.
 *  - `finding`: the tab is being matched to its session. The chat shows the loading state.
 *  - `unmatched`: no Remote Control session holds the tab's messages, or Anthropic could not be
 *    asked. The chat says why.
 *  - `new`: the tab's session has no message yet, so there is nothing to match it by. The chat
 *    is empty and its composer works (a phone-launched tab's first message is sent from here).
 *  - `orca-empty`: Orca holds no row for the tab and will not soon (no transcript yet, no session
 *    named, or its read failed), so there is nothing to match by either. The chat shows what
 *    Orca's state means, as it did before (the empty state's line, or the error and its reason),
 *    never a spinner that cannot end.
 *  - `matched`: the transcript is the session link's (ccr-session-link.ts).
 *
 * Orca's rows still decide WHICH session the tab is (their uuids are what the match compares,
 * ccr-session-match.ts) but are never shown: there is no other identity to match by. A tab's
 * Claude session id (`agentSessionId`) keys a kept match, so a tab matched once opens matched.
 */
export type ClaudeChatGate =
  | { kind: 'off' }
  | { kind: 'signed-out' }
  | { kind: 'finding' }
  | { kind: 'new' }
  | { kind: 'orca-empty'; status: 'awaiting-transcript' | 'waiting-session' | 'error'; error?: string }
  | { kind: 'unmatched'; detail: string }
  | { kind: 'matched'; accountId: string; sessionId: string }

export const CLAUDE_UNMATCHED_LINE = "This session isn't on Anthropic. Turn on Remote Control in it (/remote-control), or sign in to the account that owns it."
export const CLAUDE_SIGNED_OUT_LINE = 'Sign in to Anthropic to read Claude sessions on this phone.'

const EMPTY: NativeChatMessage[] = []
const noop = () => undefined

function emptySession(status: MobileNativeChatSession['status'], error?: string): MobileNativeChatSession {
  // `transcriptLoading` stays false: with no rows the overlay reads it as a blink and drops to the
  // terminal beneath (MobileNativeChatOverlay `emptyReload`); a match can take seconds, so the
  // chat's own loading state (`status`) shows instead.
  return { messages: EMPTY, status, transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: noop, ...(error ? { error } : {}) }
}

/** The link's state as the chat's session: rows decoded from its events, the link's trouble as a
 *  toned line at the end when there are rows to keep showing, as the empty state's words when not. */
export function ccrLinkSession(link: CcrSessionLink, state: CcrLinkState, rows: NativeChatMessage[]): MobileNativeChatSession {
  const trouble = state.phase === 'error' || state.phase === 'lost' ? state.error : null
  const messages: NativeChatMessage[] =
    trouble && rows.length > 0
      ? [...rows, { id: `ccr-link-trouble:${link.sessionId}`, role: 'system', blocks: [{ type: 'text', text: trouble, tone: 'warning' }], timestamp: null, source: 'transcript' }]
      : rows
  const status: MobileNativeChatSession['status'] = rows.length === 0 && (state.phase === 'loading' || state.phase === 'idle') ? 'loading' : rows.length === 0 && trouble ? 'error' : 'ready'
  return {
    messages,
    status,
    transcriptLoading: false,
    ...(status === 'error' && trouble ? { error: trouble } : {}),
    hasMore: state.hasOlder,
    loadingEarlier: state.loadingOlder,
    loadEarlier: () => void link.loadOlder(),
    wholeSession: !state.hasOlder,
    baseRetained: false
  }
}

/** Whether the rows a gated Claude tab draws are its session's history, so a pending bubble or a
 *  launch prefill may be judged against them. Signed out, unmatched, still finding, or a link with
 *  nothing read yet: the chat draws no rows, and none of that says the conversation is empty. */
export function claudeRowsAreHistory(api: { gate: ClaudeChatGate; session: MobileNativeChatSession | null }): boolean {
  return api.gate.kind === 'new' || (api.gate.kind === 'matched' && api.session?.status === 'ready')
}

export function useClaudeAnthropicTranscript(args: {
  /** A Claude Code tab on the terminal lane, its chat shown. */
  enabled: boolean
  tabId: string | null
  agentSessionId: string | null
  /** `useLastConnectedAt(hostId)`: a match is made per relay connection, and a new one retries a lost stream. */
  epoch: number | null
  /** Orca's read of the tab, for the gate only: its status, how many rows, and why it failed. */
  orcaStatus: MobileNativeChatSession['status']
  orcaRowCount: number
  orcaError?: string
}): ClaudeAnthropicTranscript {
  const { enabled, tabId, agentSessionId, epoch } = args
  useSyncExternalStore(subscribeAnthropicSignInPresence, anthropicSignInPresenceVersion, anthropicSignInPresenceVersion)
  useSyncExternalStore(subscribeCcrMatchOutcomes, ccrMatchOutcomesVersion, ccrMatchOutcomesVersion)
  const signedIn = anthropicSignedInCount()
  const sessionId = enabled && tabId ? ccrSessionForTab(tabId, epoch, agentSessionId) : null
  const accountId = enabled && tabId && sessionId ? ccrAccountForTab(tabId, epoch, agentSessionId) : null
  const outcome = enabled && tabId ? ccrMatchOutcome(tabId, epoch) : null

  const gate: ClaudeChatGate = useMemo(() => {
    if (!enabled || !tabId) {
      return { kind: 'off' }
    }
    if (signedIn === 0) {
      return { kind: 'signed-out' }
    }
    if (sessionId && accountId) {
      return { kind: 'matched', accountId, sessionId }
    }
    if (args.orcaRowCount === 0) {
      switch (args.orcaStatus) {
        case 'ready':
          return { kind: 'new' }
        case 'awaiting-transcript':
        case 'waiting-session':
          return { kind: 'orca-empty', status: args.orcaStatus }
        case 'error':
          return { kind: 'orca-empty', status: 'error', ...(args.orcaError ? { error: args.orcaError } : {}) }
        case 'idle':
        case 'loading':
          break
        default: {
          // A status this does not know is treated as a read still in flight.
          const unhandled: never = args.orcaStatus
          void unhandled
        }
      }
    }
    if (outcome?.kind === 'unmatched' && outcome.stage === 'sign-in' && signedIn === null) {
      return { kind: 'signed-out' }
    }
    return outcome?.kind === 'unmatched' ? { kind: 'unmatched', detail: outcome.detail } : { kind: 'finding' }
  }, [accountId, args.orcaError, args.orcaRowCount, args.orcaStatus, enabled, outcome, sessionId, signedIn, tabId])

  const link = useMatchedLink(gate.kind === 'matched' ? gate : null)
  const state = useSyncExternalStore(link?.subscribe ?? subscribeNothing, link?.getState ?? noState, link?.getState ?? noState)
  const rows = useMemo(() => (state ? decodeCcrEvents(state.events) : EMPTY), [state])
  // The tab's live state from the same events (ccr-live-state.ts), for when the relay is down.
  const live = useMemo(
    () => (state ? deriveCcrLiveState(state.events, { liveFrom: state.liveFrom, streamThinking: state.streamThinking, connectionStatus: state.connectionStatus }) : null),
    [state]
  )

  // A new relay connection retries a lost stream (CLAUDE.md, "Nothing stays stale once the relay connects").
  const lastEpoch = useRef(epoch)
  useEffect(() => {
    if (lastEpoch.current !== epoch) {
      lastEpoch.current = epoch
      link?.retry()
    }
  }, [epoch, link])

  const session = useMemo((): MobileNativeChatSession | null => {
    switch (gate.kind) {
      case 'off':
        return null
      case 'matched': {
        if (link && state) {
          return ccrLinkSession(link, state, rows)
        }
        // The frame before the link is held (an effect away): the kept copy, so the first paint
        // is the conversation, not a spinner.
        const kept = readCcrTranscript(gate.accountId, gate.sessionId)
        const keptRows = kept ? decodeCcrEvents(kept.events) : EMPTY
        return keptRows.length > 0 ? { ...emptySession('ready'), messages: keptRows, hasMore: kept?.hasOlder ?? false } : emptySession('loading')
      }
      case 'finding':
        return emptySession('loading')
      case 'new':
        return emptySession('ready')
      case 'orca-empty':
        return emptySession(gate.status, gate.status === 'error' ? (gate.error ?? 'The desktop could not read this session.') : undefined)
      case 'signed-out':
      case 'unmatched':
        return emptySession('error', gate.kind === 'signed-out' ? CLAUDE_SIGNED_OUT_LINE : CLAUDE_UNMATCHED_LINE)
      default: {
        const unhandled: never = gate
        return unhandled
      }
    }
  }, [gate, link, rows, state])
  return { gate, session, live, linkPhase: state?.phase ?? null, connectionStatus: state?.connectionStatus ?? null }
}

export type ClaudeAnthropicTranscript = {
  gate: ClaudeChatGate
  session: MobileNativeChatSession | null
  /** The matched link's live state; null until a link's state is held. */
  live: CcrLiveState | null
  linkPhase: CcrLinkPhase | null
  connectionStatus: string | null
}

const subscribeNothing = () => noop
const noState = (): CcrLinkState | null => null

/** Holds the link for the matched (account, session) while the chat shows it. */
function useMatchedLink(match: { accountId: string; sessionId: string } | null): CcrSessionLink | null {
  const key = match ? `${match.accountId}\0${match.sessionId}` : null
  const [link, setLink] = useState<CcrSessionLink | null>(null)
  useEffect(() => {
    if (!match) {
      setLink(null)
      return
    }
    const handle = acquireCcrLink(match.accountId, match.sessionId)
    setLink(handle.link)
    return () => handle.release()
    // `key` names the match; the object is rebuilt every render.
  }, [key])
  return key && link && `${link.accountId}\0${link.sessionId}` === key ? link : null
}
