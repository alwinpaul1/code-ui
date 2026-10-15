import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { acquireCcrLink } from './ccr-link-registry'
import { appendCcrQueue, ccrQueueAtTurnEnd, returnCcrQueueToComposer } from './ccr-local-queue'
import { buildCcrUserEventBody, CCR_REMOTE_CONTROL_OFFLINE, ccrEchoSeen, ccrSessionOffline, newCcrEventUuid, postCcrSessionEvents, readCcrConnectionStatus, type CcrSendPriority } from './ccr-send'
import type { CcrEvent } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import { reasonOf } from './ccr-session-shared'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'
import type { ClaudeChatGate } from './use-claude-anthropic-transcript'
import type { MobileNativeChatSendErrorDetails } from './use-mobile-native-chat-send-error'

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
 *    Control computer offline (the app's own words), a send already in flight.
 *  - Nothing here ever writes to the terminal: a refusal is a refusal, never a fallback.
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

export type CcrComposerSendDeps = {
  /** Posts one events batch into `sessionId` with `accountId`'s own sign-in. */
  post: (accountId: string, sessionId: string, body: ReturnType<typeof buildCcrUserEventBody>) => Promise<void>
  /** The session row's `connection_status`, read now. */
  readStatus: (accountId: string, sessionId: string) => Promise<string | null>
  log: (line: string) => void
  newUuid: () => string
}

export const defaultCcrComposerSendDeps: CcrComposerSendDeps = {
  post: async (accountId, sessionId, body) => {
    const held = acquireCcrLink(accountId, sessionId)
    try {
      await held.link.withSession((deps, account, session) => postCcrSessionEvents(deps, account, session, body))
    } finally {
      held.release()
    }
  },
  readStatus: async (accountId, sessionId) => {
    const held = acquireCcrLink(accountId, sessionId)
    try {
      return await held.link.withSession(readCcrConnectionStatus)
    } finally {
      held.release()
    }
  },
  log: (line) => console.warn(line),
  newUuid: () => newCcrEventUuid()
}

export const CCR_SEND_REFUSALS: Record<Extract<CcrSendTarget, { kind: 'refused' }>['reason'], string> = {
  'profile-unknown': "Message not sent: this tab's Claude profile isn't known yet, so the phone can't tell which Anthropic session is its own. Try again in a moment.",
  unmatched: "Message not sent: this tab isn't matched to its Remote Control session yet. Try again in a moment.",
  'other-account': "Message not sent: the session this tab is matched to belongs to another Anthropic account than the tab's Claude profile.",
  unsettled: "Message not sent: this tab's match isn't confirmed for its Claude profile yet. Try again in a moment."
}
export const CCR_SEND_IN_FLIGHT = 'Another input is still being sent. Try again.'

type Sent = { uuid: string; rowId: string | null }

export function useCcrComposerSend(args: {
  /** A Claude tab on the Anthropic lane. Off, every call refuses and nothing is posted. */
  active: boolean
  /** The tab's target read NOW (ccrSendTargetForTab), so a config dir switched since the last
   *  render is never posted to under its old target. */
  resolveTarget: () => CcrSendTarget
  events: readonly CcrEvent[]
  /** The stream's `session_update` status, null until it sends one. */
  connectionStatus: string | null
  working: boolean
  promptUp: boolean
  attachments: number
  composerText: string
  setComposerText: Dispatch<SetStateAction<string>>
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  acceptSend: (origin: MobileNativeChatSendOrigin, text: string) => string | null
  restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
  removePending: (id: string) => void
  onSendError: (message: string, details?: MobileNativeChatSendErrorDetails) => void
  deps?: CcrComposerSendDeps
}): {
  sendWithOutcome: (text: string) => Promise<MobileNativeChatSendOutcome>
  /** The composer's send: true unless refused. */
  send: (text: string) => Promise<boolean>
  queue: string | null
  /** The queued text back into the composer (a tap on the queued bubble). */
  editQueue: () => void
  deliveries: Readonly<Record<string, OutboxDelivery>>
} {
  const deps = args.deps ?? defaultCcrComposerSendDeps
  const latest = useRef(args)
  latest.current = args
  const [queue, setQueue] = useState<string | null>(null)
  const queueRef = useRef<string | null>(null)
  queueRef.current = queue
  const [deliveries, setDeliveries] = useState<Record<string, OutboxDelivery>>({})
  const inFlight = useRef(false)
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
  const target = useCallback((): { sessionId: string; accountId: string } | null => {
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

  /** Whether the Remote Control computer is offline: the stream's word, else the row read now. */
  const offline = useCallback(async (to: { sessionId: string; accountId: string }): Promise<boolean> => {
    const streamed = latest.current.connectionStatus
    if (streamed !== null) {
      return ccrSessionOffline(streamed)
    }
    try {
      return ccrSessionOffline(await deps.readStatus(to.accountId, to.sessionId))
    } catch (error) {
      // Not refused on an unread status, as the app does not refuse UNKNOWN: the POST says.
      deps.log(`[ccr-send] could not read session …${to.sessionId.slice(-6)}'s connection status: ${reasonOf(error)}`)
      return false
    }
  }, [deps])

  /** One POST; true on a 2xx, or on a failure whose echo was already seen. */
  const post = useCallback(async (to: { sessionId: string; accountId: string }, text: string, uuid: string, priority?: CcrSendPriority): Promise<true | string> => {
    try {
      await deps.post(to.accountId, to.sessionId, buildCcrUserEventBody({ sessionId: to.sessionId, uuid, text, ...(priority ? { priority } : {}) }))
      return true
    } catch (error) {
      if (ccrEchoSeen(latest.current.events, uuid)) {
        return true
      }
      const why = reasonOf(error)
      deps.log(`[ccr-send] POST events to session …${to.sessionId.slice(-6)} failed: ${why}`)
      return why
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

  /** Sends `text` now, its bubble drawn and its words restored on failure. */
  const sendNow = useCallback(async (text: string, origin: MobileNativeChatSendOrigin, to: { sessionId: string; accountId: string }): Promise<MobileNativeChatSendOutcome> => {
    const now = latest.current
    const uuid = deps.newUuid()
    inFlight.current = true
    now.clearDraftForSend(origin, text)
    const rowId = now.acceptSend(origin, text)
    setDelivery(rowId, 'sending')
    sent.current.push({ uuid, rowId })
    const result = await post(to, text, uuid)
    inFlight.current = false
    if (result === true) {
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
    latest.current.onSendError(`Message not sent: ${result}`, { retry: true })
    return 'rejected'
  }, [deps, post, setDelivery, settle])

  // The echo, by uuid and never by text, retires the bubble (the app's pending_message).
  useEffect(() => {
    for (const item of sent.current) {
      if (ccrEchoSeen(args.events, item.uuid)) {
        settle(item.uuid)
      }
    }
  }, [args.events, settle])

  const sendWithOutcome = useCallback(async (raw: string): Promise<MobileNativeChatSendOutcome> => {
    const text = raw.trim()
    if (!text) {
      return 'rejected'
    }
    const to = target()
    if (!to) {
      return 'rejected'
    }
    if (inFlight.current) {
      latest.current.onSendError(CCR_SEND_IN_FLIGHT)
      return 'rejected'
    }
    if (await offline(to)) {
      deps.log(`[ccr-send] refused: session …${to.sessionId.slice(-6)} is offline (connection_status disconnected)`)
      latest.current.onSendError(CCR_REMOTE_CONTROL_OFFLINE)
      return 'rejected'
    }
    const origin = latest.current.captureSendOrigin(text)
    if (!origin) {
      latest.current.onSendError('Message not sent (no chat on this tab)')
      return 'rejected'
    }
    if (latest.current.working) {
      // Steering and post-later are off (ccr-local-queue.ts): the words wait on the phone.
      latest.current.clearDraftForSend(origin, text)
      setQueue((current) => appendCcrQueue(current, text))
      return 'accepted'
    }
    return sendNow(text, origin, to)
  }, [deps, offline, sendNow, target])

  // At the turn's end the queue goes out, or back to the composer when something blocks it.
  const wasWorking = useRef(args.working)
  useEffect(() => {
    const ended = wasWorking.current && !args.working
    wasWorking.current = args.working
    const queued = queueRef.current
    if (!ended || !queued || !args.active) {
      return
    }
    void (async () => {
      const now = latest.current
      const to = now.resolveTarget()
      const isOffline = to.kind === 'target' ? await offline(to) : true
      const verdict = ccrQueueAtTurnEnd(queued, { offline: isOffline, promptUp: now.promptUp, draft: now.composerText, attachments: now.attachments, sending: inFlight.current })
      switch (verdict.kind) {
        case 'none':
          return
        case 'to-composer':
          deps.log(`[ccr-send] queued message moved back to the composer: ${verdict.because}`)
          setQueue(null)
          now.setComposerText((draft) => returnCcrQueueToComposer(verdict.text, draft))
          return
        case 'send': {
          const origin = now.captureSendOrigin(verdict.text)
          if (!origin || to.kind !== 'target') {
            return
          }
          setQueue(null)
          await sendNow(verdict.text, origin, to)
          return
        }
        default: {
          const unhandled: never = verdict
          return unhandled
        }
      }
    })()
  }, [args.active, args.working, deps, offline, sendNow])

  // Leaving the chat with a queue posts it as `priority: "later"` with a fresh uuid, as the app
  // does when its session screen closes; the server holds it until the turn ends.
  useEffect(
    () => () => {
      const queued = queueRef.current
      const now = latest.current
      if (!queued || !now.active) {
        return
      }
      const to = now.resolveTarget()
      if (to.kind !== 'target') {
        deps.log(`[ccr-send] queued message dropped on leaving: no send target (${to.reason})`)
        return
      }
      void deps.post(to.accountId, to.sessionId, buildCcrUserEventBody({ sessionId: to.sessionId, uuid: deps.newUuid(), text: queued, priority: 'later' })).catch((error: unknown) =>
        deps.log(`[ccr-send] queued message lost on leaving session …${to.sessionId.slice(-6)}: ${reasonOf(error)}`)
      )
    },
    [deps]
  )

  const editQueue = useCallback(() => {
    const queued = queueRef.current
    if (!queued) {
      return
    }
    setQueue(null)
    latest.current.setComposerText((draft) => returnCcrQueueToComposer(queued, draft))
  }, [])

  const send = useCallback(async (text: string) => (await sendWithOutcome(text)) !== 'rejected', [sendWithOutcome])
  return { sendWithOutcome, send, queue, editQueue, deliveries }
}
