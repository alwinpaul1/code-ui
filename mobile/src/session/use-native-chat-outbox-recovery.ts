import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  hydrateNativeChatOutbox,
  nativeChatOutboxEntries,
  subscribeNativeChatOutbox,
  type NativeChatOutboxEntry
} from '../storage/native-chat-outbox'
import type { BeaconPromptReceipt } from './mobile-native-chat-beacon-confirm'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import { outboxEchoId, outboxEntryIdOfEcho } from './mobile-native-chat-outbox-drafts'
import {
  isOutboxSendLive,
  offerOutboxAdoption,
  patchOutboxEntry,
  registerOutboxRecovery,
  retireOutboxSend,
  takeOutboxAdoption
} from './native-chat-outbox-sends'
import { beginNativeChatSendTiming, finishNativeChatSendTiming } from './native-chat-send-timing'
import { structuredSessionOperationId } from './structured-session-operation-id'
import {
  OUTBOX_GIVE_BACK,
  outboxEntryLanding,
  planOutboxEntry,
  type OutboxGiveBack,
  type OutboxLane
} from './native-chat-outbox-recovery-plan'

/** What an outbox bubble says under it. */
export type OutboxDelivery = 'sending' | 'failed'

const NO_RECEIPTS: readonly BeaconPromptReceipt[] = []
const TICK_MS = 1_000
/** A gap between looks longer than this is time the app was not running: not waited. */
const MAX_COUNTED_GAP_MS = 5_000

export type NativeChatOutboxRecoveryArgs = {
  draftKey: string | null
  pendingKey: string | null
  /** Null while the tab is not a chat the phone can send to. */
  lane: OutboxLane | null
  messages: readonly NativeChatMessage[]
  /** `messages` is this session's own settled read. */
  transcriptSettled: boolean
  receipts?: readonly BeaconPromptReceipt[]
  /** The lane could write now: the link up, the lease held or the session loaded. */
  sendable: boolean
  /** A terminal agent is safe to type into: no card or dialog up, not working, nothing in
   *  its queue box, and the phone's own composer empty (so the mirror holds nothing there). */
  idle: boolean
  /** The lane's composer send (it records, holds and retires like any press). */
  send: (text: string) => Promise<MobileNativeChatSendOutcome>
  showEcho: (entry: NativeChatOutboxEntry) => void
  removeEcho: (id: string) => void
  /** Puts words back after whatever the composer of `draftKey` holds, its stored draft included
   *  when it has not been read back yet. Resolves false when that tab is no longer the one on
   *  screen: the entry then stays for the next chat of its tab. */
  restoreToComposer: (draftKey: string, text: string) => Promise<boolean>
  onNotice: (message: string) => void
}

/**
 * Finds the messages a chat's sends left in the outbox and sees each one through
 * (native-chat-outbox-recovery-plan.ts says how): their bubble comes back saying "Sending…",
 * a message that landed is dropped without a word, one that did not is sent once more when it
 * is safe, and only one that truly cannot be sent goes back into the composer with a notice.
 * A resend the desktop refuses leaves its bubble saying "Not sent", with Retry and Edit.
 *
 * It runs while the chat of the entry's tab is on screen: the safety of a terminal resend is
 * read off that chat's screen (the cards, the dialog guard, the queue box), so with no chat
 * mounted nothing is resent, and the entry waits for the tab to be opened.
 */
