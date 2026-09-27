// Pure: no React Native or Expo imports, so vitest runs it unmocked.
//
// expo-intent-launcher (57.0.1) keeps a single `pendingPromise` for Android's create-document
// picker (IntentLauncherModule.kt): a second `startActivityAsync` while one is still open throws
// its own ActivityAlreadyStartedException rather than queuing. The file-save runner already gives
// each FILE its own slot (mobile-file-save.ts), so nothing stopped two DIFFERENT files -- or a
// file save and the PDF viewer's Download (mobile-pdf-download.ts) -- from each reaching their own
// picker call at once. Both call sites route their picker request through `withPickerGate`, the one
// module-level queue below, so only one picker is ever actually asked for at a time, whichever
// caller it comes from.

/**
 * Thrown when a call drops out of the queue instead of waiting its turn: its waiter said it was no
 * longer wanted, or its own abort signal had fired, by the time the picker ahead of it closed. A
 * caller catches this and reports it its own way (the file save turns it into `'abandoned'`); it is
 * never shown to the user directly.
 */
export class PickerGateAbandonedError extends Error {
  constructor(message = 'left before its turn at the picker') {
    super(message)
    this.name = 'PickerGateAbandonedError'
  }
}

export type PickerGateWaiter = {
  /** Aborted while this call is still waiting for another picker to close: it drops out the
   *  moment its turn comes, without ever opening its own. */
  signal?: AbortSignal
  /** Checked once the gate is free, right before `open` runs. False drops the call out the same
   *  way an aborted signal does. */
  isStillWanted?: () => boolean
}

// The chain end: settles once the picker request queued before it (if any) has finished with its
// own picker, resolved or not. Reassigning it inside `withPickerGate`, before any `await`, is what
// keeps two calls made back to back in the same order they were made.
let queueTail: Promise<void> = Promise.resolve()

/**
 * Runs `open` (a call that opens Android's create-document picker) once every earlier request
 * through this gate has finished with its own. Never hangs: the queue moves on the instant each
 * picker settles, whether it resolved, rejected, or the waiter behind it dropped out instead of
 * opening one at all -- so one picker failing, or one screen going away, never blocks the rest.
 */
export function withPickerGate<T>(
  open: () => Promise<T>,
  waiter: PickerGateWaiter = {}
): Promise<T> {
  const myTurn = queueTail
  const result = myTurn.then(() => {
    if (waiter.signal?.aborted || waiter.isStillWanted?.() === false) {
      throw new PickerGateAbandonedError()
    }
    return open()
  })
  // The next call in line waits for THIS one to settle, never for `myTurn` again: chaining off
  // `myTurn` here would let two waiters queued behind the same picker jump it at once.
  queueTail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}
