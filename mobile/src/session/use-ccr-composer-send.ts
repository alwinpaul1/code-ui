import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { defaultCcrComposerSendDeps, type CcrComposerSendDeps } from './ccr-composer-send-deps'
import { ccrQueueAtTurnEnd, returnCcrQueueToComposer, type CcrQueueTurnEnd } from './ccr-local-queue'
import { buildCcrUserEventBody, CCR_REMOTE_CONTROL_OFFLINE, ccrEchoSeen, type CcrFileAttachment, type CcrSendPriority } from './ccr-send'
import { CcrApiError, type CcrEvent } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import { reasonOf } from './ccr-session-shared'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'
import type { NativeChatOutboxCcr, NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import { recordOutboxSend, retireOutboxSend } from './native-chat-outbox-sends'
import { ccrResendLanded, CcrSendFlight, ccrSendTargetRefusal, ccrTargetOffline, sendCcrQueueAhead, sendOlderCcrEntriesFirst } from './ccr-send-order'
import type { ClaudeChatGate } from './use-claude-anthropic-transcript'
import type { MobileNativeChatSendErrorDetails } from './use-mobile-native-chat-send-error'
import { ccrSessionTail, sameCcrTarget, useCcrTabQueues, type CcrTo } from './use-ccr-tab-queues'

/**
 * The composer of a Claude tab that sends through Anthropic (ccr-send.ts) instead of typing into
 * the desktop terminal: the send, the pending bubble's two stages, the failure path, and the local
 * queue while Claude works (ccr-local-queue.ts). The Claude app's ViewModel `rs8` is the model:
 * `F4` the normal send, `h6` the queue, `T()` the queue back to the composer.
 *
 *  - The bubble is drawn the moment the box empties (the drafts' own pending echo), dimmed while
 *    the POST is out (`OutboxDelivery` `sending`, MobileNativeChatPendingDim: the app's 50% alpha
 *    `pending_message`), at full strength once a 2xx came back, and gone when the stream carries
 *    the event under the send's uuid. No "Sending" caption: the user removed it on 2026-10-10.
 *  - A failed POST takes the bubble down, puts the words back in the composer, offers Retry (the
 *    app's snackbar), and leaves one `[ccr-send]` line naming the session and the cause. A POST
 *    that failed after its echo was already seen is a success, as in the app.
 *  - Refused before anything is posted, with the words left in the composer: no target that
 *    belongs to this tab's own profile (ccr-session-cache.ts `ccrSendTargetForTab`), the Remote
 *    Control computer offline (the app's own words), a send already in flight. One POST at a
 *    time, in the order typed: the outbox's resend waits for one in flight, and a message a killed
 *    app left in the outbox goes before anything sent after it on its tab (ccr-send-order.ts).
 *  - Nothing here ever writes to the terminal: a refusal is a refusal, never a fallback.
 *
 * The queue belongs to the tab it was typed on, and to the session that tab sent to then. The
 * hook lives as long as the worktree's chat controller, across tab switches, and everything it
 * reads (working, the target, the composer) is the tab on screen. So a queue is kept per tab with
 * the target it was queued for, drawn only on that tab, and sent only into that target, when that
 * same tab is on screen, on this lane, and not working. The phone cannot see another tab's turn
 * end while it shows this one, so a queue left on a tab still working waits there and goes when
 * the user is back on it (a turn that ended while away, or while the lane was off, counts then).
 * The words queued after a turn-end send began stay queued, behind it, and a queue goes once.
 */

/**
 * Which tabs send through Anthropic: a Claude tab on the terminal lane whose chat is matched to its
 * Remote Control session, or is still being matched (a send then refuses, "not matched yet",
 * rather than typing into the terminal while the match settles). Every other tab keeps its own
 * path: Codex and the other agents, a structured session, and a Claude tab with no Anthropic
 * session to send to (signed out, no Remote Control session holds it, a session with no message
 * yet to match by, or Orca holding no row for it), which still types into the terminal.
 */
export function claudeSendsThroughAnthropic(enabled: boolean, gate: ClaudeChatGate): boolean {
  if (!enabled) {
    return false
  }
  switch (gate.kind) {
    case 'matched':
    case 'finding':
      return true
    case 'off':
    case 'signed-out':
    case 'new':
    case 'orca-empty':
    case 'unmatched':
      return false
    default: {
      const unhandled: never = gate
      return unhandled
    }
  }
}

export { defaultCcrComposerSendDeps, type CcrComposerSendDeps } from './ccr-composer-send-deps'

export const CCR_SEND_REFUSALS: Record<Extract<CcrSendTarget, { kind: 'refused' }>['reason'], string> = {
  'profile-unknown': "Message not sent: this tab's Claude profile isn't known yet, so the phone can't tell which Anthropic session is its own. Try again in a moment.",
  unmatched: "Message not sent: this tab isn't matched to its Remote Control session yet. Try again in a moment.",
  'other-account': "Message not sent: the session this tab is matched to belongs to another Anthropic account than the tab's Claude profile.",
  unsettled: "Message not sent: this tab's match isn't confirmed for its Claude profile yet. Try again in a moment."
}
export const CCR_SEND_IN_FLIGHT = 'Another input is still being sent. Try again.'

type Sent = { uuid: string; rowId: string | null }

/** A send's attachments, already at Anthropic (ccr-attachment-send.ts chose them): referenced in the
 *  same event as the words, uploaded under `accountId`, which must be the target's own. */
export type CcrSendFiles = { readonly attachments: readonly CcrFileAttachment[]; readonly previewUris: readonly string[]; readonly accountId: string }

export function useCcrComposerSend(args: {
  /** A Claude tab on the Anthropic lane. Off, every call refuses and nothing is posted. */
  active: boolean
  /** The tab on screen: the queue is kept, drawn and sent per tab. */
  tabId: string | null
  /** The tab's target read NOW (ccrSendTargetForTab), so a config dir switched since the last
   *  render is never posted to under its old target. */
  resolveTarget: () => CcrSendTarget
  events: readonly CcrEvent[]
  /** The stream's `session_update` status, null until it sends one. */
  connectionStatus: string | null
  working: boolean
  promptUp: boolean
  /** Pictures or files attached in the composer of the tab on screen, read at the turn end. */
  attachments: () => number
  composerText: string
  setComposerText: Dispatch<SetStateAction<string>>
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string, images?: string[]) => string | null
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  removePending: (id: string) => void
  onSendError: (message: string, details?: MobileNativeChatSendErrorDetails) => void
  deps?: CcrComposerSendDeps
}): {
  /** With `files`, they ride in the same event as the words (`file_attachments`). */
  sendWithOutcome: (text: string, files?: CcrSendFiles) => Promise<MobileNativeChatSendOutcome>
  /** The outbox's resend on this lane (use-mobile-native-chat-outbox.ts `sendAnthropic`). */
  resendFromOutbox: (text: string, entry: NativeChatOutboxEntry) => Promise<MobileNativeChatSendOutcome>
  /** The composer's send: true unless refused. */
  send: (text: string) => Promise<boolean>
  /** The queue of the tab on screen. */
  queue: string | null
  /** The queued text back into the composer (a tap on the queued bubble). */
  editQueue: () => void
  deliveries: Readonly<Record<string, OutboxDelivery>>
} {
  const deps = args.deps ?? defaultCcrComposerSendDeps
  const latest = useRef(args)
  latest.current = args
  const { queues, queuesRef, queueOnTab, takeFromQueue, editQueue } = useCcrTabQueues(latest, deps)
  const [deliveries, setDeliveries] = useState<Record<string, OutboxDelivery>>({})
  const [flight] = useState(() => new CcrSendFlight())
  /** Tabs whose queue is being seen out at its turn's end. */
  const delivering = useRef(new Set<string>())
  const [deliveryEnded, setDeliveryEnded] = useState(0)
  const sent = useRef<Sent[]>([])

  const setDelivery = useCallback((rowId: string | null, delivery: OutboxDelivery | null) => {
    if (!rowId) {
      return
    }
    setDeliveries((previous) => {
      if (delivery === null) {
        if (!(rowId in previous)) {
          return previous
        }
        const { [rowId]: _gone, ...rest } = previous
        return rest
      }
      return previous[rowId] === delivery ? previous : { ...previous, [rowId]: delivery }
    })
  }, [])

  /** The target, or a refusal reported and logged. */
  const target = useCallback((): CcrTo | null => {
    const now = latest.current
    if (!now.active) {
      return null
    }
    const resolved = now.resolveTarget()
    if (resolved.kind === 'refused') {
      deps.log(`[ccr-send] refused: no send target (${resolved.reason})`)
      now.onSendError(CCR_SEND_REFUSALS[resolved.reason])
      return null
    }
    return resolved
  }, [deps])

  const offline = useCallback((to: CcrTo): Promise<boolean> => ccrTargetOffline(latest.current.connectionStatus, to, deps), [deps])

  /** One POST; true on a 2xx, or on a failure whose echo was already seen. */
  const post = useCallback(async (to: CcrTo, text: string, uuid: string, priority?: CcrSendPriority, files?: readonly CcrFileAttachment[]): Promise<true | string> => {
    try {
      await deps.post(to.accountId, to.sessionId, buildCcrUserEventBody({ sessionId: to.sessionId, uuid, text, ...(priority ? { priority } : {}), ...(files && files.length > 0 ? { fileAttachments: files } : {}) }))
      return true
    } catch (error) {
      if (ccrEchoSeen(latest.current.events, uuid)) {
        return true
      }
      const why = reasonOf(error)
      deps.log(`[ccr-send] POST events to session ${ccrSessionTail(to.sessionId)} failed: ${why}`)
      return error instanceof CcrApiError && error.reason === 'session-not-active' ? CCR_REMOTE_CONTROL_OFFLINE : `Message not sent: ${why}`
    }
  }, [deps])

  const settle = useCallback((uuid: string) => {
    const item = sent.current.find((entry) => entry.uuid === uuid)
    if (!item) {
      return
    }
    sent.current = sent.current.filter((entry) => entry !== item)
    setDelivery(item.rowId, null)
    if (item.rowId) {
      latest.current.removePending(item.rowId)
    }
  }, [setDelivery])

  /** Sends `text` now, its bubble drawn and its words restored on failure. Written to the outbox
   *  with its session and uuid before the box empties, and kept there until the POST is answered,
   *  so an app killed meanwhile resends it from there (under the same uuid) on the next launch.
   *  A send with attachments is not written there: the outbox keeps words only, and a resend
   *  without its files would drop them without a word. */
  const sendNow = useCallback(async (text: string, origin: MobileNativeChatSendOrigin, to: CcrTo, uuid = deps.newUuid(), files?: CcrSendFiles): Promise<MobileNativeChatSendOutcome> => {
    const now = latest.current
    const withFiles = files !== undefined && files.attachments.length > 0
    if (!withFiles) { recordOutboxSend(origin, text, { ccr: { sessionId: to.sessionId, accountId: to.accountId, uuid } }) }
    now.clearDraftForSend(origin, text)
    const rowId = files && files.previewUris.length > 0 ? now.acceptSend(origin, text, [...files.previewUris]) : now.acceptSend(origin, text)
    setDelivery(rowId, 'sending')
    sent.current.push({ uuid, rowId })
    const result = await flight.posting(() => post(to, text, uuid, undefined, files?.attachments))
    if (result === true) {
      if (!withFiles) { void retireOutboxSend(origin.outboxId) }
      if (ccrEchoSeen(latest.current.events, uuid)) {
        settle(uuid)
      } else {
        setDelivery(rowId, 'taken')
      }
      return 'accepted'
    }
    sent.current = sent.current.filter((item) => item.uuid !== uuid)
    setDelivery(rowId, null)
    if (rowId) {
      latest.current.removePending(rowId)
    }
    latest.current.restoreRejectedDraft(origin, text)
    latest.current.onSendError(result, { retry: true })
    return 'rejected'
  }, [deps, flight, post, setDelivery, settle])
  const sendOlderFirst = useCallback((origin: MobileNativeChatSendOrigin, to: CcrTo) =>
    sendOlderCcrEntriesFirst({ origin, to, events: () => latest.current.events, captureSendOrigin: (text) => latest.current.captureSendOrigin(text), sendNow, log: deps.log }), [deps, sendNow])

  // The echo, by uuid and never by text, retires the bubble (the app's pending_message).
  useEffect(() => {
    for (const item of sent.current) {
      if (ccrEchoSeen(args.events, item.uuid)) {
        settle(item.uuid)
      }
    }
  }, [args.events, settle])

  /** A composer send, or (`pinned`) an outbox resend into the session and under the uuid its
   *  first attempt had, which is never queued and never goes to another session. */
  const sendOrResend = useCallback(async (raw: string, pinned?: NativeChatOutboxCcr, files?: CcrSendFiles): Promise<MobileNativeChatSendOutcome> => {
    const text = raw.trim()
    const withFiles = files !== undefined && files.attachments.length > 0
    if (!text && !withFiles) {
      return 'rejected'
    }
    // The outbox's resend waits for a send in flight (a press is refused by it), and is not
    // posted again when the stream already carries its uuid: its first copy arrived.
    if (pinned && (await ccrResendLanded(flight, () => latest.current.events, pinned.uuid))) {
      deps.log(`[ccr-send] outbox resend not posted: session ${ccrSessionTail(pinned.sessionId)} already carries its uuid`)
      return 'accepted'
    }
    const tab = latest.current.tabId ?? ''
    const to = target()
    if (!to) {
      return 'rejected'
    }
    const refusal = ccrSendTargetRefusal(to, pinned, withFiles ? files.accountId : null)
    if (refusal) {
      deps.log(refusal[0]); latest.current.onSendError(refusal[1]); return 'rejected'
    }
    if (flight.busy()) {
      // Words typed while this tab's queue goes out at its turn's end (it holds the flight from
      // before its status read) wait behind it; anything else is refused, as in the app.
      const behind = !pinned && !withFiles && delivering.current.has(tab) ? latest.current.captureSendOrigin(text) : null
      if (behind) {
        latest.current.clearDraftForSend(behind, text); queueOnTab(tab, text, to, behind.draftKey); return 'accepted'
      }
      latest.current.onSendError(CCR_SEND_IN_FLIGHT)
      return 'rejected'
    }
    // Claimed BEFORE the status read: two sends tapped together must not both pass while it runs.
    flight.claimed = true
    try {
      const late = (await offline(to))
        ? ([`[ccr-send] refused: session ${ccrSessionTail(to.sessionId)} is offline (connection_status disconnected)`, CCR_REMOTE_CONTROL_OFFLINE] as const)
        : (latest.current.tabId ?? '') !== tab
          ? ([`[ccr-send] refused: the tab changed while the send to session ${ccrSessionTail(to.sessionId)} was being checked`, 'Message not sent: the tab changed while it was being sent.'] as const)
          : null
      if (late) {
        deps.log(late[0]); latest.current.onSendError(late[1]); return 'rejected'
      }
      const now = latest.current
      const origin = now.captureSendOrigin(text)
      if (!origin) {
        now.onSendError('Message not sent (no chat on this tab)')
        return 'rejected'
      }
      // Steering and post-later are off (ccr-local-queue.ts): the words wait on the phone, behind
      // anything this tab already has waiting.
      // A send with files goes now, unprioritised, as the phone's queue holds words only (the app's
      // local queue is blocked by attachments); the server holds it until Claude takes input. The
      // words already queued on this tab go just ahead of it (sendCcrQueueAhead), in the order typed.
      if (!pinned && !withFiles && (now.working || queuesRef.current[tab] || delivering.current.has(tab))) {
        now.clearDraftForSend(origin, text)
        queueOnTab(tab, text, to, origin.draftKey)
        return 'accepted'
      }
      if (!pinned && !(await sendOlderFirst(origin, to))) {
        latest.current.onSendError(CCR_SEND_IN_FLIGHT)
        return 'rejected'
      }
      if (withFiles && !pinned && !(await sendCcrQueueAhead({ held: queuesRef.current[tab], to, captureSendOrigin: (queued) => latest.current.captureSendOrigin(queued), takeFromQueue: (taken) => takeFromQueue(tab, taken), sendNow, log: deps.log }))) {
        return 'rejected'
      }
      return await sendNow(text, origin, to, pinned?.uuid, withFiles ? files : undefined)
    } finally {
      flight.release()
    }
  }, [deps, flight, offline, queueOnTab, sendNow, sendOlderFirst, takeFromQueue, target])
  const sendWithOutcome = useCallback((text: string, files?: CcrSendFiles) => sendOrResend(text, undefined, files), [sendOrResend])
  // An entry from before this lane has no uuid: it goes as a new post, through Anthropic still.
  const resendFromOutbox = useCallback((text: string, entry: NativeChatOutboxEntry) => sendOrResend(text, entry.ccr), [sendOrResend])

  /**
   * `tab`'s queue at its turn's end: out as one message into the target it was queued for, or
   * back to the composer when something blocks it. Only `captured` goes; words queued meanwhile
   * stay. Resolves whether to look again (something it read changed while it waited).
   */
  const deliverClaimed = useCallback(async (tab: string, captured: string, sending: boolean): Promise<boolean> => {
    const held = queuesRef.current[tab]
    if (!held || held.text !== captured) {
      return true
    }
    const resolved = latest.current.resolveTarget()
    const same = resolved.kind === 'target' && sameCcrTarget(resolved, held.target)
    const isOffline = same ? await offline(held.target) : false
    const now = latest.current
    if (!now.active || (now.tabId ?? '') !== tab || now.working || !queuesRef.current[tab]?.text.startsWith(captured)) {
      return true
    }
    const verdict: CcrQueueTurnEnd = same
      ? ccrQueueAtTurnEnd(captured, { offline: isOffline, promptUp: now.promptUp, draft: now.composerText, attachments: now.attachments(), sending })
      : { kind: 'to-composer', text: captured, because: resolved.kind === 'refused' ? `no send target (${resolved.reason})` : `this tab now sends to session ${ccrSessionTail(resolved.sessionId)}, not ${ccrSessionTail(held.target.sessionId)}` }
    switch (verdict.kind) {
      case 'none':
        return false
      case 'to-composer':
        if (takeFromQueue(tab, captured)) {
          deps.log(`[ccr-send] queued message moved back to the composer: ${verdict.because}`)
          now.setComposerText((draft) => returnCcrQueueToComposer(verdict.text, draft))
        }
        return true
      case 'send': {
        const origin = now.captureSendOrigin(verdict.text)
        if (!origin) {
          deps.log(`[ccr-send] queued message kept: no chat on this tab to send it from`)
          return false
        }
        if (takeFromQueue(tab, captured)) {
          // Behind the tab's older messages, or back to the composer.
          await ((await sendOlderFirst(origin, held.target)) ? sendNow(verdict.text, origin, held.target) : now.setComposerText((draft) => returnCcrQueueToComposer(verdict.text, draft)))
        }
        return true
      }
      default: {
        const unhandled: never = verdict
        return unhandled
      }
    }
  }, [deps, offline, sendNow, sendOlderFirst, takeFromQueue])
  // The flight is claimed BEFORE the status read (unless a send already holds it, which sends the
  // queue back to the composer), so nothing tapped meanwhile posts ahead of the queue, and the
  // outbox's resend waits for it.
  const deliverQueue = useCallback((tab: string, captured: string): Promise<boolean> =>
    flight.busy() ? deliverClaimed(tab, captured, true) : flight.claim(() => deliverClaimed(tab, captured, false)), [deliverClaimed, flight])

  // The tab on screen, on this lane and idle, with a queue: its turn has ended (a queue is only
  // ever made while working), here or while the user was away, so the queue goes now.
  const tab = args.tabId ?? ''
  const shown = queues[tab]
  useEffect(() => {
    if (!args.active || args.working || !shown || delivering.current.has(tab)) {
      return
    }
    delivering.current.add(tab)
    void (async () => {
      let again = true
      try {
        again = await deliverQueue(tab, shown.text)
      } finally {
        delivering.current.delete(tab)
        if (again) {
          setDeliveryEnded((n) => n + 1)
        }
      }
    })()
  }, [args.active, args.working, deliverQueue, deliveryEnded, shown, tab])

  const send = useCallback(async (text: string) => (await sendWithOutcome(text)) !== 'rejected', [sendWithOutcome])
  return { sendWithOutcome, resendFromOutbox, send, queue: shown?.text ?? null, editQueue, deliveries }
}
