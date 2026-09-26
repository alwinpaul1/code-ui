import type { AgentHudBeacon, DesktopPrompt } from './agent-hud-beacon'
import { isSubagentMessagePrompt } from './mobile-native-chat-agent-messages'

/**
 * A session's subagent messages, kept on its beacon apart from the desktop
 * prompts (`AgentHudBeacon.agentMessagePrompts`).
 *
 * The chat draws each as a "Message from" row, and the prompt hook is that
 * row's only source. The beacon keeps the last 40 prompts of a terminal
 * (MAX_DESKTOP_PROMPTS in agent-hud-beacon.ts), and every prompt the hook
 * fires for counts, so after 40 more a message scrolled off that list and
 * its row vanished from the chat (review of 2026-09-26). This list is stored
 * with the rest of the beacon (agent-hud-beacon-warm-start.ts).
 */

/** `restored`: read back from the warm-start store, not heard this run. */
export type AgentMessagePrompt = DesktopPrompt & { restored?: true }

/** A session's subagent messages the chat keeps drawing; oldest shed first.
 *  Each is up to the hook's 2,000 characters, and the whole beacon goes to
 *  one warm-start record. */
export const AGENT_MESSAGE_PROMPT_CAP = 32

/** The subagent messages with `next` kept when it is one, once by nonce; the
 *  same list back otherwise. */
export function keepAgentMessagePrompt(
  previous: readonly AgentMessagePrompt[] | undefined,
  next: DesktopPrompt | null
): AgentMessagePrompt[] | undefined {
  if (!next || !isSubagentMessagePrompt(next) || previous?.some((prompt) => prompt.nonce === next.nonce)) {
    return previous as AgentMessagePrompt[] | undefined
  }
  return [...(previous ?? []), next].slice(-AGENT_MESSAGE_PROMPT_CAP)
}

/** The merged beacon with the prompt it just carried kept, when that prompt
 *  is a subagent's message. The same object otherwise. */
export function withAgentMessagePrompt(beacon: AgentHudBeacon, next: DesktopPrompt | null): AgentHudBeacon {
  const kept = keepAgentMessagePrompt(beacon.agentMessagePrompts, next)
  return kept === beacon.agentMessagePrompts ? beacon : { ...beacon, agentMessagePrompts: kept }
}

/** A stored record's subagent messages, marked as not heard this run: the
 *  chat has no anchor for them in memory, and draws each only once the row
 *  the hook named is loaded (mobile-native-chat-agent-message-rows.ts). A
 *  record from before this list has them among its desktop prompts. */
export function withRestoredAgentMessages(beacon: AgentHudBeacon): AgentHudBeacon {
  let kept = beacon.agentMessagePrompts
  for (const prompt of beacon.desktopPrompts ?? []) {
    kept = keepAgentMessagePrompt(kept, prompt)
  }
  return kept ? { ...beacon, agentMessagePrompts: kept.map((prompt) => ({ ...prompt, restored: true })) } : beacon
}
