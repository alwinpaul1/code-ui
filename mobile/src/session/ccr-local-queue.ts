/**
 * The messages queued while Claude works, on a Claude tab that sends through Anthropic
 * (ccr-send.ts). The Claude Android app 1.261013.20 has three paths for a send while busy (the
 * send lambda, ay8.java:8729-8742):
 *
 *  - steering (`code_steering_messages`, su8.java:760, `X2()`): posted at once, `priority: "next"`;
 *  - post-later (`ccr_queued_send_post_at_later`, su8.java:761, read at ay8.java:8736): posted at
 *    once, `priority: "later"` (`su8.l5`, su8.java:11102-11190), so each send is its own message;
 *  - otherwise a local queue: ONE string (`su8.H6`), a further send appended after a blank line
 *    (`kre.m(W1(), "\n\n", string)`, ay8.java:8738), drawn as one card (`ti30.j`).
 *
 * Both flags are remote and the phone cannot read them. The user sees each send kept separate in
 * the app (reported 2026-10-16), which is the post-later (or steering) path, but how the server
 * holds and echoes a `"later"` message mid-turn is not determined (docs/claude-app-parity-gaps.md
 * §7). So the phone keeps the local queue, but as a LIST: one entry per send, a card per entry,
 * and at a turn's end only the FIRST entry goes, as an ordinary send; the next goes when the turn
 * that one started has ended. Nothing here relies on unobserved server behaviour.
 *
 *  - Never written to disk, as the app's is not.
 *  - At a turn's end the first entry is sent when nothing blocks it; otherwise every entry is
 *    moved back into the composer (`rs8.T()` → `Y4`), in order, joined by blank lines, ahead of
 *    the draft. The blockers read there: not connected (`o3()`), a permission or question waiting
 *    (`I2()`, `D2()`), a draft or attachments in the composer, the Remote Control session offline
 *    (`p230.j`), a send already in flight (`R5.o()`).
 *  - Moved back, words are joined to what the composer holds with a blank line (`Y4`: `str +
 *    "\n\n"` before the text when inserted at the start), the queue first, the draft after it.
 *    Which end `T()` picks is an R8 enum ordinal (`ypd.G(1)`), read here as the start. Inferred.
 */

/** A tab's queued messages, oldest first. Never empty while held: an empty queue is no queue. */
export type CcrQueue = readonly string[]

/** The queue after `text` is queued: a new entry at the end, never joined to the one before it.
 *  Blank text changes nothing. */
export function appendCcrQueue(queue: CcrQueue | null, text: string): CcrQueue | null {
  const words = text.trim()
  if (!words) {
    return queue
  }
  return [...(queue ?? []), words]
}

/** Every entry as one text, in order, joined by blank lines: for the composer when the queue is
 *  moved back there, and for the one post-later message on leaving (use-ccr-tab-queues.ts). */
export function joinCcrQueue(queue: CcrQueue): string {
  return queue.join('\n\n')
}

/** What blocks the queue from going out at the turn's end (the app's list, above). */
export type CcrQueueBlockers = {
  /** No connection to Anthropic for the session, or its Remote Control computer offline. */
  offline: boolean
  /** A permission, question or plan card waiting for an answer. */
  promptUp: boolean
  /** Words the user is typing in the composer now. */
  draft: string
  /** Pictures or files attached in the composer. */
  attachments: number
  /** A send still in flight. */
  sending: boolean
}

export type CcrQueueTurnEnd =
  | { kind: 'none' }
  | { kind: 'send'; text: string }
  | { kind: 'to-composer'; text: string; because: string }

/** The queue at a turn's end: its FIRST entry sent, every entry moved back to the composer (and
 *  why), or nothing to do. */
export function ccrQueueAtTurnEnd(queue: CcrQueue | null, blockers: CcrQueueBlockers): CcrQueueTurnEnd {
  const first = queue?.[0]
  if (!queue || first === undefined || !first.trim()) {
    return { kind: 'none' }
  }
  const because = blockers.offline
    ? 'the session is offline'
    : blockers.promptUp
      ? 'a prompt is waiting'
      : blockers.draft.trim()
        ? 'the composer has a draft'
        : blockers.attachments > 0
          ? 'the composer has attachments'
          : blockers.sending
            ? 'a send is in flight'
            : null
  return because ? { kind: 'to-composer', text: joinCcrQueue(queue), because } : { kind: 'send', text: first }
}

/** The composer's words once the queue comes back to it: the queue, a blank line, the draft. */
export function returnCcrQueueToComposer(queue: string, draft: string): string {
  return draft.trim() ? `${queue}\n\n${draft}` : queue
}

/** The same give-back RE-APPLIED from a stored record to a save or a read that may already hold
 *  it (native-chat-drafts.ts): it goes in once. Never for a live give-back, where a queued message
 *  identical to the draft, or beginning it, is a message of its own (fourth review, 2026-10-17). */
export function reapplyCcrQueueToComposer(queue: string, draft: string): string {
  return draft === queue || draft.startsWith(`${queue}\n\n`) ? draft : returnCcrQueueToComposer(queue, draft)
}

/**
 * The queue once its first entry, `taken`, has gone out (or back to the composer): the entries
 * behind it, or null when none. `undefined` when the queue no longer starts with `taken` (a tap
 * moved it back to the composer meanwhile), so the caller sends nothing rather than a copy of what
 * the user is now editing.
 */
export function ccrQueueAfter(queue: CcrQueue | null, taken: string): CcrQueue | null | undefined {
  if (!queue || queue[0] !== taken) {
    return undefined
  }
  return queue.length > 1 ? queue.slice(1) : null
}

/** The queue with entry `index` taken out (a tap on its card), and that entry's words; null when
 *  there is no such entry. */
export function takeCcrQueueEntry(queue: CcrQueue | null, index: number): { text: string; rest: CcrQueue | null } | null {
  const text = queue?.[index]
  if (!queue || text === undefined) {
    return null
  }
  const rest = queue.filter((_, at) => at !== index)
  return { text, rest: rest.length > 0 ? rest : null }
}
