import { useMemo, useRef } from 'react'
import type { DesktopPrompt } from './agent-hud-beacon'
import {
  EMPTY_AGENT_STATUS_PROMPTS,
  observeAgentStatusPrompt,
  type AgentStatusPromptSource
} from './agent-status-prompts'
import { mergeDesktopPrompts } from './desktop-prompt-merge'
import type { StatusSubagentMessage } from './mobile-native-chat-agent-messages'

const NO_PROMPTS: DesktopPrompt[] = []
const NO_AGENT_MESSAGES: readonly StatusSubagentMessage[] = []

/** The desktop prompts of the session a tab shows, read off its
 *  `agentStatus.prompt` as it changes, merged with the beacon's. Keyed on
 *  the session so a reused terminal never carries the last session's
 *  prompts into the next. */
export function useAgentStatusPrompts(
  sessionKey: string | null,
  status: AgentStatusPromptSource | undefined,
  beacon: readonly DesktopPrompt[] | undefined,
  /** Whether the host is connected now. The first status read after a
   *  reconnect is a first read (observeAgentStatusPrompt). */
  connected = true
): { prompts: DesktopPrompt[]; agentMessages: readonly StatusSubagentMessage[] } {
  const stateRef = useRef(EMPTY_AGENT_STATUS_PROMPTS)
  // The status the phone held when the link came back, which it read before;
  // the next one it gets is the first read since.
  const readRef = useRef<{ connected: boolean; stale: AgentStatusPromptSource | undefined | null }>({ connected, stale: null })
  if (connected && !readRef.current.connected) {
    readRef.current = { connected, stale: status }
  } else {
    readRef.current = { ...readRef.current, connected }
  }
  const firstRead = readRef.current.stale !== null && status !== readRef.current.stale
  if (firstRead) {
    readRef.current = { connected, stale: null }
  }
  // Reduced during render: the status is a prop of this render, and the
  // reducer is pure and idempotent for the same input, so a re-render with
  // the same status changes nothing.
  stateRef.current = observeAgentStatusPrompt(stateRef.current, sessionKey, status, { firstRead })
  const prompts = stateRef.current.prompts
  const merged = useMemo(() => mergeDesktopPrompts(prompts, beacon ?? NO_PROMPTS), [prompts, beacon])
  return { prompts: merged, agentMessages: stateRef.current.agentMessages ?? NO_AGENT_MESSAGES }
}
