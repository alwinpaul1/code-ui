import type { ClaudeSpinner } from './mobile-terminal-spinner-line'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'
import type { ScreenSentPhotos } from './mobile-terminal-sent-photos'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { BeaconAgentMessage, StatusSubagentMessage } from './mobile-native-chat-agent-messages'
import type { InlineQueueEditor } from './use-mobile-native-chat-queue-editor'
import type { AskDismissOutcome } from './use-mobile-native-chat-ask-dismiss'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import type { MobileNativeChatTab } from './mobile-native-chat-eligibility'
import type { NativeChatSessionIdentity } from './native-chat-kept-session'
import type {
  TerminalHudContextWindow,
  TerminalHudObservation,
  TerminalAgentMode,
  TerminalPermissionMode
} from './mobile-terminal-hud-parse'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import type {
  AgentSessionBackgroundTaskState,
  AgentSessionSlashCommand
} from '../../../src/shared/agent-session-wire'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import type { StructuredRewindSupport } from './mobile-structured-agent-rewind'
import type {
  AskAnswerSelection,
  AskPrompt,
  parseAskFromStatus
} from '../../../src/shared/native-chat-ask'
import type { detectAgentPermission } from './mobile-native-chat-permission'
import type { parseAgentQuestion } from './mobile-native-chat-question'
import type { NativeChatTerminalWait } from './mobile-terminal-permission-options-merge'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendFollow } from './mobile-native-chat-send-follow'
import type { MobileNativeChatPendingMessage } from './use-mobile-native-chat-drafts'
import type { useMobileNativeChatSession } from './use-mobile-native-chat-session'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatSettledTurns } from '../../../src/shared/native-chat-turn-status'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

