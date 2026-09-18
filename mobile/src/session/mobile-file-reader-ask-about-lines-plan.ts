import { resolveChatTargetTab, type ChatCapableTab } from './mobile-chat-target-tab'
import { buildFileReaderLineMention } from './mobile-file-reader-line-mention'
import type { FileReaderLineRange } from './mobile-file-reader-line-selection'
import type { MobileSessionTab } from './mobile-session-route-types'

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
  const target = resolveChatTargetTab({
    tabs: args.tabs,
    visitHistory: args.visitHistory,
    excludeTabId: args.currentTabId,
    nativeChatTranscriptIsLocalReadable: args.nativeChatTranscriptIsLocalReadable
  })
  if (!target) {
    return null
  }
  return {
    targetTab: target.targetTab,
    agent: target.agent,
    mention: buildFileReaderLineMention(args.relativePath, args.range, target.agent)
  }
}
