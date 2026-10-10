import { useCallback, useRef } from 'react'
import type { AgentSessionHandleProvider } from '../../../src/shared/agent-session-provider-handle'
import { isStructuredAgentSessionComposerCommand } from '../../../src/shared/structured-agent-session-composer'
import {
  openMobileNativeChatSendBudget,
  type MobileNativeChatSendOutcome
} from './mobile-native-chat-send'
import {
  useMobileNativeChatSendGate,
  type MobileNativeChatSendConditions
} from './mobile-native-chat-send-readiness'
import type { MobileNativeChatSendOrigin } from './use-mobile-native-chat-drafts'
import { outboxOperationId, recordOutboxSend, retireOutboxSend } from './native-chat-outbox-sends'
import { noteSendOutcome, noteSendStage } from './native-chat-send-timing'

type StructuredNativeChatAttachment = {
  id?: string
  path: string
  previewUri: string
}

export function useMobileStructuredNativeChatSendBridge(args: {
  agent: AgentSessionHandleProvider
  sendStructured: (
    text: string,
    images?: string[],
    deadline?: number,
    attachments?: readonly StructuredNativeChatAttachment[],
    /** The outbox entry's operation id: the same on every attempt of one press. */
    operationId?: string
  ) => Promise<MobileNativeChatSendOutcome>
  /** The session's own gate (useMobileStructuredAgentSession): its client, and
   *  whether it is loaded with the link up. */
  sendConditions: MobileNativeChatSendConditions
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => void
  holdUnconfirmedSend: (
    origin: MobileNativeChatSendOrigin,
    text: string,
    onUnconfirmed: () => void
  ) => void
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  /** Draws a text send's "Sending…" bubble as its box empties (showSendingEchoWith). */
  showSendingEcho?: (origin: MobileNativeChatSendOrigin) => void
  onSendError: (message: string) => void
}): {
  send: (text: string, images?: string[]) => Promise<boolean>
  sendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number,
    attachments?: readonly StructuredNativeChatAttachment[]
  ) => Promise<MobileNativeChatSendOutcome>
} {
  const {
    acceptSend,
    agent,
    captureSendOrigin,
    clearDraftForSend,
    holdUnconfirmedSend,
    onSendError,
    restoreRejectedDraft,
    sendConditions,
    showSendingEcho
  } = args
  // The session's key rides along as the send's target: the controller's one
  // structured lane follows the active tab, so a wait that outlives a tab
  // switch would otherwise send this text into the next tab's session.
  const sendGate = useMobileNativeChatSendGate({
    ...sendConditions,
    action: 'Message',
    lane: 'session',
    onUnready: onSendError
  })
  // The send a wait resumes into is the latest render's: the one at the tap
  // closed over a session that could not send yet.
  const latestSendStructured = useRef(args.sendStructured)
  latestSendStructured.current = args.sendStructured
  const sendWithOutcome = useCallback(
    async (
      text: string,
      images?: string[],
      sharedDeadline?: number,
      attachments?: readonly StructuredNativeChatAttachment[]
    ): Promise<MobileNativeChatSendOutcome> => {
      const origin = captureSendOrigin(text.trimEnd())
      if (!origin) {
        onSendError('Message not sent (no chat on this tab)')
        return 'rejected'
      }
      // Nothing has been written yet, so a send tapped while the relay re-dials
      // waits for it and then goes (mobile-native-chat-send-readiness.ts). One
      // that waited hands the rest of its budget on, so the whole send stays
      // inside one; one that did not keeps the budget it was given.
      let deadline = sharedDeadline
      if (!sendGate.isReady()) {
        deadline ??= openMobileNativeChatSendBudget()
        if (!(await sendGate.wait(deadline))) {
          return 'rejected'
        }
      }
      const sendStructured = latestSendStructured.current
      const isHostCommand = isStructuredAgentSessionComposerCommand(text, agent)
      // Written down before the box empties (native-chat-outbox-sends.ts). Fail-open.
      // Not a host command: it writes no row, so nothing could tell it ran, and a resend would run it again.
      if (!isHostCommand) {
        recordOutboxSend(origin, text, { hasAttachments: Boolean(images?.length || attachments?.length) })
      }
      clearDraftForSend(origin, text)
      if (!isHostCommand && !images?.length && !attachments?.length) {
        showSendingEcho?.(origin)
      }
      // Every attempt of this press sends one operation id, so the host's ledger answers a
      // retry with the first attempt's result instead of posting it twice. A new press is a
      // new entry and a new id (Orca #26392).
      const operationId = outboxOperationId(origin)
      const mutationStartedAt = Date.now()
      const outcome = operationId !== undefined
        ? await sendStructured(text, images, deadline, attachments, operationId)
        : attachments !== undefined
          ? await sendStructured(text, images, deadline, attachments)
          : deadline !== undefined
            ? await sendStructured(text, images, deadline)
            : images !== undefined
              ? await sendStructured(text, images)
              : await sendStructured(text)
      noteSendStage('mutation', Date.now() - mutationStartedAt)
      noteSendOutcome(outcome)
      if (outcome === 'accepted') {
        // An image-carrying send already got its echo from the caller, at the
        // same moment the composer cleared (clearDraftAtSendStartWith) — not
        // repeated here, or it would double the bubble.
        if (!isHostCommand && !images?.length) {
          acceptSend(origin, text.trimEnd(), images)
        }
        void retireOutboxSend(origin.outboxId)
        return 'accepted'
      }
      if (outcome === 'unknown') {
        if (isHostCommand) {
          restoreRejectedDraft(origin, text)
          return 'unknown'
        }
        holdUnconfirmedSend(origin, text.trimEnd(), () =>
          onSendError('Delivery unconfirmed — check chat before retrying')
        )
        return 'unknown'
      }
      restoreRejectedDraft(origin, text)
      return 'rejected'
    },
    [
      acceptSend,
      agent,
      captureSendOrigin,
      clearDraftForSend,
      holdUnconfirmedSend,
      onSendError,
      restoreRejectedDraft,
      sendGate,
      showSendingEcho
    ]
  )
  const send = useCallback(
    async (
      text: string,
      images?: string[],
      deadline?: number,
      attachments?: readonly StructuredNativeChatAttachment[]
    ) => (await sendWithOutcome(text, images, deadline, attachments)) !== 'rejected',
    [sendWithOutcome]
  )
  return { send, sendWithOutcome }
}
