import { isAgentSessionHandleProvider } from '../../../src/shared/agent-session-provider-handle'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { isRuntimeOwnedSshTargetId } from '../../../src/shared/execution-host'
import {
  isNativeChatSupportedAgent,
  nativeChatRequiresLocalTranscript
} from '../../../src/shared/native-chat-agent-support'
import { nativeChatAgentFromTranscriptPath } from './mobile-native-chat-session-agent'

// Why: native chat renders an agent's own JSONL transcript, and the host
// resolver knows these transcript layouts. Agents whose hook reports no
// transcript path (Grok, omp) are additionally gated on host readability,
// because Model-A SSH stores their transcript on the remote target.
export function isMobileNativeChatTranscriptReadable(
  connectionId: string | null | undefined
): boolean {
  return connectionId === null || isRuntimeOwnedSshTargetId(connectionId)
}

export type MobileNativeChatResolution = {
  agent: string
  /** Where the agent's name came from. `transcript` means nobody named this
   *  pane as an agent pane — the person typed the agent's name into a terminal
   *  they opened — so the tab may offer chat but must not open in it. */
  source: 'launch' | 'status' | 'beacon' | 'transcript'
  /** The agent's own session id, or null before it has reported one (the view
   *  then shows a waiting state instead of trying to read an unaddressable file). */
  sessionId: string | null
  /** Hook-reported transcript path. Recent Claude sessions cannot always be
   *  resolved from the provider session id, so mobile forwards this to runtime. */
  transcriptPath: string | null
}

export type MobileNativeChatTab = {
  type: string
  launchAgent?: string | null
  agentStatus?: AgentStatusEntry | null
  /** Host-provided launch context still parked as an unsent TUI-input draft. */
  launchDraft?: string
  launchDraftCreatedAt?: number
  /** Orca's lead-turn end, while background work keeps the pane working
   *  (the host's tab field; see agent-status-stand-in.ts). */
  turnCompletedAt?: number
  sessionId?: string | null
  agent?: string | null
}

/** Resolve a session tab to the transcript identity native chat needs, or
 *  null when the tab can't show native chat (not a terminal, no agent, or an
 *  agent whose transcript the host can't read). Agent comes from the launch
 *  hint or the live status; session id from the captured provider session. */
export function resolveMobileNativeChat(
  tab: MobileNativeChatTab | null,
  nativeChatTranscriptIsLocalReadable = false,
  beaconAgent: string | null = null
): MobileNativeChatResolution | null {
  if (!tab) {
    return null
  }
  if (tab.type === 'agent-session') {
    // Structured tabs are journal-backed, so any provider the shared reducer can
    // replay renders here — there is no per-agent transcript layout to know.
    return tab.sessionId && isAgentSessionHandleProvider(tab.agent)
      ? { agent: tab.agent, source: 'launch', sessionId: tab.sessionId, transcriptPath: null }
      : null
  }
  if (tab.type !== 'terminal') {
    return null
  }
  const liveAgent = tab.agentStatus?.agentType ?? null
  const launchAgent = tab.launchAgent ?? null
  const usableLive =
    liveAgent && liveAgent !== 'unknown' && isNativeChatSupportedAgent(liveAgent)
      ? liveAgent
      : null
  const usableBeacon =
    beaconAgent && isNativeChatSupportedAgent(beaconAgent) ? beaconAgent : null
  // Last resort, and the only identity a hand-started agent has: the host
  // captured a provider session for this pane, and the transcript in it was
  // written by the agent itself. Ranked below every other source so a named
  // owner always wins — an openclaude launch keeps its own name over the
  // Claude-format transcript it writes (2026-09-14).
  const transcriptAgent = nativeChatAgentFromTranscriptPath(
    tab.agentStatus?.providerSession?.transcriptPath
  )
  // A live status naming an agent the phone cannot chat with (Antigravity,
  // Gemini…) is the host saying who owns the pane NOW. The beacon and the
  // transcript are evidence left by whoever ran there before: the beacon store
  // keeps the last frame a PTY wrote for the life of the app, and the captured
  // session can be an earlier one. A terminal that ran Claude Code and then
  // `agy` opened as Claude's chat over Antigravity (0.9.131, 2026-10-13). A
  // launch record still outranks the status, as it does for a supported agent.
  const liveNamesOtherAgent = liveStatusNamesUnchattableAgent(tab)
  const leftBehind: readonly [string | null, MobileNativeChatResolution['source']][] =
    liveNamesOtherAgent
      ? []
      : [
          [usableBeacon, 'beacon'],
          [transcriptAgent, 'transcript']
        ]
  // Identity comes from what the session actually reports: the agent Orca
  // launched, the live hook, the HUD beacon on this PTY, or the transcript the
  // agent's own hook disclosed. Tab titles are not used.
  const named: readonly [string | null, MobileNativeChatResolution['source']][] =
    nativeChatRequiresLocalTranscript(launchAgent)
      ? [[launchAgent, 'launch']]
      : [
          [usableLive, 'status'],
          [isNativeChatSupportedAgent(launchAgent) ? launchAgent : null, 'launch'],
          ...leftBehind
        ]
  const resolved = named.find(
    (entry): entry is [string, MobileNativeChatResolution['source']] => entry[0] != null
  )
  if (!resolved || !isNativeChatSupportedAgent(resolved[0])) {
    return null
  }
  const [agent, source] = resolved
  if (nativeChatRequiresLocalTranscript(agent) && !nativeChatTranscriptIsLocalReadable) {
    return null
  }
  return {
    agent,
    source,
    sessionId: tab.agentStatus?.providerSession?.id ?? null,
    transcriptPath: tab.agentStatus?.providerSession?.transcriptPath ?? null
  }
}

