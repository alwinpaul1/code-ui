/** Whether the terminal's own input bar may sit under the session.
 *  Chat UI owns that spot once the tab is a chat, including the moment a Grok
 *  session is opening and its transcript id has not arrived. Showing the
 *  terminal bar then paints it under the chat field for a frame. */
export function shouldShowTerminalCommandDock(args: {
  blockedByOtherPanel: boolean
  showNativeChat: boolean
  /** The tab's view is chat, even if the chat surface is not mounted yet. */
  chatViewSelected: boolean
  /** Structured sessions have no PTY, so the terminal bar does not belong. */
  agentSession: boolean
  viewResolved: boolean
  loading: boolean
}): boolean {
  if (
    args.blockedByOtherPanel ||
    args.showNativeChat ||
    args.chatViewSelected ||
    args.agentSession ||
    args.loading ||
    !args.viewResolved
  ) {
    return false
  }
  return true
}
