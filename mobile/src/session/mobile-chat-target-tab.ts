import { pickNextSessionTabAfterClose } from './mobile-session-tab-history'
import { canShowMobileNativeChat, resolveMobileNativeChat } from './mobile-native-chat-eligibility'
import type { MobileSessionTab } from './mobile-session-route-types'

export type ChatCapableTab = Extract<MobileSessionTab, { type: 'terminal' | 'agent-session' }>

export type ChatTargetTab = {
  /** The SDK lane's own 'agent-session' tab, or a 'terminal' tab (the PTY
   *  lane, structured or not; both share one composer — see
   *  MobileNativeChatController's showNativeChat). */
  targetTab: ChatCapableTab
  agent: string | null
}

/**
 * Extracted from planFileReaderAskAboutLines so a second gesture (the
 * terminal's "Ask about this screen") can land on the same tab a file's
 * "Ask about lines" would, without a second implementation of "which chat
 * lands this text" — see mobile-terminal-ask-about-screen-plan.ts.
 *
 * The chat-capable tab to route text into: the most recently visited one
 * other than `excludeTabId` (reusing the same "most recent, else newest
 * remaining" rule a closed tab's successor is picked by). `excludeTabId` is
 * only ever a SKIP inside that history walk-back — a tab absent from the
 * chat-capable filter (a file tab, a plain shell) is never reachable anyway,
 * so excluding it changes nothing; passing the CALLER's own tab id here (the
 * terminal being asked about) matters only when that tab is itself
 * chat-capable, where skipping it routes to some other open chat instead.
 * `null` when there is no chat-capable tab open at all.
 */
export function resolveChatTargetTab(args: {
  tabs: readonly MobileSessionTab[]
  visitHistory: readonly string[]
  excludeTabId: string | null
  nativeChatTranscriptIsLocalReadable: boolean
}): ChatTargetTab | null {
  // type alone isn't enough — a plain shell is a 'terminal' tab too, and has
  // nothing running in it that could read appended text.
  const chatCapable = args.tabs.filter(
    (tab): tab is ChatCapableTab =>
      (tab.type === 'terminal' || tab.type === 'agent-session') &&
      canShowMobileNativeChat(tab, args.nativeChatTranscriptIsLocalReadable)
  )
  const targetTab = args.excludeTabId
    ? pickNextSessionTabAfterClose(chatCapable, args.visitHistory, args.excludeTabId)
    : (chatCapable.at(-1) ?? null)
  if (!targetTab) {
    return null
  }
  const agent =
    resolveMobileNativeChat(targetTab, args.nativeChatTranscriptIsLocalReadable)?.agent ?? null
  return { targetTab, agent }
}
