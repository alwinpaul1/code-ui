import type { ClaudeUsageSheetData } from './ClaudeUsageSheet'
import type { ClaudeChatGate } from './use-claude-anthropic-transcript'
import type { ClaudeChatLive } from './claude-chat-live'
import type { CcrSessionHeader } from './use-ccr-session-header'
import type { UndoNativeChatSendStart } from './mobile-native-chat-draft-send-start'
import type { ClaudeBackgroundStopTarget } from './claude-background-dialog'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'
import type { ScreenPeerRow } from './mobile-terminal-peer-notices'
import type { ScreenSentPhotos } from './mobile-terminal-sent-photos'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { RateLimitWindowReading } from './hud-rate-limit-notice'
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
import type {
  MobileNativeChatCommandRefusalCauses,
  MobileNativeChatSendErrorReporter
} from './use-mobile-native-chat-send-error'
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
import type { AgentImageShare } from './agent-image-share-context'
import type { MobileNativeChatSendFollow } from './mobile-native-chat-send-follow'
import type { MobileNativeChatPendingMessage } from './use-mobile-native-chat-drafts'
import type { useMobileNativeChatSession } from './use-mobile-native-chat-session'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatSettledTurns } from '../../../src/shared/native-chat-turn-status'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import type { MobileNativeChatVisualSource } from './mobile-native-chat-visual-read'
import type { BackgroundTasksConnection } from './MobileBackgroundTasksSheet'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'
import type { NativeChatAnthropicAttachments } from './use-native-chat-anthropic-send'
import type { SessionArtifact } from './session-artifacts'
import type { ClaudeTabAccountScope } from './use-claude-tab-account'

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
  /** Opens the composer's model sheet (the header menu's Change model). Counted beside the
   *  Codex `/model` interception's own request, so neither can swallow the other's. */
  requestModelSheet: () => void
  getChatComposerEditGeneration: () => number
  chatPending: MobileNativeChatPendingMessage[]
  /** Each outbox bubble's state, by row id: on its way (drawn as a plain sent bubble, no label)
   *  or "Not sent" (use-native-chat-outbox-recovery.ts). Optional: a stub controller has none. */
  nativeChatOutboxDeliveries?: Readonly<Record<string, OutboxDelivery>>
  retryNativeChatOutbox?: (rowId: string) => void
  /** Puts a "Not sent" bubble's words back in the composer and drops it. */
  editNativeChatOutbox?: (rowId: string) => void
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
  /** The words in the agent's own input on the same read (QueueBoxRead.input),
   *  '' when empty. A queued message that leaves the box into it was recalled
   *  for editing, not sent (queue-recalls.ts). Absent reads as empty. */
  nativeChatAgentInput?: string
  chatImagePreviewsByMessageId: Record<string, string[]>
  /** What a refused picture's placeholder needs to ask the agent for it; null
   *  where pictures are never asked of the host (agent-image-share-ask.ts). */
  nativeChatImageShare?: AgentImageShare | null
  nativeChatSession: ReturnType<typeof useMobileNativeChatSession>
  /** What a Claude tab's chat reads (use-claude-anthropic-transcript.ts): `off` for every other tab. */
  nativeChatAnthropicGate?: ClaudeChatGate
  /** A matched Claude tab's live state from Anthropic and which source drives it (claude-chat-live.ts). */
  nativeChatAnthropicLive?: ClaudeChatLive | null
  /** A matched Claude tab's Anthropic session: its title for the header, and where a rename of it
   *  goes (use-ccr-session-header.ts). Null for every other tab, and for every tab while
   *  CCR_SESSION_WRITES is off. */
  nativeChatAnthropicSession?: CcrSessionHeader | null
  /** The Anthropic account a Claude tab's chat belongs to, for artifact titles from the account's
   *  list (claude-artifact-account-context.ts); null where none is known. */
  nativeChatArtifactAccountId?: string | null
  /** Structured lane: drives the per-turn status row and live tool progress. */
  nativeChatStructured: boolean
  /** Structured lane with a live client: where the transcript's visuals are read from. */
  nativeChatVisualSource: MobileNativeChatVisualSource | null
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
  /** What a refused command's line stands on (Orca #25704); the bridge lane names none. */
  nativeChatCommandRefusalCauses: MobileNativeChatCommandRefusalCauses
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
  /** Stops one named background task: the structured lane by id, where the roster says the host
   *  accepts it; a terminal Claude tab through Claude's own Background dialog, by `target`. */
  handleNativeChatStopBackgroundTask: (
    taskId: string,
    report?: (message: string) => void,
    target?: ClaudeBackgroundStopTarget
  ) => Promise<boolean>
  /** A terminal Claude tab with a live connection: its rows take Claude's own Stop
   *  (use-claude-terminal-task-stop.ts). */
  nativeChatTerminalTaskStop: boolean
  /** The host connection, for the Background tasks sheet's "Status unknown" and its re-read. */
  nativeChatHostConnection: BackgroundTasksConnection
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
  /** The agent is confirmed waiting on the shown ask (its hook row is
   *  waiting/blocked and carries it). False for the transcript's copy alone,
   *  which may be stale: the composer and its Stop stay under that card. */
  nativeChatAskLive: boolean
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
  /** A Claude tab that sends through Anthropic: its phone-kept queue (use-ccr-composer-send.ts),
   *  drawn in place of the screen-read queue box. Absent on every other tab. */
  nativeChatLocalQueue?: { entries: readonly string[]; onEdit: (index: number) => void } | null
  /** A Claude tab that sends through Anthropic: the composer's text-only send (a POST into its
   *  Remote Control session, never the terminal). Absent on every other tab. */
  nativeChatAnthropicSend?: (text: string) => Promise<boolean>
  /** The composer's attachment count, reported by the overlay that holds the image hook: the
   *  Anthropic queue reads it at a turn's end (the app moves the queue back over attachments). */
  setNativeChatComposerAttachments?: (count: number) => void
  /** A Claude tab that sends its attachments through Anthropic too (ccr-file-upload.ts, behind
   *  `CCR_ATTACHMENTS_THROUGH_ANTHROPIC`): picks upload to Anthropic and the send references them.
   *  Null on every other tab, and while the switch is off. */
  nativeChatAnthropicAttachments?: NativeChatAnthropicAttachments | null
  handleNativeChatStop: () => void
  /** A Stop went out and the turn has not ended (use-chat-stop-button.ts). */
  nativeChatStopping?: boolean
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
  /** A Claude tab matched to its Anthropic session: the session's own `/` list from its stream
   *  (ccr-slash-commands.ts); undefined keeps the curated catalog. */
  nativeChatSessionCommands?: readonly AgentSessionSlashCommand[]
  /** The same tab: takes the Claude app's own `/model`, `/diff`, `/workflows` (opens their sheet,
   *  true) before a send (use-claude-app-commands.ts); undefined on every other tab. */
  nativeChatAppCommand?: (text: string) => boolean
  /** The same tab: the plan Claude proposed, for the session bar's "Plan" pill, null while its
   *  approval is asked or when none was (claude-session-plan.ts); undefined on every other tab. */
  nativeChatClaudePlan?: string | null
  /** The same tab: the pages its Artifact calls published (session-artifacts.ts) and what names its
   *  account, for the session bar's artifacts button and sheet; undefined on every other tab. */
  nativeChatClaudeArtifacts?: { artifacts: readonly SessionArtifact[]; account: ClaudeTabAccountScope }
  loadNativeChatSkills: () => void
  handleNativeChatQuestionAnswer: (text: string) => Promise<boolean>
  handleNativeChatSend: (text: string, images?: string[]) => Promise<boolean>
  /** Outcome-preserving send: callers that pasted terminal input beforehand
   *  (image sends) must see 'unknown' to heal a possibly-orphaned paste. Such a
   *  caller passes its own `deadline` so the paste it already spent and this text
   *  body share one budget instead of holding the composer for two. */
  /** Clears the composer as an image send starts; returns the undo for a
   *  failed paste. `images` also adds the optimistic bubble in this same call. */
  beginNativeChatImageSend: (text: string, images?: string[], imagePaths?: string[]) => UndoNativeChatSendStart | null
  /** Hands a composer text send refused before any write to the outbox (S4); false when it cannot. */
  parkRefusedNativeChatSend: (text: string) => boolean
  handleNativeChatSendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number,
    attachments?: readonly {
      id?: string
      path: string
      previewUri: string
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
  /** A Claude tab's Usage sheet (ClaudeUsageSheet.tsx, use-ccr-usage-sheet.ts): the tab's own
   *  session's context and its own account's plan; null on every other tab. */
  nativeChatClaudeUsage?: { data: ClaudeUsageSheetData; onOpen: () => void } | null
  /** The usage windows the agent or the host states (hud-rate-limit-notice.ts), for the rate-limit
   *  banner. Empty when no source states one. */
  nativeChatRateLimits?: readonly RateLimitWindowReading[]
  /** Context tokens the host counted for this session, from the same status the HUD merges
   *  (`agentStatus.contextUsedTokens`); null when it sent none. With no window stated, the
   *  header shows these alone and no percentage. */
  nativeChatContextUsedTokens?: number | null
  /** The agent's own word about its model and effort — the status-line badge
   *  or the beacon — and nothing else. Null until it has spoken. This is what
   *  the header pill states; see session-model-pill.ts for why not the
   *  snapshot. */
  nativeChatLiveModel: { model: string | null; label: string | null; effort: string | null }
  /** Permission mode: a matched Claude tab's own word on Anthropic's stream while its link is live
   *  (use-ccr-control-lane.ts), else the terminal footer or beacon; null when neither states one. */
  nativeChatPermissionMode: TerminalPermissionMode | null
  /** A matched Claude tab's Anthropic control lane (use-ccr-control-lane.ts): whether it drives the
   *  tab now (the composer's lease lock is lifted then), and a mode pick through
   *  `set_permission_mode`, absent while the lane is not live (Shift+Tab then). */
  nativeChatAnthropicControl?: { live: boolean; setPermissionMode?: (mode: TerminalPermissionMode) => Promise<string | null> }
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
  /** `agent-session.repeated-stop.v1` from the same probe: a 1.4.220 host, which takes every
   *  chat action press as its own action (Orca #24301). */
  agentSessionRepeatedStopSupported?: boolean | null
  /** Forwarded to the session lane, with a refused command's cause (Orca #25704) or a rejected
   *  send's failure fact (Orca #26544). */
  onSendError: MobileNativeChatSendErrorReporter
  /** Retires a held failure banner. Any accepted chat write clears it — a delivered
   *  answer or permission reply must not sit under a stale "not sent". */
  onSendResolved: () => void
}
