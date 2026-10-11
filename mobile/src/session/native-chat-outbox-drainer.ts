import {
  hydrateNativeChatOutbox,
  nativeChatOutboxEntries,
  subscribeNativeChatOutbox,
  type NativeChatOutboxEntry,
  type NativeChatOutboxFailReason
} from '../storage/native-chat-outbox'
import type { RpcClient } from '../transport/rpc-client'
import {
  claimOutboxSend,
  findOutboxEntry,
  isOutboxSendLive,
  outboxChatIdleOrHidden,
  outboxChatRecoveryOwns,
  outboxEntryDrainable,
  patchOutboxEntry,
  retireOutboxSend,
  subscribeOutboxDrainWanted,
  unclaimOutboxSend
} from './native-chat-outbox-sends'
import {
  OUTBOX_DRAIN_NO_LINK_RECHECK_MS,
  OUTBOX_TAB_GONE_CONFIRM_MS,
  outboxDrainBackoffMs,
  outboxDrainCandidates,
  outboxTerminalConfirmedAt,
  planOutboxDrain,
  type OutboxDrainObservation,
  type OutboxSendOutcome
} from './native-chat-outbox-drain-plan'

export type { OutboxSendOutcome }

/**
 * The app-wide outbox drainer: sends every chat's waiting messages as soon as the host's link is
 * up, from the root of the app, whichever chat, tab or screen is showing.
 *
 * Before it (0.9.128 and earlier) only a chat's own recovery sent its entries, and only while
 * that chat was on screen, so a message whose hold ran out while the user was in another chat
 * went out when they came back, and a photo said "Delivery unconfirmed" and was given up on
 * (the user: "All messages must be send reliability and must not drop", 2026-10-11).
 *
 * When it runs: once the stored outbox is read at start, whenever the outbox changes or a send
 * hands an entry over (releaseOutboxSend), on every new connection to a host and every return of
 * the app to the front (use-native-chat-outbox-drainer.ts), and on a timer while an entry waits
 * out its backoff. One pass at a time; a kick during a pass runs one more after it.
 *
 * What it takes: native-chat-outbox-drain-plan.ts. A text entry whose chat is on screen with a
 * settled transcript is that chat's recovery's (it reads the chat's own screen state); every
 * other entry, and every photo entry, is the drainer's. Each send claims the entry for its
 * length, so the two never carry one entry at once.
 *
 * What it says: nothing in a chat (none is on screen for it). The host's connection log gets at
 * most two lines per entry, when it sends one the chat had left behind and when it gives one up,
 * never one per try: a log line per send pushed the connection events out of the 200-line log
 * before (native-chat-send-timing.ts, 0.9.127).
 */

export type OutboxDrainDeps = {
  now: () => number
  /** The host's client when its link is up, else null. */
  connectedClient: (hostId: string) => RpcClient | null
  observe: (client: RpcClient, entry: NativeChatOutboxEntry) => Promise<OutboxDrainObservation>
  send: (
    client: RpcClient,
    entry: NativeChatOutboxEntry,
    observation: OutboxDrainObservation
  ) => Promise<OutboxSendOutcome>
  setTimer: (ms: number, run: () => void) => () => void
  log: (hostId: string, line: { level: 'info' | 'warn'; message: string; detail: string }) => void
}

type DrainState = {
  /** Tries in a row that came to nothing (a wait, a refusal, an unknown answer). */
  failures: number
  /** Not tried again before this, by the phone's clock. */
  nextAt: number
  /** The drainer sent it at least once: its delivery is worth a line. */
  sent: boolean
  /** When its tab was first seen missing from the tab list, while it stays missing. */
  tabGoneSince?: number
}

export type OutboxDrainer = {
  /** Looks at the outbox now. `fresh` (a new connection, the app back in front) starts every
   *  entry's backoff over. */
  kick: (options?: { fresh?: boolean }) => void
  /** Settles when the pass running now, and any it queued, are done (tests). */
  idle: () => Promise<void>
  stop: () => void
}