/** Agent types that are Orca wrappers around Claude Code itself: the child
 *  process is the real `claude` binary (src/shared/agent-process-recognition.ts),
 *  so its beacon and transcript are the pane owner's own, not leftovers. */
const WRAPS_CLAUDE_CODE: ReadonlySet<string> = new Set(['claude-agent-teams'])

/** The host's live status names the agent in this terminal, and it is one the
 *  phone cannot chat with. Not a missing or `unknown` agent type: that says
 *  nothing about who owns the pane. */
export function liveStatusNamesUnchattableAgent(tab: MobileNativeChatTab | null): boolean {
  const liveAgent = tab?.type === 'terminal' ? (tab.agentStatus?.agentType ?? null) : null
  return isUnchattableAgentName(liveAgent)
}

/** The agent the host names for this terminal, by its live status or else by
 *  the agent it launched there, is one the phone cannot chat with. An Orca
 *  launch of `agy` has no status until the agent's first hook, and a chat view
 *  kept for the tab must not draw an empty chat over it meanwhile. Null when
 *  the named agent can chat, or none is named. */
export function unchattablePaneAgent(tab: MobileNativeChatTab | null): string | null {
  if (tab?.type !== 'terminal') {
    return null
  }
  const liveAgent = tab.agentStatus?.agentType ?? null
  const named = liveAgent != null && liveAgent !== 'unknown' ? liveAgent : (tab.launchAgent ?? null)
  return named != null && isUnchattableAgentName(named) ? named : null
}

function isUnchattableAgentName(agent: string | null): boolean {
  return (
    agent != null &&
    agent !== 'unknown' &&
    !isNativeChatSupportedAgent(agent) &&
    !WRAPS_CLAUDE_CODE.has(agent)
  )
}

/** Whether the tab can toggle into native chat — gates the long-press item. */
export function canShowMobileNativeChat(
  tab: MobileNativeChatTab | null,
  nativeChatTranscriptIsLocalReadable = false
): boolean {
  return resolveMobileNativeChat(tab, nativeChatTranscriptIsLocalReadable) !== null
}

export function resolveMobileNativeChatFileSessionId(
  tab: MobileNativeChatTab | null
): string | null {
  if (tab?.type === 'agent-session') {
    return tab.sessionId ?? null
  }
  if (tab?.type === 'terminal') {
    return tab.agentStatus?.providerSession?.id ?? null
  }
  return null
}
