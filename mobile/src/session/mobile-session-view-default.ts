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
