/**
 * The message queued while Claude works, on a Claude tab that sends through Anthropic
 * (ccr-send.ts), kept as the Claude Android app 1.261009.20 keeps it (`rs8`, its `h6` field):
 *
 *  - ONE string in memory, not a list: a further send while busy is appended after a blank line
 *    ("\n\n", rs8.java:11279). It is never written to disk, as the app's is not.
 *  - At the turn's end (rs8.java:10475) it is sent as an ordinary message when nothing blocks it;
 *    otherwise it is moved back into the composer (`rs8.T()` → `Y4`). The blockers read there:
 *    not connected (`o3()`), a permission or question waiting (`I2()`, `D2()`), a draft or
 *    attachments in the composer, the Remote Control session offline (`p230.j`), a send already
 *    in flight (`R5.o()`).
 *  - Moved back, it is joined to what the composer holds with a blank line (`Y4`: `str + "\n\n"`
 *    before the text when inserted at the start). Which end `T()` picks is an R8 enum ordinal
 *    (`ypd.G(1)`), read here as the start: the queue goes first, the draft after it. Inferred.
 *  - The steering (`code_steering_messages`) and post-later (`ccr_queued_send_post_at_later`)
 *    paths are remote flags (rs8.java:708-709, `c9g.m`) whose live values the phone cannot read.
 *    The app's busy placeholder "Queue a message…" shows only with steering off
 *    (`ccr_input_placeholder_existing_session_queue`, yv8.L), which is what the user sees, so the
 *    phone takes both as off: the local queue.
 */

/** The queue after `text` is queued: appended after a blank line. Blank text changes nothing. */
export function appendCcrQueue(queue: string | null, text: string): string | null {
  const words = text.trim()
  if (!words) {
    return queue
  }
  return queue ? `${queue}\n\n${words}` : words
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

/** The queue at a turn's end: sent, moved back to the composer (and why), or nothing to do. */
export function ccrQueueAtTurnEnd(queue: string | null, blockers: CcrQueueBlockers): CcrQueueTurnEnd {
  if (!queue || !queue.trim()) {
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
  return because ? { kind: 'to-composer', text: queue, because } : { kind: 'send', text: queue }
}

/** The composer's words once the queue comes back to it: the queue, a blank line, the draft. */
export function returnCcrQueueToComposer(queue: string, draft: string): string {
  return draft.trim() ? `${queue}\n\n${draft}` : queue
}

/**
 * The queue once the `taken` text it held has gone out (or back to the composer): the words
 * appended after it while that took its time, or null when nothing was. `undefined` when the
 * queue no longer starts with `taken` (a tap moved it back to the composer meanwhile), so the
 * caller sends nothing rather than a copy of what the user is now editing.
 */
export function ccrQueueAfter(queue: string | null, taken: string): string | null | undefined {
  if (queue === taken) {
    return null
  }
  if (queue !== null && queue.startsWith(`${taken}\n\n`)) {
    return queue.slice(taken.length + 2)
  }
  return undefined
}
