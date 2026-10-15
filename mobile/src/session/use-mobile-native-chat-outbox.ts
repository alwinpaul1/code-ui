import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { readNativeChatDraft } from '../storage/native-chat-drafts'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { appendReturnedDraftText } from '../../../src/shared/returned-draft-text'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { stripMobileNativeChatAttachmentNotes } from './mobile-native-chat-video-frames-attachment'
import { useNativeChatOutboxRecovery, type OutboxDelivery } from './use-native-chat-outbox-recovery'
import { publishOutboxChatRoute } from './native-chat-outbox-sends'

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
  /** The chat's agent, its terminal and its transcript file: stamped on every message this chat
   *  writes to the outbox, so the app-wide drainer can send it with the chat closed. */
  agent?: string | null
  terminal?: string | null
  transcriptPath?: string | null
  /** The last prompt the tab's hooks reported, stamped on each message as it leaves so the
   *  drainer can tell a prompt that changed to its words from one that was already there. */
  promptBefore?: string | null
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
  /** A Claude tab that sends through Anthropic: its resend (use-ccr-composer-send.ts). Present,
   *  the outbox is that lane's and nothing of this tab's is typed into the terminal. */
  sendAnthropic?: (text: string, entry: NativeChatOutboxEntry) => Promise<MobileNativeChatSendOutcome>
  showEcho: (entry: NativeChatOutboxEntry) => void
  removeEcho: (id: string) => void
  onNotice: (message: string) => void
}): {
  deliveries: Readonly<Record<string, OutboxDelivery>>
  retry: (rowId: string) => void
  edit: (rowId: string) => void
} {
  const draftKey = mobileNativeChatScopeKey(input.hostId, input.worktreeId, input.tabId)
  const { setComposerText, structured, sendTerminal, sendStructured, sendAnthropic } = input // setComposerText is read through `active`
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
  const routeLane = structured ? 'session' : input.terminalChat ? 'terminal' : null
  const { hostId, worktreeId, tabId, sessionId } = input
  const routeAgent = input.agent ?? null
  const routeTerminal = structured ? null : (input.terminal ?? null)
  const routeTranscriptPath = structured ? null : (input.transcriptPath ?? null)
  const routePromptBefore = structured || input.promptBefore === undefined ? undefined : input.promptBefore
  useEffect(
    () =>
      draftKey && tabId && routeLane
        ? publishOutboxChatRoute(draftKey, {
            hostId,
            worktreeId,
            tabId,
            lane: routeLane,
            agent: routeAgent,
            sessionId,
            terminal: routeTerminal,
            transcriptPath: routeTranscriptPath,
            ...(routePromptBefore === undefined ? {} : { promptBefore: routePromptBefore })
          })
        : undefined,
    [draftKey, hostId, routeAgent, routeLane, routePromptBefore, routeTerminal, routeTranscriptPath, sessionId, tabId, worktreeId]
  )
  const send = useCallback(
    (text: string, entry: NativeChatOutboxEntry) =>
      structured ? sendStructured(text) : sendAnthropic ? sendAnthropic(text, entry) : sendTerminal(text),
    [sendAnthropic, sendStructured, sendTerminal, structured]
  )
  // On the Anthropic lane the far end is Anthropic, not the desktop's input line: it is sendable
  // without the relay.
  const anthropic = !structured && sendAnthropic !== undefined
  const sendable = anthropic || input.inputSendable
  return useNativeChatOutboxRecovery({
    draftKey,
    pendingKey: draftKey && input.sessionId ? `${draftKey}\0${input.sessionId}` : null,
    lane: !input.showNativeChat ? null : structured ? 'session' : anthropic ? 'ccr' : input.terminalChat ? 'terminal' : null,
    messages: input.messages,
    transcriptSettled: input.transcriptSettled,
    receipts: input.receipts,
    sendable,
    idle:
      sendable &&
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
