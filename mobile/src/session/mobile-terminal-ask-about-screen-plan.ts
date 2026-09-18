import { resolveChatTargetTab, type ChatTargetTab } from './mobile-chat-target-tab'
import type { MobileSessionTab } from './mobile-session-route-types'

/**
 * Where a TUI-lane terminal's "Ask about this screen" should land — the same
 * target resolution mobile-file-reader-ask-about-lines-plan.ts uses (no
 * second implementation), excluding the terminal itself the way that plan
 * excludes the file tab it is called from. Excluding a tab that turns out
 * not to be chat-capable is a no-op; excluding one that IS (this terminal is
 * itself showing native chat) routes to whatever other chat tab was visited
 * most recently instead of trivially "landing on itself".
 *
 * `null` when there is no chat-capable tab open anywhere — the terminal is a
 * plain shell with nothing else open that could read the screen text. The
 * session menu omits the action entirely in that case (built from the same
 * inputs, no RPC needed to know it).
 */
export function planTerminalAskAboutScreen(args: {
  tabs: readonly MobileSessionTab[]
  visitHistory: readonly string[]
  terminalTabId: string | null
  nativeChatTranscriptIsLocalReadable: boolean
}): ChatTargetTab | null {
  return resolveChatTargetTab({
    tabs: args.tabs,
    visitHistory: args.visitHistory,
    excludeTabId: args.terminalTabId,
    nativeChatTranscriptIsLocalReadable: args.nativeChatTranscriptIsLocalReadable
  })
}
