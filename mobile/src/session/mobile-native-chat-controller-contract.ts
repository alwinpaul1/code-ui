import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import type {
  TerminalHudContextWindow,
  TerminalHudObservation,
  TerminalAgentMode,
  TerminalPermissionMode
} from './mobile-terminal-hud-parse'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import type {
  AskAnswerSelection,
  AskPrompt,
  parseAskFromStatus
} from '../../../src/shared/native-chat-ask'
import type { detectAgentPermission } from './mobile-native-chat-permission'
import type { parseAgentQuestion } from './mobile-native-chat-question'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatPendingMessage } from './use-mobile-native-chat-drafts'
import type { useMobileNativeChatSession } from './use-mobile-native-chat-session'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'

export type MobileNativeChatController = {
  /** Whether a tab's effective view is chat (per-tab override, else the default). */
  isTabChatView: (tabId: string) => boolean
  toggleTabChatView: (tabId: string) => void
  /** True while the active chat tab is temporarily showing its terminal (after a
   *  slash command was dispatched from chat); `endTerminalPeek` returns to chat. */
  terminalPeekActive: boolean
  endTerminalPeek: () => void
  /** Terminal-vs-chat is still being read from storage; the dock holds so it
   *  does not flash the terminal command box before chat mounts. */
  viewResolved: boolean
  /** Active tab can show chat at all; the header offers a chat/terminal toggle. */
  activeChatEligible: boolean
  showNativeChat: boolean
  showNativeChatRef: MutableRefObject<boolean>
  /** Resolved agent for the active chat tab (names the empty-state copy). */
  nativeChatAgent: string | null
  chatComposerText: string
  setChatComposerText: Dispatch<SetStateAction<string>>
  getChatComposerEditGeneration: () => number
  chatPending: MobileNativeChatPendingMessage[]
  nativeChatQueuedMessages?: string[]
  chatImagePreviewsByMessageId: Record<string, string[]>
  nativeChatSession: ReturnType<typeof useMobileNativeChatSession>
  nativeChatAgentWorking: boolean
  nativeChatStreamingText?: string
  /** Agent mid-turn, regardless of whether chat is the visible view. */
  nativeChatStreamLive: boolean
  /** Host/workspace/tab/session scope for stateful streaming suppression. */
  nativeChatStreamScopeKey: string
  nativeChatPermission: ReturnType<typeof detectAgentPermission>
  nativeChatQuestion: ReturnType<typeof parseAgentQuestion>
  /** The pending ask, already null while dismissed (dismissal lives here so it
   *  survives the chat-view subtree unmounting on a view toggle). */
  nativeChatAsk: ReturnType<typeof parseAskFromStatus>
  /** Stable key for the current ask card (keys the card component). */
  nativeChatAskKey: string | null
  /** Hide the current ask until a genuinely different question arrives. */
  dismissNativeChatAsk: () => void
  handleNativeChatAnswerAsk: (
    prompt: AskPrompt,
    selections: AskAnswerSelection[]
  ) => Promise<boolean>
  handleNativeChatCancelAsk: () => Promise<boolean>
  handleNativeChatRespondPermission: (text: string) => Promise<boolean>
  /** Drop one message Claude Code has queued behind the running turn. */
  prepareNativeChatImageSend?: () => Promise<void>
  handleNativeChatCancelQueued: (id: string) => Promise<boolean>
  handleNativeChatStop: () => void
  nativeChatFilePaths: string[]
  loadNativeChatFiles: (query: string) => void
  /** Installed skills and plugin commands for the `/` menu (lazy, per worktree). */
  nativeChatSkills: DiscoveredSkill[]
  loadNativeChatSkills: () => void
  handleNativeChatQuestionAnswer: (text: string) => Promise<boolean>
  handleNativeChatSend: (text: string, images?: string[]) => Promise<boolean>
  /** Outcome-preserving send: callers that pasted terminal input beforehand
   *  (image sends) must see 'unknown' to heal a possibly-orphaned paste. Such a
   *  caller passes its own `deadline` so the paste it already spent and this text
   *  body share one budget instead of holding the composer for two. */
  handleNativeChatSendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number,
    attachments?: readonly {
      id?: string
      path: string
      previewUri: string
    }[]
  ) => Promise<MobileNativeChatSendOutcome>
  /** Launch-context text still parked on the agent's TUI input line, or null.
   *  Image sends read it to size their leading clear (one Ctrl+U per line). */
  readSeededLaunchDraft: () => string | null
  /** Model/session-option pickers for the composer, or null when the active
   *  agent has no session-option catalog. */
  nativeChatSessionOptions: MobileNativeChatSessionOptionPickersProps | null
  /** Context window figure read from the desktop status line, or null. */
  nativeChatContextWindow: TerminalHudContextWindow | null
  /** Permission mode from the terminal footer, or null when no status line is observed. */
  nativeChatPermissionMode: TerminalPermissionMode | null
  /** Codex collaboration mode (Default / Plan) from its footer, or null. */
  nativeChatAgentMode: TerminalAgentMode | null
  /** Re-read the terminal screen now (after a Shift+Tab, so the mode pill follows). */
  refreshNativeChatHud: () => Promise<TerminalHudObservation | null>
}

export type MobileNativeChatControllerArgs = {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  activeSessionTab: MobileNativeChatTab | null
  activeSessionTabId: string | null
  activeHandleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  nativeChatTranscriptIsLocalReadable: boolean
  nativeChatInputLeaseReady: boolean
  /** Live socket state; the lease collapses on disconnect but one render later. */
  connState: ConnectionState
  onSendError: (message: string) => void
  /** Retires a held failure banner. Any accepted chat write clears it — a delivered
   *  answer or permission reply must not sit under a stale "not sent". */
  onSendResolved: () => void
}
