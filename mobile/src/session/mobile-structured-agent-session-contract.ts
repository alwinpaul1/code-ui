import type {
  AgentSessionBackgroundTaskState,
  AgentSessionSlashCommand
} from '../../../src/shared/agent-session-wire'
import type { StructuredAgentSessionAttachment } from '../../../src/shared/structured-agent-session-outbox'
import type { MobileChatPermission } from './mobile-native-chat-permission'
import type { MobileChatQuestion } from './mobile-native-chat-question'
import type { NativeChatTurnActivity } from './mobile-native-chat-turn-activity'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSession } from './use-mobile-native-chat-session'
import type { useMobileStructuredAgentOptions } from './use-mobile-structured-agent-options'

export type StructuredMobileAttachment = StructuredAgentSessionAttachment & { id?: string }

/** What `useMobileStructuredAgentSession` hands the controller. Its own file so
 *  the hook stays under its line cap. */
export type StructuredMobileSession = ReturnType<typeof useMobileStructuredAgentOptions> & {
  session: MobileNativeChatSession
  isWorking: boolean
  /** Whether there is a turn to interrupt. A journalled send reads as working
   *  before the provider opens one, and cancelling that has nothing to act on. */
  canStop: boolean
  turnId: string | null
  /** Provider-authored copy for the live turn tail. Null when there is none. */
  turnActivity: NativeChatTurnActivity | null
  sendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number,
    attachments?: readonly StructuredMobileAttachment[]
  ) => Promise<MobileNativeChatSendOutcome>
  cancel: () => void
  permission: MobileChatPermission | null
  question: MobileChatQuestion | null
  /** The `/` surface the running session reports; undefined until it reports one. */
  sessionCommands: readonly AgentSessionSlashCommand[] | undefined
  /** The provider's own background-task roster. `undefined` while this host has
   *  never reported one, so the transcript reader keeps the tab; `null` once it
   *  has reported one and cleared it. */
  backgroundTasks: AgentSessionBackgroundTaskState | null | undefined
  /** Asks the host to stop one named background task. Only offered where the
   *  roster says `supportsTaskStop`. */
  stopBackgroundTask: (taskId: string) => Promise<boolean>
  respondPermission: (optionId: string) => Promise<boolean>
  respondQuestion: (answer: string) => Promise<boolean>
}
