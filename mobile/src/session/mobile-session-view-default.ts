import type { MobileSessionView } from '../storage/session-view-preferences'

const CHAT_DEFAULT_AGENTS = new Set(['claude', 'openclaude', 'codex'])

/** Header Chat/Terminal control. Hidden only when this tab cannot do Chat UI. */
export function mobileSessionChatViewToggle(args: {
  eligible: boolean
  chatVisible: boolean
  tabId: string | null
}): { label: 'Show terminal' | 'Show chat' } | null {
  if (!args.eligible || !args.tabId) {
    return null
  }
  return { label: args.chatVisible ? 'Show terminal' : 'Show chat' }
}

/** The agent name that decides a tab's DEFAULT view, which is not always the
 *  agent running in it.
 *
 *  A pane the desktop names as an agent pane — it launched the agent, or its
 *  hook lane owns it — is an agent tab, and an agent tab opens in Chat UI. A
 *  pane identified only by the transcript its agent disclosed is a terminal the
 *  person opened and typed into; flipping it to chat under their fingers is a
 *  glitch, so it gets the toggle and keeps the view it has. An explicit toggle
 *  still wins over both, because that is an override, not a default.
 *  (2026-09-14, from the phone: a hand-started `claude` offered no chat at all.)
 */
export function chatDefaultAgent(
  agent: string | null | undefined,
  source: 'launch' | 'status' | 'beacon' | 'transcript' | null | undefined
): string | null {
  if (agent == null || source === 'transcript') {
    return null
  }
  return agent
}

/** Claude, OpenClaude, and Codex open in Chat UI. Grok and everything else
 *  open in the terminal; Chat UI is still available from the header toggle. */
export function defaultSessionViewForAgent(
  agent: string | null | undefined,
  deviceDefault: MobileSessionView
): MobileSessionView {
  if (deviceDefault === 'terminal') {
    return 'terminal'
  }
  return agent != null && CHAT_DEFAULT_AGENTS.has(agent) ? 'chat' : 'terminal'
}
