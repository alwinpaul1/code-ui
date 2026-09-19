import { AGENT_STATUS_MAX_FIELD_LENGTH } from '../../../src/shared/agent-status-field-normalization'
import type { DesktopPrompt } from './agent-hud-beacon'

/**
 * A desktop prompt read off the tab's `agentStatus.prompt`.
 *
 * Orca installs its own Claude Code hooks for every session on the machine
 * (`~/.claude/settings.json`: `UserPromptSubmit` and the rest post to the
 * runtime's hook port), and the session-tab snapshot the phone already
 * subscribes to carries the result: `agentStatus.prompt` is the last prompt
 * the session took, hand-started or not, from whichever client sent it —
 * the desktop, the Claude app, this phone. Read on this machine 2026-09-19
 * for a hand-started session: the prompt the user had just typed on the
 * desktop, while the agent was working.
 *
 * That replaces the transcript tail, which reached the same rows only by
 * opening a `tail -F` terminal on the desktop — a tab the user saw and did
 * not want. What the hook path cannot give: the field is capped at
 * AGENT_STATUS_MAX_FIELD_LENGTH characters (a longer prompt arrives cut,
 * and is drawn as cut), and the queue itself is not in the status, so the
 * queue box reads the screen alone.
 */
export type AgentStatusPromptSource = {
  prompt?: string | null
  updatedAt?: number | null
  stateStartedAt?: number | null
  /** The session the row's last hook event came from (Claude `session_id`). */
  providerSession?: { id: string } | null
} | null

export type AgentStatusPromptState = {
  /** The session the prompts belong to; a new session starts over. */
  sessionKey: string | null
  /** The last prompt text seen, so a status ping that repeats it (tool
   *  events keep the field) does not become a second bubble. */
  last: string | null
  prompts: readonly DesktopPrompt[]
}

export const EMPTY_AGENT_STATUS_PROMPTS: AgentStatusPromptState = {
  sessionKey: null,
  last: null,
  prompts: []
}

/** Bounded: what the chat can still anchor; older ones are in the transcript. */
const PROMPT_CAP = 64

export function observeAgentStatusPrompt(
  state: AgentStatusPromptState,
  sessionKey: string | null,
  status: AgentStatusPromptSource | undefined
): AgentStatusPromptState {
  if (sessionKey !== state.sessionKey) {
    // The prompts start over; the last TEXT seen does not. The pane caches
    // `prompt` across events, and a hook from another session on the same
    // pane flips `providerSession` there and back — a nested `claude` started
    // from the agent's own Bash tool inherits the terminal's ORCA_PANE_KEY and
    // posts as this pane (2026-09-19). On the way back the row carried that
    // session's text with this session's id, and a reset to null took it as a
    // new prompt of this chat.
    state = { sessionKey, last: state.last, prompts: [] }
  }
  if (sessionKey === null) {
    return state
  }
  const text = typeof status?.prompt === 'string' ? status.prompt : ''
  if (text.trim().length === 0) {
    // Empty is "unknown" or a pane reset: the next prompt is new even if it
    // repeats the last text.
    return state.last === null ? state : { ...state, last: null }
  }
  if (text === state.last) {
    return state
  }
  const owner = status?.providerSession?.id
  if (typeof owner === 'string' && owner.length > 0 && owner !== sessionKey) {
    // Another session's row on this pane. Its prompt is not this chat's, but
    // it is SEEN: the pane will still be carrying the text when it flips back.
    return { ...state, last: text }
  }
  const at = typeof status?.updatedAt === 'number' && Number.isFinite(status.updatedAt) ? status.updatedAt : null
  const prompt: DesktopPrompt = {
    nonce: `status:${sessionKey}:${at ?? 'x'}:${state.prompts.length}`,
    text,
    ...(text.length >= AGENT_STATUS_MAX_FIELD_LENGTH ? { cut: true } : {}),
    ...(at !== null ? { at } : {})
  }
  const prompts = [...state.prompts, prompt].slice(-PROMPT_CAP)
  return { sessionKey, last: text, prompts }
}
