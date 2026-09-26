import { useEffect, useMemo, useRef } from 'react'
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
  beacon: readonly DesktopPrompt[] | undefined
): { prompts: DesktopPrompt[]; agentMessages: readonly StatusSubagentMessage[] } {
  const stateRef = useRef(EMPTY_AGENT_STATUS_PROMPTS)
  // Reduced during render: the status is a prop of this render, and the
  // reducer is pure and idempotent for the same input, so a re-render with
  // the same status changes nothing.
  stateRef.current = observeAgentStatusPrompt(stateRef.current, sessionKey, status)
  const prompts = stateRef.current.prompts
  // A prompt held back leaves one line saying why; a bubble that never
  // appears is otherwise the same as one lost (2026-09-26).
  const withheld = stateRef.current.withheld
  useEffect(() => {
    if (withheld !== null) {
      console.warn(withheld)
    }
  }, [withheld])
  const merged = useMemo(() => mergeDesktopPrompts(prompts, beacon ?? NO_PROMPTS), [prompts, beacon])
  return { prompts: merged, agentMessages: stateRef.current.agentMessages ?? NO_AGENT_MESSAGES }
}
