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
/** The reconnect latch holds no status the phone read before the drop. */
const NOTHING_PENDING = Symbol('nothing pending')
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
  // Its own mark for "nothing pending": a tab status can itself be null, and a
  // reconnect that came back to one disarmed a latch keyed on null (combined
  // review of fix/prompt-leak, 2026-09-27).
  const readRef = useRef<{ connected: boolean; stale: AgentStatusPromptSource | undefined | typeof NOTHING_PENDING }>({
    connected,
    stale: NOTHING_PENDING
  })
  if (connected && !readRef.current.connected) {
    readRef.current = { connected, stale: status }
  } else {
    readRef.current = { ...readRef.current, connected }
  }
  // A null status is no reading: it neither is the first read nor ends the
  // wait for one (pre-merge review of 06911823).
  const firstRead = readRef.current.stale !== NOTHING_PENDING && status != null && status !== readRef.current.stale
  if (firstRead) {
    readRef.current = { connected, stale: NOTHING_PENDING }
  }
  // Reduced during render: the status is a prop of this render, and the
  // reducer is pure and idempotent for the same input, so a re-render with
  // the same status changes nothing.
  stateRef.current = observeAgentStatusPrompt(stateRef.current, sessionKey, status, { firstRead })
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
