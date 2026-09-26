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

/** `restored`: read back from the warm-start store, not heard this run.
 *  `drawnAfter`: the transcript row the chat drew it after, this run or the
 *  one it was stored in (mobile-native-chat-agent-message-rows.ts). */
export type AgentMessagePrompt = DesktopPrompt & { restored?: true; drawnAfter?: string }

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
export function withRestoredAgentMessages(beacon: AgentHudBeacon, handle?: string): AgentHudBeacon {
  let list = Array.isArray(beacon.agentMessagePrompts) ? beacon.agentMessagePrompts : undefined
  for (const prompt of Array.isArray(beacon.desktopPrompts) ? beacon.desktopPrompts : []) {
    list = keepAgentMessagePrompt(list, prompt)
  }
  const restored = list ? { ...beacon, agentMessagePrompts: list.map((prompt) => ({ ...prompt, restored: true as const })) } : beacon
  if (handle !== undefined) {
    keepAgentMessages(handle, restored)
  }
  return restored
}

/** What the warm-start write compares of a beacon's subagent messages. */
export function agentMessagesIdentity(prompts: readonly AgentMessagePrompt[] | undefined): string {
  return (prompts ?? []).map((prompt) => `${prompt.nonce}@${prompt.drawnAfter ?? ''}`).join(',')
}

/** The beacon with the row its message `nonce` was drawn after recorded;
 *  the same object when it holds no such message or already says so. */
export function withAgentMessagePlaced(handle: string, beacon: AgentHudBeacon, nonce: string, rowId: string): AgentHudBeacon {
  const prompts = beacon.agentMessagePrompts
  if (!prompts?.some((prompt) => prompt.nonce === nonce && prompt.drawnAfter !== rowId)) {
    return beacon
  }
  const placed = { ...beacon, agentMessagePrompts: prompts.map((prompt) => (prompt.nonce === nonce ? { ...prompt, drawnAfter: rowId } : prompt)) }
  keepAgentMessages(handle, placed)
  return placed
}

/**
 * Each terminal's subagent messages, kept past the drop of its beacon.
 *
 * The terminal cache is dropped on every worktree switch (resetAgentHudBeacons
 * from clearTerminalCache), beacons included, and the next beacon of the same
 * session started the list over. Its write then replaced the stored record,
 * list and all, so the rows were gone after the next relaunch too (review of
 * 2026-09-27). The list comes back with the session's next beacon. Bounded
 * like the warm start, oldest terminal shed first.
 */
const kept = new Map<string, { sessionId: string | null; prompts: AgentMessagePrompt[] }>()
const KEPT_TERMINALS = 24

export function keepAgentMessages(handle: string, beacon: AgentHudBeacon): void {
  if (!beacon.agentMessagePrompts?.length) {
    return
  }
  kept.delete(handle)
  kept.set(handle, { sessionId: beacon.sessionId, prompts: beacon.agentMessagePrompts })
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT_TERMINALS) {
      break
    }
    kept.delete(oldest)
  }
}

/** A new beacon of the session a dropped one spoke for, with its list back. */
function withKeptAgentMessages(handle: string, beacon: AgentHudBeacon): AgentHudBeacon {
  const held = kept.get(handle)
  if (!held || beacon.agentMessagePrompts?.length || (beacon.sessionId !== null && beacon.sessionId !== held.sessionId)) {
    return beacon
  }
  return { ...beacon, agentMessagePrompts: held.prompts }
}

/** The merged beacon of a terminal with its subagent messages: those a
 *  dropped beacon of the same session held when this one is the first since
 *  (`fresh`), and the prompt it just carried when that is one. Kept for the
 *  next drop. */
export function withAgentMessagesOf(
  handle: string,
  beacon: AgentHudBeacon,
  fresh: boolean,
  next: DesktopPrompt | null
): AgentHudBeacon {
  const merged = withAgentMessagePrompt(fresh ? withKeptAgentMessages(handle, beacon) : beacon, next)
  keepAgentMessages(handle, merged)
  return merged
}

export function resetKeptAgentMessagesForTests(): void {
  kept.clear()
}
