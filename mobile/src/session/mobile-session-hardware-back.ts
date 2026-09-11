/**
 * What the hardware back button (or the back gesture) does inside a session.
 *
 * Terminal and chat are two views of one agent session. Back from the
 * terminal view of a tab that has a chat view returns to that chat, the way
 * the header toggle does; back from anywhere else leaves the session. Asked
 * for on 2026-09-11: back from terminal mode left the workspace instead of
 * switching to the chat UI.
 */
export type HardwareBackAction = { kind: 'show-chat'; tabId: string } | { kind: 'leave' }

export function hardwareBackAction(args: {
  activeTabId: string | null
  chatEligible: boolean
  chatVisible: boolean
}): HardwareBackAction {
  if (args.activeTabId && args.chatEligible && !args.chatVisible) {
    return { kind: 'show-chat', tabId: args.activeTabId }
  }
  return { kind: 'leave' }
}
