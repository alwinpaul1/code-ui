import { pickNextSessionTabAfterClose } from './mobile-session-tab-history'
import { canShowMobileNativeChat, resolveMobileNativeChat } from './mobile-native-chat-eligibility'
import { buildFileReaderLineMention } from './mobile-file-reader-line-mention'
import type { FileReaderLineRange } from './mobile-file-reader-line-selection'
import type { MobileSessionTab } from './mobile-session-route-types'

type ChatCapableTab = Extract<MobileSessionTab, { type: 'terminal' | 'agent-session' }>

export type FileReaderAskAboutLinesPlan = {
  /** The tab to switch to — the SDK lane's own 'agent-session' tab, or a
   *  'terminal' tab (the PTY lane, structured or not; both share one
   *  composer — see MobileNativeChatController's showNativeChat). */
  targetTab: ChatCapableTab
  mention: string
  agent: string | null
}

/**
 * Where the file reader's "Ask about lines"/"Ask about file" should land:
 * the most recently visited chat-capable tab other than the file tab itself
 * (reusing the same "most recent, else newest remaining" rule a closed tab's
 * successor is picked by), with the mention already formatted for whatever
 * agent that tab reports. `null` when there is no chat-capable tab open at
 * all — nowhere for the mention to go.
 */
export function planFileReaderAskAboutLines(args: {
  relativePath: string
  range: FileReaderLineRange | null
  tabs: readonly MobileSessionTab[]
  visitHistory: readonly string[]
  currentTabId: string | null
  nativeChatTranscriptIsLocalReadable: boolean
}): FileReaderAskAboutLinesPlan | null {
  // type alone isn't enough — a plain shell is a 'terminal' tab too, and has
  // nothing running in it that could read an @mention.
  const chatCapable = args.tabs.filter(
    (tab): tab is ChatCapableTab =>
      (tab.type === 'terminal' || tab.type === 'agent-session') &&
      canShowMobileNativeChat(tab, args.nativeChatTranscriptIsLocalReadable)
  )
  const targetTab = args.currentTabId
    ? pickNextSessionTabAfterClose(chatCapable, args.visitHistory, args.currentTabId)
    : (chatCapable.at(-1) ?? null)
  if (!targetTab) {
    return null
  }
  const agent =
    resolveMobileNativeChat(targetTab, args.nativeChatTranscriptIsLocalReadable)?.agent ?? null
  return { targetTab, agent, mention: buildFileReaderLineMention(args.relativePath, args.range, agent) }
}