export function useNativeChatOutboxRecovery(args: NativeChatOutboxRecoveryArgs): {
  deliveries: Readonly<Record<string, OutboxDelivery>>
  retry: (rowId: string) => void
  edit: (rowId: string) => void
} {
  const latest = useRef(args)
  latest.current = args
  const [version, setVersion] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  const inFlight = useRef<string | null>(null)
  const userRetry = useRef(new Set<string>())
  const waited = useRef(new Map<string, number>())
  const idleSince = useRef<number | null>(null)
  const lastLookAt = useRef<number | null>(null)
  const { draftKey, lane } = args

  useEffect(() => subscribeNativeChatOutbox(() => setVersion((n) => n + 1)), [])
  useEffect(() => {
    let cancelled = false
    void hydrateNativeChatOutbox().then(() => {
      if (!cancelled) {
        setHydrated(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  // Only a chat that can tell whether a send landed takes an expired hold over (releaseOutboxSend).
  const { transcriptSettled } = args
  useEffect(
    () => (draftKey && lane && transcriptSettled ? registerOutboxRecovery(draftKey) : undefined),
    [draftKey, lane, transcriptSettled]
  )

  const givingBack = useRef(new Set<string>())
  const giveBack = useCallback(async (entry: NativeChatOutboxEntry, reason: OutboxGiveBack | null) => {
    if (givingBack.current.has(entry.id)) {
      return
    }
    givingBack.current.add(entry.id)
    try {
      if (!(await latest.current.restoreToComposer(entry.draftKey, entry.text))) {
        return
      }
    } finally {
      givingBack.current.delete(entry.id)
    }
    const current = latest.current
    current.removeEcho(outboxEchoId(entry.id))
    if (entry.echoId) {
      current.removeEcho(entry.echoId)
    }
    if (reason) {
      current.onNotice(`Message not sent: ${OUTBOX_GIVE_BACK[reason]}`)
    }
    void retireOutboxSend(entry.id)
  }, [])

  const resend = useCallback(async (entry: NativeChatOutboxEntry) => {
    inFlight.current = entry.id
    userRetry.current.delete(entry.id)
    try {
      // Counted on disk BEFORE it goes: a process that dies now leaves the next one knowing a
      // copy may be out. A count that cannot be written sends nothing.
      if (!(await patchOutboxEntry(entry.id, { autoAttempts: entry.autoAttempts + 1, failed: undefined }))) {
        void patchOutboxEntry(entry.id, { failed: true })
        return
      }
      const current = latest.current
      // One more look, right before: a row that arrived while the count was written wins.
      if (outboxEntryLanding(entry, current.messages, current.receipts ?? NO_RECEIPTS) === 'landed') {
        void retireOutboxSend(entry.id)
        return
      }
      offerOutboxAdoption(entry.draftKey, entry.normalizedText, entry.id, true)
      const timing = beginNativeChatSendTiming(entry.draftKey, { chars: entry.text.length })
      const outcome = await current.send(entry.text)
      finishNativeChatSendTiming(timing, outcome)
      // A send that refused before it took the words leaves the offer behind; a later press of
      // the same words must not inherit it.
      takeOutboxAdoption(entry.draftKey, entry.normalizedText)
      if (outcome === 'accepted') {
        void retireOutboxSend(entry.id)
      } else if (outcome === 'rejected') {
        void patchOutboxEntry(entry.id, { failed: true })
      }
    } finally {
      inFlight.current = null
      setVersion((n) => n + 1)
    }
  }, [])

  const evaluate = useCallback(() => {
    const current = latest.current
    const now = Date.now()
    const gap = lastLookAt.current === null ? 0 : now - lastLookAt.current
    lastLookAt.current = now
    if (!current.idle) {
      idleSince.current = null
    } else if (idleSince.current === null) {
      idleSince.current = now
    }
    if (!hydrated || !current.draftKey || !current.lane || inFlight.current) {
      return
    }
    const mine = nativeChatOutboxEntries().filter(
      (entry) => entry.draftKey === current.draftKey && !isOutboxSendLive(entry.id)
    )
    for (const entry of mine) {
      if (current.sendable && gap <= MAX_COUNTED_GAP_MS) {
        waited.current.set(entry.id, (waited.current.get(entry.id) ?? 0) + gap)
      }
      const step = planOutboxEntry({
        entry,
        lane: current.lane,
        pendingKey: current.pendingKey,
        transcriptSettled: current.transcriptSettled,
        landing: outboxEntryLanding(entry, current.messages, current.receipts ?? NO_RECEIPTS),
        now,
        sendable: current.sendable,
        idleForMs: idleSince.current === null ? null : now - idleSince.current,
        waitedMs: waited.current.get(entry.id) ?? 0,
        userRetry: userRetry.current.has(entry.id)
      })
      if (step.kind === 'retire') {
        void retireOutboxSend(entry.id)
        continue
      }
      if (step.kind === 'give-back') {
        void giveBack(entry, step.reason)
        continue
      }
      if (!entry.hasAttachments) {
        current.showEcho(entry)
      }
      if (step.kind === 'fail' && !entry.failed) {
        void patchOutboxEntry(entry.id, { failed: true })
      } else if (step.kind === 'send') {
        void resend(entry)
        return
      }
    }
  }, [giveBack, hydrated, resend])

  // Every change it reads, and a beat while anything of this chat waits: the idle settle and
  // the safe-wait cap are times, not events.
  const waiting =
    hydrated && draftKey !== null && nativeChatOutboxEntries().some((entry) => entry.draftKey === draftKey)
  useEffect(() => {
    evaluate()
  }, [evaluate, version, args.messages, args.transcriptSettled, args.sendable, args.idle, args.pendingKey, lane])
  useEffect(() => {
    if (!waiting) {
      return
    }
    const timer = setInterval(evaluate, TICK_MS)
    return () => clearInterval(timer)
  }, [evaluate, waiting])

  const deliveries = useMemo(() => {
    const map: Record<string, OutboxDelivery> = {}
    for (const entry of nativeChatOutboxEntries()) {
      if (entry.draftKey === draftKey) {
        map[outboxEchoId(entry.id)] = entry.failed ? 'failed' : 'sending'
      }
    }
    return map
    // `version` is the outbox's change counter: the list is module state.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, version])

  const retry = useCallback((rowId: string) => {
    const id = outboxEntryIdOfEcho(rowId)
    if (id) {
      userRetry.current.add(id)
      // A tap on Retry is a new press (#26392): a new operation id, so a ledger row the earlier
      // attempts left unresolved or refused cannot answer it. Its own automatic attempts share it.
      void patchOutboxEntry(id, { failed: undefined, operationId: structuredSessionOperationId(), autoAttempts: 0 })
    }
  }, [])
  const edit = useCallback(
    (rowId: string) => {
      const id = outboxEntryIdOfEcho(rowId)
      const entry = id ? nativeChatOutboxEntries().find((candidate) => candidate.id === id) : undefined
      if (entry && !isOutboxSendLive(entry.id) && inFlight.current !== entry.id) {
        void giveBack(entry, null)
      }
    },
    [giveBack]
  )
  return { deliveries, retry, edit }
}