const FAIL_WORDS: Record<NativeChatOutboxFailReason, string> = {
  tooOld: 'more than a day old',
  session: 'the tab moved to another session',
  tabClosed: 'its tab was closed on the desktop',
  unsure: 'the transcript cannot show whether it arrived',
  attempts: 'the desktop kept refusing it'
}

function sizes(entry: NativeChatOutboxEntry): string {
  const parts = [
    `${entry.text.length} chars`,
    ...(entry.attachments?.length ? [`${entry.attachments.length} attachment(s)`] : []),
    `lane ${entry.route?.lane ?? 'unknown'}`,
    `tab ${entry.route?.tabId ?? entry.draftKey.split('\0').at(-1) ?? 'none'}`
  ]
  return parts.join(' · ')
}

export function createOutboxDrainer(deps: OutboxDrainDeps): OutboxDrainer {
  const states = new Map<string, DrainState>()
  let running: Promise<void> | null = null
  let again = false
  let stopped = false
  let cancelTimer: (() => void) | null = null

  const stateOf = (id: string): DrainState => {
    let state = states.get(id)
    if (!state) {
      state = { failures: 0, nextAt: 0, sent: false }
      states.set(id, state)
    }
    return state
  }
  const backOff = (state: DrainState): void => {
    state.failures += 1
    state.nextAt = deps.now() + outboxDrainBackoffMs(state.failures)
  }

  const fail = async (entry: NativeChatOutboxEntry, reason: NativeChatOutboxFailReason): Promise<void> => {
    if (entry.failed) {
      return
    }
    // The mark is in memory at once, saved or not, so a later pass never gives it up again.
    await patchOutboxEntry(entry.id, { failed: true, failedReason: reason })
    if (entry.route && findOutboxEntry(entry.id)?.failed) {
      deps.log(entry.route.hostId, {
        level: 'warn',
        message: 'Message not sent: it waits in its chat for Retry',
        detail: `${FAIL_WORDS[reason]} · ${entry.autoAttempts} automatic send(s) · ${sizes(entry)}`
      })
    }
  }

  const retire = (entry: NativeChatOutboxEntry, state: DrainState, how: 'sent' | 'arrived'): void => {
    void retireOutboxSend(entry.id)
    states.delete(entry.id)
    if (entry.route && (state.sent || how === 'arrived')) {
      deps.log(entry.route.hostId, {
        level: 'info',
        message: how === 'sent' ? 'Message sent from the outbox' : 'Message from the outbox had arrived',
        detail: `${entry.autoAttempts} automatic send(s) · ${sizes(entry)}`
      })
    }
  }

  const drainOne = async (entry: NativeChatOutboxEntry, client: RpcClient, state: DrainState): Promise<void> => {
    let observation: OutboxDrainObservation =
      entry.route?.lane === 'session'
        ? { kind: 'clear' }
        : await deps.observe(client, entry).catch((): OutboxDrainObservation => ({ kind: 'busy' }))
    // One reading without the tab is not a closed tab: a desktop Orca that just restarted lists
    // none until it restores them, and a closed tab cannot be taken back.
    if (observation.kind === 'tab-gone') {
      state.tabGoneSince ??= deps.now()
      if (deps.now() - state.tabGoneSince < OUTBOX_TAB_GONE_CONFIRM_MS) {
        observation = { kind: 'busy' }
      }
    } else {
      state.tabGoneSince = undefined
    }
    // The entry as it is now: a row seen, a Retry or an edit in the meantime changed it.
    const current = findOutboxEntry(entry.id)
    if (!current || current.failed) {
      return
    }
    const step = planOutboxDrain(current, observation, deps.now())
    if (step.kind === 'retire') {
      retire(current, state, state.sent ? 'sent' : 'arrived')
      return
    }
    if (step.kind === 'fail') {
      await fail(current, step.reason)
      states.delete(current.id)
      return
    }
    if (step.kind === 'wait') {
      backOff(state)
      return
    }
    // The chat may have come on screen with words in its composer while the look ran.
    if (current.route?.lane === 'terminal' && !outboxChatIdleOrHidden(current.draftKey)) {
      backOff(state)
      return
    }
    // Counted on disk BEFORE it goes: a process that dies now leaves the next one knowing a copy
    // may be out (and, for a terminal, when it went: the confirm wait runs from then).
    const attemptAt = deps.now()
    if (
      !(await patchOutboxEntry(current.id, {
        autoAttempts: current.autoAttempts + 1,
        lastAttemptAt: attemptAt
      }))
    ) {
      backOff(state)
      return
    }
    state.sent = true
    let outcome: OutboxSendOutcome
    try {
      outcome = await deps.send(client, { ...current, autoAttempts: current.autoAttempts + 1, lastAttemptAt: attemptAt }, observation)
    } catch {
      outcome = 'unknown'
    }
    if (outcome === 'accepted') {
      retire(current, state, 'sent')
      return
    }
    if (outcome === 'not-now') {
      // Refused before anything went out: this try costs no attempt. A refusal after something
      // may have been typed ('rejected') keeps its count (Opus review of 4efae5746).
      await patchOutboxEntry(current.id, { autoAttempts: current.autoAttempts })
    }
    backOff(state)
  }

  const pass = async (): Promise<void> => {
    await hydrateNativeChatOutbox()
    if (stopped) {
      return
    }
    cancelTimer?.()
    cancelTimer = null
    const candidates = outboxDrainCandidates(nativeChatOutboxEntries(), {
      live: (entry) => isOutboxSendLive(entry.id),
      drainable: outboxEntryDrainable,
      ownedByChat: (entry) => !entry.hasAttachments && outboxChatRecoveryOwns(entry.draftKey)
    })
    let soonest = Number.POSITIVE_INFINITY
    for (const entry of candidates) {
      if (stopped) {
        return
      }
      const route = entry.route!
      const state = stateOf(entry.id)
      const due = Math.max(state.nextAt, route.lane === 'terminal' ? outboxTerminalConfirmedAt(entry) : 0)
      if (deps.now() < due) {
        soonest = Math.min(soonest, due)
        continue
      }
      // A chat on screen whose composer holds words, or whose agent is busy: its live-input
      // mirror types into the same terminal, so nothing is typed under it.
      if (route.lane === 'terminal' && !outboxChatIdleOrHidden(entry.draftKey)) {
        backOff(state)
        soonest = Math.min(soonest, state.nextAt)
        continue
      }
      const client = deps.connectedClient(route.hostId)
      if (!client) {
        // Waits for the host's next connection, which kicks a fresh pass, and looks again now and
        // then for a link nothing announces (the background watcher's).
        soonest = Math.min(soonest, deps.now() + OUTBOX_DRAIN_NO_LINK_RECHECK_MS)
        continue
      }
      if (!claimOutboxSend(entry.id)) {
        continue
      }
      try {
        await drainOne(entry, client, state)
      } finally {
        unclaimOutboxSend(entry.id)
      }
      if (states.has(entry.id)) {
        soonest = Math.min(soonest, state.nextAt)
      }
    }
    // Forget the backoff of entries that left the outbox.
    const present = new Set(nativeChatOutboxEntries().map((entry) => entry.id))
    for (const id of states.keys()) {
      if (!present.has(id)) {
        states.delete(id)
      }
    }
    if (!stopped && Number.isFinite(soonest)) {
      cancelTimer = deps.setTimer(Math.max(0, soonest - deps.now()), () => kick())
    }
  }

  const kick = (options?: { fresh?: boolean }): void => {
    if (stopped) {
      return
    }
    if (options?.fresh) {
      for (const state of states.values()) {
        state.failures = 0
        state.nextAt = 0
      }
    }
    if (running) {
      again = true
      return
    }
    running = (async () => {
      try {
        do {
          again = false
          await pass()
        } while (again && !stopped)
      } catch (error) {
        console.warn('[outbox] drain pass failed; the next change or connection runs another', error)
      } finally {
        running = null
      }
    })()
  }

  const unsubscribeOutbox = subscribeNativeChatOutbox(() => kick())
  const unsubscribeWanted = subscribeOutboxDrainWanted(() => kick())

  return {
    kick,
    idle: async () => {
      while (running) {
        await running
      }
    },
    stop: () => {
      stopped = true
      cancelTimer?.()
      cancelTimer = null
      unsubscribeOutbox()
      unsubscribeWanted()
    }
  }
}
