import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { CcrComposerSendDeps } from './ccr-composer-send-deps'
import { ccrQueueAtTurnEnd, type CcrQueueTurnEnd } from './ccr-local-queue'
import { CCR_REMOTE_CONTROL_OFFLINE, ccrEchoSeen } from './ccr-send'
import type { CcrEvent } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import type { CcrSendFlight, CcrTapReads } from './ccr-send-order'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { MobileNativeChatSendErrorDetails } from './use-mobile-native-chat-send-error'
import { ccrSessionTail, sameCcrTarget, type CcrTo, type HeldQueue, type HeldQueues } from './use-ccr-tab-queues'

/**
 * A tab's phone-kept queue seen out at its turns' ends, one entry per turn (use-ccr-composer-send.ts
 * owns the queue and the send; ccr-local-queue.ts says why one entry per turn): the first entry goes
 * as an ordinary send when the tab on screen is idle on this lane, and the next waits until the
 * turn that one started has ended. A send that fails keeps its entry queued, in its place, and the
 * queue then waits (`paused`) for the user's next send on the tab or the tab's next turn end.
 */

/**
 * How long the next entry waits for the turn a queued entry started when that turn is never seen:
 * not working since, and no echo followed by a `result`. A message the server took starts its turn
 * within seconds (the stream echoes it and the tab shows working), so two idle minutes with
 * neither means the turn never started or the phone cannot see it, and waiting longer only
 * strands every later send on an idle tab. Going on early costs at most an ordinary post while a
 * turn the phone missed still runs, which the server holds until Claude takes input, as it holds
 * a send with files posted while Claude works.
 */
export const CCR_QUEUE_TURN_UNSEEN_MS = 120_000

/** The turn a queued entry started, in the session it went to, seen out before the next goes. */
export type TurnAfterSend = { uuid: string; sessionId: string; sentAt: number; sawWorking: boolean }

/**
 * Whether the next entry may go, judged against the turn the previous queued entry started:
 *  - `ended`: the tab was seen working after it went and is idle now, or the stream carries that
 *    entry's echo and, after it, a `result` (the turn's end, as ccr-permission-request.ts reads
 *    it), for a turn too short for the phone to have seen it working;
 *  - `other-session`: the tab now sends to another session, whose stream will never carry that
 *    turn (second review, 2026-10-16: the wait was kept per tab only and blocked for good);
 *  - `unseen`: CCR_QUEUE_TURN_UNSEEN_MS passed with the tab idle and the turn never seen;
 *  - `wait`: none of those yet.
 */
export function ccrQueuedTurnEnded(turn: TurnAfterSend, working: boolean, events: readonly CcrEvent[], sessionId: string, now: number): 'ended' | 'other-session' | 'unseen' | 'wait' {
  if (sessionId !== turn.sessionId) {
    return 'other-session'
  }
  if (working) {
    return 'wait'
  }
  if (turn.sawWorking) {
    return 'ended'
  }
  const echo = events.findIndex((event) => event.payload.uuid === turn.uuid)
  if (echo !== -1 && events.slice(echo + 1).some((event) => event.payload.type === 'result')) {
    return 'ended'
  }
  return now - turn.sentAt >= CCR_QUEUE_TURN_UNSEEN_MS ? 'unseen' : 'wait'
}

/** A queued entry put back after its POST failed on the phone, with the uuid it went under: the
 *  server may have taken it anyway (a timeout after the request landed). */
type Requeued = { text: string; uuid: string; sessionId: string }

type Latest = {
  readonly current: {
    active: boolean
    tabId: string | null
    working: boolean
    promptUp: boolean
    composerText: string
    attachments: () => number
    resolveTarget: () => CcrSendTarget
    events: readonly CcrEvent[]
    captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
    restoreRejectedDraft: (origin: MobileNativeChatSendOrigin, text: string) => void
    onSendError: (message: string, details?: MobileNativeChatSendErrorDetails) => void
  }
}
type SendNow = (text: string, origin: MobileNativeChatSendOrigin, to: CcrTo, uuid?: string, files?: undefined, restore?: (origin: MobileNativeChatSendOrigin, text: string) => void, report?: (why: string) => void) => Promise<MobileNativeChatSendOutcome>