export type MobileNativeChatController = {
  /** Whether a tab's effective view is chat (per-tab override, else the default). */
  isTabChatView: (tabId: string, agent?: string | null) => boolean
  toggleTabChatView: (tabId: string, agent?: string | null) => void
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
  /** The tab is in Chat UI, including the frames before its transcript is ready. */
  chatViewSelected: boolean
  showNativeChatRef: MutableRefObject<boolean>
  /** Resolved agent for the active chat tab (names the empty-state copy). */
  nativeChatAgent: string | null
  chatComposerText: string
  setChatComposerText: Dispatch<SetStateAction<string>>
  /** Appends a mention to any tab's draft, active or not — the file reader's
   *  "Ask about lines" writes into the chat tab it is switching back to. */
  appendComposerMention: (tabId: string, mention: string) => void
  /** Bumped once per composer-focus request; the composer focuses its text
   *  field on every increase (mirrors the model sheet's openRequest). */
  composerFocusRequest: number
  requestComposerFocus: () => void
  getChatComposerEditGeneration: () => number
  chatPending: MobileNativeChatPendingMessage[]
  /** The phone's photo sends the draft store has not read back yet for this
   *  chat (waitingPhotoSends): the hook's copies of them are not drawn. */
  chatWaitingPhotoSends?: readonly MobileNativeChatPendingMessage[]
  /** Keep a witnessed desktop message with the phone's own sends; see mobile-native-chat-remember-echo.ts. */
  rememberEcho: (id: string, text: string, anchorId: string | null) => void
  /** Own sends the agent took out of its queue box, which no row is owed for
   *  (isTakenSend in mobile-native-chat-pending-echo.ts). */
  takeOwnSends?: (ids: readonly string[]) => void
  nativeChatQueuedMessages?: string[]
  /** Whether the screen read behind `nativeChatQueuedMessages` could see the
   *  agent's queue box: false while the link is down, before a watch's first
   *  read, on the structured lane, while an entry is selected at the desk or a
   *  dialog covers the composer (mobile-terminal-queue-read.ts). The box is
   *  then unknown, not empty, and the queue-box witness changes nothing on it
   *  (use-absorbed-queue-echoes.ts). Absent reads as readable. */
  nativeChatQueueReadable?: boolean
  /** Whether a queued entry can be recalled for editing from the read behind
   *  `nativeChatQueuedMessages` (QueueBoxRead.editable). The pencil is offered
   *  only then: under a Claude rule that carries the session name Orca
   *  publishes no draft and the recall is refused (native-queue-editor.ts). */
  nativeChatQueueEditable?: boolean
  chatImagePreviewsByMessageId: Record<string, string[]>
  nativeChatSession: ReturnType<typeof useMobileNativeChatSession>
  /** Structured lane: drives the per-turn status row and live tool progress. */
  nativeChatStructured: boolean
  /** Provider-authored copy for the live turn tail. Null off the structured lane. */
  nativeChatTurnActivity: { kind: 'description'; text: string } | null
  /** Whether the live turn is reasoning right now, from its journal content.
   *  Upstream carries this beside the activity text in one
   *  `NativeChatLiveTurnIndicator`; this fork already threads the activity text
   *  on its own prop, so only the reading it lacked is added (Orca #19977). */
  nativeChatTurnThinking: boolean
  /** Structured lane: host-recorded turn timing for the per-turn status rows (Orca #19695). */
  nativeChatWorkingStartedAt: number | null
  nativeChatSettledTurns: NativeChatSettledTurns | null
  nativeChatAgentWorking: boolean
  /** Claude's own turn is over by its transcript, whatever the desktop's status says (claude-lead-turn-ended.ts). */
  nativeChatLeadTurnEnded: boolean
  /** Whether there is a turn to interrupt. On the structured lane a send reads
   *  as working before the provider opens one, and Stop cannot act until it does. */
  nativeChatCanStop: boolean
  /** The pane's live hook status, for reconciling background tasks the transcript cannot retire.
   *  Null while it is a nested agent's, not the chat agent's (native-chat-kept-session.ts). The
   *  pane's last hook row while Orca stands in its title with one that says nothing about
   *  background work, when the phone watched the pane since (agent-status-stand-in.ts). */
  nativeChatAgentStatus: AgentStatusEntry | null
  /** The session the chat reads, and a nested agent's it does not; null for a tab with no chat. */
  nativeChatSessionIdentity: NativeChatSessionIdentity | null
  /** Task ids the active tab's HUD beacon reports finished; see agent-hud-beacon.ts. */
  nativeChatBackgroundTaskReport: ActiveTabBackgroundTaskReport
  /** The host's own background-task roster on the structured lane. `undefined`
   *  leaves the tab to the transcript reader; see mobile-structured-background-tasks.ts. */
  nativeChatBackgroundTasks: AgentSessionBackgroundTaskState | null | undefined
  /** Stops one named background task, where the roster says the host accepts it. */
  handleNativeChatStopBackgroundTask: (
    taskId: string,
    report?: (message: string) => void
  ) => Promise<boolean>
  nativeChatStreamingText?: string
  /** Agent mid-turn, regardless of whether chat is the visible view. */
  nativeChatStreamLive: boolean
  /** Host/workspace/tab/session scope for stateful streaming suppression. */
  nativeChatStreamScopeKey: string
  nativeChatPermission: ReturnType<typeof detectAgentPermission>
  nativeChatQuestion: ReturnType<typeof parseAgentQuestion>
  /** The agent waits on a prompt the chat has no card for; the chat says so
   *  (mobile-terminal-permission-options-merge.ts). Null while nothing waits. */
  nativeChatTerminalWait: NativeChatTerminalWait | null
  /** Shows the active tab's terminal, where that prompt can be answered,
   *  without changing the tab's saved chat preference. */
  openNativeChatTerminal: () => void
  /** The pending ask, already null while dismissed (dismissal lives here so it
   *  survives the chat-view subtree unmounting on a view toggle). */
  nativeChatAsk: ReturnType<typeof parseAskFromStatus>
  /** Stable key for the current ask card (keys the card component). */
  nativeChatAskKey: string | null
  /** When this phone's answer to the shown ask was accepted, while its card
   *  shows it as sent (the hook row still has the question); else null. */
  nativeChatAskSentAt: number | null
  /** Hide the current ask until a genuinely different question arrives; an
   *  'answered' one stays up as sent until the hook row lets go of it. */
  dismissNativeChatAsk: (outcome?: AskDismissOutcome) => void
  handleNativeChatAnswerAsk: (
    prompt: AskPrompt,
    selections: AskAnswerSelection[]
  ) => Promise<boolean>
  handleNativeChatCancelAsk: () => Promise<boolean>
  handleNativeChatCancelPrompt?: (prompt?: {
    itemId: string
    expectedRevision: number
  }) => Promise<boolean>
  handleNativeChatRespondPermission: (text: string) => Promise<boolean>
  /** Rejects a Claude Code plan review with typed feedback in one tap. TUI
   *  lane only — undefined in the structured lane, where the comment sheet
   *  never opens (use-mobile-native-chat-plan-feedback-send.ts). */
  handleNativeChatRespondPermissionWithComment?: (send: string, comment: string) => Promise<boolean>
  prepareNativeChatImageSend?: () => Promise<void>
  /** Uses the original agent input for desktop and mobile queued messages. */
  openNativeChatQueueEditor?: (index: number, tapped: string) => Promise<void>
  /** Claude's send-now key (2.1.275): interrupt the turn, send the whole
   *  queue. Resolves to whether the host accepted the write. */
  sendNativeChatQueueNow?: () => Promise<boolean>
  nativeChatQueueEditor?: InlineQueueEditor | null
  handleNativeChatStop: () => void
  nativeChatFilePaths: string[]
  loadNativeChatFiles: (query: string) => void
  /** Installed skills and plugin commands for the `/` menu (lazy, per worktree). */
  nativeChatSkills: DiscoveredSkill[]
  /** What a structured chat can put on its `/` menu: the surface the running
   *  session reports for itself (which beats both the curated catalog and the
   *  disk scan, and is undefined until it reports one), and the conversation
   *  commands the host can carry out. Undefined on the PTY lane, which keeps
   *  the curated catalog. */
  nativeChatCommandSurface?: {
    sessionCommands: readonly AgentSessionSlashCommand[] | undefined
    conversationCommands: readonly AgentSessionConversationCommand[]
    /** Whether the host will rewind this session; null until it has said. */
    rewindSupport: StructuredRewindSupport | null
    /** Rewinds the conversation (never files) to before a journalled user message. */
    rewindToItem: (itemId: string) => Promise<boolean>
  }
  loadNativeChatSkills: () => void
  handleNativeChatQuestionAnswer: (text: string) => Promise<boolean>
  handleNativeChatSend: (text: string, images?: string[]) => Promise<boolean>
  /** Outcome-preserving send: callers that pasted terminal input beforehand
   *  (image sends) must see 'unknown' to heal a possibly-orphaned paste. Such a
   *  caller passes its own `deadline` so the paste it already spent and this text
   *  body share one budget instead of holding the composer for two. */
  /** Clears the composer as an image send starts; returns the undo for a
   *  failed paste. `images` also adds the optimistic bubble in this same call. */
  beginNativeChatImageSend: (text: string, images?: string[], imagePaths?: string[]) => (() => void) | null
  handleNativeChatSendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number,
    attachments?: readonly {
      id?: string
      path: string
      previewUri: string
      contentFingerprint?: string
    }[],
    /** The image hook's send follows its TAB, not the handle it started on
     *  (mobile-native-chat-send-follow.ts). */
    follow?: MobileNativeChatSendFollow
  ) => Promise<MobileNativeChatSendOutcome>
  /** Launch-context text still parked on the agent's TUI input line, or null.
   *  Image sends read it to size their leading clear (one Ctrl+U per line). */
  readSeededLaunchDraft: () => string | null
  /** Model/session-option pickers for the composer, or null when the active
   *  agent has no session-option catalog. */
  nativeChatSessionOptions: MobileNativeChatSessionOptionPickersProps | null
  /** Prompts from any client, the phone's own included: Orca's hook on the
   *  tab status (`agentStatus.prompt`) first, the HUD beacon's hook second.
   *  `at` is the hook's clock. */
  nativeChatDesktopPrompts: DesktopPrompt[]
  /** Messages the session's subagents sent it, off the same beacon; never in
   *  the desktop prompts (mobile-native-chat-agent-messages.ts). */
  nativeChatAgentMessages?: BeaconAgentMessage[]
  /** What the tab status carried of each subagent message (200 characters):
   *  the words of the screen's sender-only row on a tab with no prompt hook. */
  nativeChatStatusAgentMessages?: readonly StatusSubagentMessage[]
  /** Prompts the agent has already accepted, read off its own screen. */
  nativeChatScreenPrompts: string[]
  /** The peer-message rows on the agent's screen, one per row
   *  (mobile-terminal-peer-notices.ts); null until the first read since the
   *  chat began watching it. */
  nativeChatScreenPeerNotices: ScreenPeerRow[] | null
  /** Photos Claude painted above a prompt it took (mobile-terminal-sent-photos.ts). */
  nativeChatScreenSentPhotos: ScreenSentPhotos[]
  /** Whether this tab was launched with the prompt hook; null until a beacon lands. */
  nativeChatPromptHook: boolean | null
  /** Context window figure read from the desktop status line, or null. */
  nativeChatContextWindow: TerminalHudContextWindow | null
  /** The agent's own word about its model and effort — the status-line badge
   *  or the beacon — and nothing else. Null until it has spoken. This is what
   *  the header pill states; see session-model-pill.ts for why not the
   *  snapshot. */
  nativeChatLiveModel: { model: string | null; label: string | null; effort: string | null }
  /** Permission mode from the terminal footer, or null when no status line is observed. */
  nativeChatPermissionMode: TerminalPermissionMode | null
  /** Codex collaboration mode (Default / Plan) from its footer, or null. */
  nativeChatAgentMode: TerminalAgentMode | null
  /** Claude Code's spinner line off the screen, for the status line; null on
   *  the structured lane and when no spinner is painted. */
  nativeChatSpinner?: ClaudeSpinner | null
  /** Re-read the terminal screen now (after a Shift+Tab, so the mode pill follows). */
  refreshNativeChatHud: () => Promise<TerminalHudObservation | null>
}

