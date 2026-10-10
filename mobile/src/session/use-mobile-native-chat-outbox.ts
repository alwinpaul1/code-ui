import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { readNativeChatDraft } from '../storage/native-chat-drafts'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { appendReturnedDraftText } from '../../../src/shared/returned-draft-text'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { stripMobileNativeChatAttachmentNotes } from './mobile-native-chat-video-frames-attachment'
import { useNativeChatOutboxRecovery, type OutboxDelivery } from './use-native-chat-outbox-recovery'

export type { OutboxDelivery }

/**
 * The chat controller's side of the outbox: its tab, its lane, what makes a terminal safe to
 * type into, and its sends, handed to the recovery (use-native-chat-outbox-recovery.ts). Its own
 * module so the controller, at its line budget, spends one call on it.
 */
export function useMobileNativeChatOutbox(input: {
  hostId: string
  worktreeId: string
  tabId: string | null
  sessionId: string | null
  /** The chat view is on screen for this tab. */
  showNativeChat: boolean
  structured: boolean
  /** A terminal chat whose agent is resolved (Claude Code, Codex, …). */
  terminalChat: boolean
  messages: readonly NativeChatMessage[]
  transcriptSettled: boolean
  receipts: readonly BeaconPromptReceipt[]
  inputSendable: boolean
  agentWorking: boolean
  /** A card (permission, question, ask) or a dialog the screen shows: typed keys answer it. */
  promptUp: boolean
  queuedCount: number
  composerText: string
  setComposerText: Dispatch<SetStateAction<string>>
  sendTerminal: (text: string) => Promise<MobileNativeChatSendOutcome>
  sendStructured: (text: string) => Promise<MobileNativeChatSendOutcome>
  showEcho: (entry: NativeChatOutboxEntry) => void
  removeEcho: (id: string) => void
  onNotice: (message: string) => void
}): {
  deliveries: Readonly<Record<string, OutboxDelivery>>
  retry: (rowId: string) => void
  edit: (rowId: string) => void
} {
  const draftKey = mobileNativeChatScopeKey(input.hostId, input.worktreeId, input.tabId)
  const { setComposerText, structured, sendTerminal, sendStructured } = input // setComposerText is read through `active`
  // Read when the words come back, not as of the render that asked: a tab switch in between.
  const active = useRef({ draftKey, setComposerText })
  active.current = { draftKey, setComposerText }
  const restoreToComposer = useCallback(async (key: string, text: string) => {
    // On a cold start the stored draft may not be in memory yet, and words put in an empty box
    // then would win over it for good (useMobileNativeChatDraftPersistence): it goes first.
    const stored = await readNativeChatDraft(key)
    if (active.current.draftKey !== key) {
      return false
    }
    active.current.setComposerText((previous) =>
      appendReturnedDraftText(previous.trim() ? previous : (stored ?? ''), stripMobileNativeChatAttachmentNotes(text))
    )
    return true
  }, [])
  const send = useCallback(
    (text: string) => (structured ? sendStructured(text) : sendTerminal(text)),
    [sendStructured, sendTerminal, structured]
  )
  return useNativeChatOutboxRecovery({
    draftKey,
    pendingKey: draftKey && input.sessionId ? `${draftKey}\0${input.sessionId}` : null,
    lane: !input.showNativeChat ? null : structured ? 'session' : input.terminalChat ? 'terminal' : null,
    messages: input.messages,
    transcriptSettled: input.transcriptSettled,
    receipts: input.receipts,
    sendable: input.inputSendable,
    idle:
      input.inputSendable &&
      !input.agentWorking &&
      !input.promptUp &&
      input.queuedCount === 0 &&
      input.composerText.trim() === '',
    send,
    showEcho: input.showEcho,
    removeEcho: input.removeEcho,
    restoreToComposer,
    onNotice: input.onNotice
  })
}