export function useCcrQueueDelivery({ args, latest, deps, shown, queuesRef, flight, offline, takeFromQueue, requeueFront, giveBack, sendNow, sendOlderFirst, delivering, paused, alive, storeDraft, tapReads }: {
  /** This render's view of the tab on screen. */
  args: { active: boolean; working: boolean; events: readonly CcrEvent[]; tabId: string | null }
  latest: Latest
  deps: CcrComposerSendDeps
  /** The queue of the tab on screen. */
  shown: HeldQueue | undefined
  queuesRef: MutableRefObject<HeldQueues>
  flight: CcrSendFlight
  offline: (to: CcrTo) => Promise<boolean>
  takeFromQueue: (tab: string, taken: string) => boolean
  requeueFront: (tab: string, text: string, held: HeldQueue) => boolean
  giveBack: (tab: string, text: string, draftKey?: string) => void
  sendNow: SendNow
  sendOlderFirst: (origin: MobileNativeChatSendOrigin, to: CcrTo) => Promise<boolean>
  /** Tabs whose queue is being seen out at its turn's end. */
  delivering: MutableRefObject<Set<string>>
  /** Tabs whose queued send failed: their queue waits for the user's next send or turn end. */
  paused: MutableRefObject<Set<string>>
  /** False once the chat controller unmounted. */
  alive: MutableRefObject<boolean>
  /** Words into a tab's stored draft, for after the chat is gone. */
  storeDraft: (draftKey: string | null, text: string) => void
  /** Per tab, the queued taps whose status read is out: their words are queued already. */
  tapReads: MutableRefObject<Map<string, CcrTapReads>>
}): void {
  const [deliveryEnded, setDeliveryEnded] = useState(0)
  /** Per tab, the turn its last queued entry started, not yet seen to end: the next entry waits. */
  const turnAfterSend = useRef(new Map<string, TurnAfterSend>())
  /** Per tab, its front entry when a failed POST put it back, with the uuid it went under. */
  const requeued = useRef(new Map<string, Requeued>())
  const tab = args.tabId ?? ''

  /**
   * A queued entry whose send failed: its outbox entry and bubble handled as a rejected send's,
   * and its words back at the FRONT of `tab`'s queue, ahead of the entries behind it, rather than
   * in the composer. The queue then waits (`paused`) for the user's next send on the tab or the
   * tab's next turn end, so a failure is never retried in a loop.
   */
  const keepQueued = useCallback((tab: string, held: HeldQueue, uuid: string) => (origin: MobileNativeChatSendOrigin, text: string): void => {
    latest.current.restoreRejectedDraft(origin, '')
    // The chat closed while the POST was out: its queue is already flushed, and this hook's queue
    // keeps nothing, so the words go to the tab's stored draft (second review, 2026-10-16).
    if (!alive.current) {
      storeDraft(origin.draftKey, text)
      return
    }
    paused.current.add(tab)
    if (requeueFront(tab, text, held)) {
      requeued.current.set(tab, { text, uuid, sessionId: held.target.sessionId })
    } else {
      giveBack(tab, text, origin.draftKey)
    }
  }, [alive, giveBack, requeueFront, storeDraft])
  /** What a kept-queued failure says: the cause, and that the message is still queued and how it
   *  goes. No Retry: the words are not in the composer for Retry to send. */
  const reportKeptQueued = useCallback((tab: string, to: CcrTo) => (why: string): void => {
    if (!alive.current) {
      deps.log(`[ccr-send] queued message for session ${ccrSessionTail(to.sessionId)} failed after the chat closed: ${why}`)
      return
    }
    const waiting = queuesRef.current[tab]?.entries.length ?? 0
    deps.log(`[ccr-send] queued message kept queued for session ${ccrSessionTail(to.sessionId)} (${waiting} waiting): ${why}; it goes again with the next send on this tab or at its next turn end`)
    latest.current.onSendError(`${why} It is still queued: it goes ahead of your next message, or tap it to edit it.`)
  }, [alive, deps, queuesRef])

  /**
   * `tab`'s queue at its turn's end: its first entry out as one ordinary message into the target
   * it was queued for, or every entry back to the composer when something blocks it, in the order
   * typed. Only `captured` (the first entry) goes; the entries behind it, and words queued
   * meanwhile, stay queued for the turns after. Resolves whether to look again (something it read
   * changed while it waited).
   */
  const deliverClaimed = useCallback(async (tab: string, captured: string, sending: boolean): Promise<boolean> => {
    const held = queuesRef.current[tab]
    if (!held || held.entries[0] !== captured) {
      return true
    }
    const resolved = latest.current.resolveTarget()
    const same = resolved.kind === 'target' && sameCcrTarget(resolved, held.target)
    const isOffline = same ? await offline(held.target) : false
    const now = latest.current
    const current = queuesRef.current[tab]
    if (!now.active || (now.tabId ?? '') !== tab || now.working || !current || current.entries[0] !== captured) {
      return true
    }
    const verdict: CcrQueueTurnEnd = same
      ? ccrQueueAtTurnEnd(current.entries, { offline: isOffline, promptUp: now.promptUp, draft: now.composerText, attachments: now.attachments(), sending })
      : { kind: 'to-composer', text: captured, because: resolved.kind === 'refused' ? `no send target (${resolved.reason})` : `this tab now sends to session ${ccrSessionTail(resolved.sessionId)}, not ${ccrSessionTail(held.target.sessionId)}` }
    switch (verdict.kind) {
      case 'none':
        return false
      case 'to-composer': {
        // Words typed while it read the status were accepted to wait behind it, as were taps whose
        // own read is still out: offline, they get the notice they would have had, once.
        const reads = tapReads.current.get(tab)
        const grew = current.entries.length > held.entries.length || (reads !== undefined && reads.pending > 0)
        deps.log(`[ccr-send] queued message moved back to the composer: ${verdict.because}`)
        giveBack(tab, '')
        if (isOffline && grew && !reads?.noticed) { now.onSendError(CCR_REMOTE_CONTROL_OFFLINE) }
        if (isOffline && reads) { reads.noticed = true }
        return true
      }
      case 'send': {
        const origin = now.captureSendOrigin(verdict.text)
        if (!origin) {
          deps.log(`[ccr-send] queued message kept: no chat on this tab to send it from`)
          return false
        }
        if (takeFromQueue(tab, captured)) {
          // Behind the tab's older messages, or back to the composer.
          if (!(await sendOlderFirst(origin, held.target))) {
            giveBack(tab, verdict.text, origin.draftKey)
            return true
          }
          // A retry of an entry a failed POST put back goes under the uuid it first went under, as
          // the outbox's resend does, so a copy the server took anyway is the same message; and it
          // is not posted at all once that uuid's echo is in (second review, 2026-10-16: posted
          // twice under two uuids).
          const back = requeued.current.get(tab)
          requeued.current.delete(tab)
          const again = back && back.text === captured && back.sessionId === held.target.sessionId ? back.uuid : null
          const uuid = again ?? deps.newUuid()
          // The next entry waits for the turn this one starts to end (minted before the POST, so
          // a turn that starts while it is out is still seen).
          turnAfterSend.current.set(tab, { uuid, sessionId: held.target.sessionId, sentAt: Date.now(), sawWorking: false })
          if (again && ccrEchoSeen(now.events, again)) {
            deps.log(`[ccr-send] queued message not sent again: session ${ccrSessionTail(held.target.sessionId)} already carries it`)
            return true
          }
          const outcome = await sendNow(verdict.text, origin, held.target, uuid, undefined, keepQueued(tab, held, uuid), reportKeptQueued(tab, held.target))
          if (outcome !== 'accepted') {
            turnAfterSend.current.delete(tab)
          }
        }
        return true
      }
      default: {
        const unhandled: never = verdict
        return unhandled
      }
    }
  }, [deps, giveBack, keepQueued, offline, reportKeptQueued, sendNow, sendOlderFirst, takeFromQueue, tapReads])
  // The flight is claimed BEFORE the status read (unless a send already holds it, which sends the
  // queue back to the composer), so nothing tapped meanwhile posts ahead of the queue, and the
  // outbox's resend waits for it.
  const deliverQueue = useCallback((tab: string, captured: string): Promise<boolean> =>
    flight.busy() ? deliverClaimed(tab, captured, true) : flight.claim(() => deliverClaimed(tab, captured, false), tab), [deliverClaimed, flight])

  // A queued entry a failed POST put back whose uuid's echo has come in: the server took it after
  // all. Its card goes and it is not sent again; the next entry waits for the turn it started.
  useEffect(() => {
    const back = requeued.current.get(tab)
    if (!args.active || !back || !shown || shown.target.sessionId !== back.sessionId || !ccrEchoSeen(args.events, back.uuid)) {
      return
    }
    requeued.current.delete(tab)
    if (shown.entries[0] === back.text && takeFromQueue(tab, back.text)) {
      deps.log(`[ccr-send] queued message taken by session ${ccrSessionTail(back.sessionId)} after its POST failed on the phone: its echo arrived, so it is not sent again`)
      turnAfterSend.current.set(tab, { uuid: back.uuid, sessionId: back.sessionId, sentAt: Date.now(), sawWorking: args.working })
      paused.current.delete(tab)
    }
  }, [args.active, args.events, args.working, deps, shown, tab, takeFromQueue])

  // Working on the tab on screen: the turn a queued entry started is under way, and a queue held
  // after a failed send may go again when this turn ends.
  useEffect(() => {
    if (!args.active || !args.working) {
      return
    }
    const turn = turnAfterSend.current.get(tab)
    if (turn) {
      turn.sawWorking = true
    }
    paused.current.delete(tab)
  }, [args.active, args.working, tab])

  // The tab on screen, on this lane and idle, with a queue: its turn has ended (a queue is only
  // ever made while working), here or while the user was away, so its first entry goes now,
  // unless the turn the previous entry started has not been seen to end yet, or the last attempt
  // failed and nothing has happened since.
  useEffect(() => {
    if (!args.active || args.working || !shown || delivering.current.has(tab) || paused.current.has(tab)) {
      return
    }
    const turn = turnAfterSend.current.get(tab)
    if (turn) {
      const verdict = ccrQueuedTurnEnded(turn, args.working, args.events, shown.target.sessionId, Date.now())
      if (verdict === 'wait') {
        // Look again once the unseen-turn bound is up, so the wait can never block for good.
        const recheck = setTimeout(() => setDeliveryEnded((n) => n + 1), Math.max(0, turn.sentAt + CCR_QUEUE_TURN_UNSEEN_MS - Date.now()) + 1)
        return () => clearTimeout(recheck)
      }
      turnAfterSend.current.delete(tab)
      if (verdict !== 'ended') {
        deps.log(`[ccr-send] stopped waiting for the turn of the queued message sent to session ${ccrSessionTail(turn.sessionId)}: ${verdict === 'other-session' ? `this tab now sends to session ${ccrSessionTail(shown.target.sessionId)}` : `the turn was not seen within ${CCR_QUEUE_TURN_UNSEEN_MS / 1000} s`}`)
      }
    }
    const first = shown.entries[0]
    if (first === undefined) {
      return
    }
    delivering.current.add(tab)
    void (async () => {
      let again = true
      try {
        again = await deliverQueue(tab, first)
      } finally {
        delivering.current.delete(tab)
        if (again) {
          setDeliveryEnded((n) => n + 1)
        }
      }
    })()
    return undefined
  }, [args.active, args.events, args.working, deliverQueue, deliveryEnded, deps, shown, tab])
}