export type MobileNativeChatControllerArgs = {
  client: RpcClient | null
  hostId: string
  worktreeId: string
  activeSessionTab: MobileNativeChatTab | null
  activeSessionTabId: string | null
  /** The active PTY as the caller's render knows it — what every render-time
   *  derivation must use. `activeHandleRef` is for callbacks and effects. */
  activeHandle: string | null
  activeHandleRef: MutableRefObject<string | null>
  deviceTokenRef: MutableRefObject<string | null>
  nativeChatTranscriptIsLocalReadable: boolean
  nativeChatInputLeaseReady: boolean
  /** Live socket state; the lease collapses on disconnect but one render later. */
  connState: ConnectionState
  /** Whether the tab list is one the host sent since the screen opened. Until
   *  it is, the screen shows the tabs the last visit cached, and the chat must
   *  not take the host's first status after them for one it watched arrive
   *  (use-agent-status-prompts.ts). */
  tabsLive: boolean
  /** Host capability fact from the shared runtime status probe (Orca #20601). */
  agentSessionPromptCancelSupported?: boolean | null
  onSendError: (message: string) => void
  /** Retires a held failure banner. Any accepted chat write clears it — a delivered
   *  answer or permission reply must not sit under a stale "not sent". */
  onSendResolved: () => void
}
