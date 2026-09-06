import type { InlineQueueEditor } from './use-mobile-native-chat-queue-editor'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
import type {
  TerminalHudContextWindow,
  TerminalAgentMode,
  TerminalPermissionMode
} from './mobile-terminal-hud-parse'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DiscoveredSkill } from '../../../src/shared/skills'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import type { MobileNativeChatKeyStripProps } from './MobileNativeChatKeyStrip'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'
import type { MobileNativeChatPendingItem } from './mobile-native-chat-render-data'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import type { MobileChatQuestion } from './mobile-native-chat-question'
import type { MobileNativeChatStatus } from './use-mobile-native-chat-session'

/** Why the composer input is locked: the transport is disconnected, or the
 *  terminal subscription has not acknowledged its input lease yet. */
export type MobileNativeChatInputLockReason = 'disconnected' | 'waiting'

export type MobileNativeChatViewProps = {
  /** Raw transcript, only for telling "still loading" from "loaded and empty". */
  messages: NativeChatMessage[]
  /** `messages` with noise stripped and tool turns folded in, from the overlay. */
  folded: NativeChatMessage[]
  status: MobileNativeChatStatus
  error?: string
  /** Resolved agent for this chat; names the empty-state copy (desktop parity). */
  agent?: string | null
  agentWorking?: boolean
  /** Interrupt the agent mid-turn (shown as a Stop button on the working bar). */
  onStop?: () => void
  /** Live partial assistant text to show as an in-progress bubble, already gated
   *  by the overlay against the transcript catching up. */
  streaming: string | null
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void
  onSend: (text: string) => Promise<boolean>
  /** Route identity used to fence accepted sends that settle after a tab/view switch. */
  sendSurfaceId: string
  /** Reads the retained route's focus generation for accepted-send fencing. */
  getSendCompletionGeneration: () => number
  /** Reads user draft mutations from the route-owned controller. */
  getComposerEditGeneration: () => number
  /** Accepted user echoes awaiting transcript replacement, including image previews. */
  queuedMessages?: readonly MobileChatQueueEntry[]
  onEditQueue?: () => Promise<void>
  queueEditor?: InlineQueueEditor | null
  pending: MobileNativeChatPendingItem[]
  /** Local photo URIs retained when the authoritative transcript replaces an
   *  optimistic image bubble. */
  imagePreviewsByMessageId?: Record<string, string[]>
  /** Controlled composer text (owned by the route so dictation can write to it). */
  composerText: string
  onComposerTextChange: (text: string) => void
  onAttachImage?: () => void
  onAttachFile?: () => void
  /** Pending image attachments shown as composer thumbnails until the next send. */
  attachments?: PendingNativeChatImage[]
  onRemoveAttachment?: (id: string) => void
  isAttaching?: boolean
  onMicPress?: () => void
  micActive?: boolean
  micLevel?: number
  contextWindow?: TerminalHudContextWindow | null
  permissionMode?: TerminalPermissionMode | null
  onSelectPermissionMode?: (mode: TerminalPermissionMode) => void
  agentMode?: TerminalAgentMode | null
  onSelectAgentMode?: (mode: TerminalAgentMode) => void
  dictationMode?: 'toggle' | 'hold'
  onMicPressIn?: () => void
  onMicPressOut?: () => void
  inputLockReason?: MobileNativeChatInputLockReason | null
  /** Route-reported send failure (answer cards, permission replies, stop). Shares the
   *  inline banner with a rejected composer send, so one failure paints once. */
  sendErrorMessage?: string | null
  /** Clears `sendErrorMessage` once a later send is accepted. */
  onClearSendError?: () => void
  filePaths?: string[]
  onNeedFiles?: (query: string) => void
  skills?: readonly DiscoveredSkill[]
  onNeedSkills?: () => void
  /** Model/session-option pickers for the composer action row (desktop parity). */
  sessionOptions?: MobileNativeChatSessionOptionPickersProps | null
  /** Structured AskUserQuestion prompt parsed from the transcript (preferred over
   *  the heuristic question card). */
  ask?: AskPrompt | null
  /** Stable key for the ask card. Dismissal state lives in the controller (it
   *  must survive this subtree unmounting on a chat↔terminal toggle). */
  askKey?: string | null
  /** Hide the answered/dismissed ask until a different question arrives. */
  onDismissAsk?: () => void
  /** Deliver the ask answer as per-question selections; the send hook turns them
   *  into selector keystrokes (Claude) or pasted label text (other agents). */
  onAnswerAsk?: (prompt: AskPrompt, selections: AskAnswerSelection[]) => Promise<boolean>
  onCancelAsk?: () => Promise<boolean>
  question?: MobileChatQuestion | null
  onAnswerQuestion?: (text: string) => Promise<boolean>
  permission?: MobileChatPermission | null
  onRespondPermission?: (send: string) => Promise<boolean>
  /** Drop one message Claude Code has queued behind the running turn. */
  onCancelQueued?: (id: string) => Promise<boolean>
  /** Open a worktree file tapped in agent markdown. */
  onOpenFile?: (relativePath: string) => void
  /** Pixels to lift the composer by when the soft keyboard is open. The route
   *  owns keyboard tracking (the app uses manual lift, not KeyboardAvoidingView). */
  keyboardInset?: number
  /** Terminal accessory keys shown above the composer (Tab, Shift+Tab, arrows, Esc…). */
  keyStrip?: MobileNativeChatKeyStripProps
}
