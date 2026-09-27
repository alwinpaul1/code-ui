// Pure: no React Native or Expo imports, so vitest runs it unmocked. The Android-specific escape
// below is wired up from the device layer through `configurePickerGateStaleEscape`; this file only
// ever sees a plain `isActive` poll, never AppState itself.
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
 * Thrown when a call never gets its own picker: its waiter said it was no longer wanted, or its own
 * abort signal fired, either before its turn came or (for the signal) while it was still waiting on
 * one. A caller catches this and reports it its own way (the file save turns it into `'abandoned'`);
 * it is never shown to the user directly.
 */
export class PickerGateAbandonedError extends Error {
  constructor(message = 'left before its turn at the picker') {
    super(message)
    this.name = 'PickerGateAbandonedError'
  }
}

export type PickerGateWaiter = {
  /** A call whose signal aborts settles at once, whether it is still queued or is waiting on a
   *  picker call the launcher never answers -- it never sits out someone ELSE's stuck picker just
   *  to be told it dropped out. */
  signal?: AbortSignal
  /** Checked once the gate is free, right before `open` runs. False drops the call out the same
   *  way an aborted signal does. */
  isStillWanted?: () => boolean
}

/**
 * How a picker whose result never comes back stops holding up every request behind it forever. A
 * lost result is rare but real: `IntentLauncherModule.kt`'s `OnActivityResult` is the only thing
 * that ever resolves `pendingPromise`, and if Android never delivers it (the hosting Activity was
 * recreated under the picker, say) that promise -- and, before this queue existed, only THAT one
 * save -- simply never returned. Configured once from the Android device layer
 * (`configurePickerGateStaleEscape`), with a poll of `AppState`: a picker that is genuinely still
 * open has taken the foreground away from the app, so `isActive` reads false for as long as that
 * holds. If it reads true for `activeMs` straight while the picker ahead is still unsettled, that
 * call's result is treated as lost, and the request behind it gets its own real turn -- which, if
 * the native module's `pendingPromise` is in fact still set, fails right back with the launcher's
 * own ActivityAlreadyStartedException: the same answer a second save got on main before this queue
 * existed. The stuck call's own promise is left exactly as it was, still waiting -- same as it
 * would be with no queue at all.
 */
export type PickerGateStaleEscape = {
  isActive: () => boolean
  activeMs: number
  pollMs: number
}

let staleEscape: PickerGateStaleEscape | null = null

/** Called once from the Android device layer at startup. `null` (its default, and every other
 *  platform's) turns the escape off. */
export function configurePickerGateStaleEscape(escape: PickerGateStaleEscape | null): void {
  staleEscape = escape
}

// The chain end: settles once the picker request queued before it (if any) has finished with its
// own picker, or been forced to move on by the stale escape. Reassigning it inside
// `withPickerGate`, before any `await`, is what keeps two calls made back to back in the same order
// they were made.
let queueTail: Promise<void> = Promise.resolve()

/**
 * Runs `open` (a call that opens Android's create-document picker) once every earlier request
 * through this gate has finished with its own -- or been forced to move on (see
 * `PickerGateStaleEscape`). Ends every request eventually: a rejected picker frees the next one, an
 * abandoned waiter never occupies the gate at all, and a picker that genuinely never returns is
 * eventually let go of by the stale escape rather than left to block every save behind it forever.
 */
export function withPickerGate<T>(
  open: () => Promise<T>,
  waiter: PickerGateWaiter = {}
): Promise<T> {
  const myTurn = queueTail
  let releaseQueueEarly: (() => void) | undefined
  const queueReleasedEarly = new Promise<void>((resolve) => {
    releaseQueueEarly = resolve
  })
  const innerSettled = myTurn.then(() => {
    if (waiter.signal?.aborted || waiter.isStillWanted?.() === false) {
      throw new PickerGateAbandonedError()
    }
    const opened = open()
    watchForLostResult(opened, releaseQueueEarly!)
    return opened
  })
  const innerSettledQuiet = innerSettled.then(
    () => undefined,
    () => undefined
  )
  // The next call in line moves on on whichever comes first: this one genuinely finishing, or the
  // stale escape giving up on it. Never chained off `myTurn` again here -- that would let two
  // waiters queued behind the same picker jump it at once.
  queueTail = Promise.race([innerSettledQuiet, queueReleasedEarly])
  return raceAbort(innerSettled, waiter.signal)
}

/** The promise `withPickerGate` returns: the same as `innerSettled`, except that a signal aborting
 *  while this call is still waiting on it settles the call immediately, rather than leaving it to
 *  whatever `innerSettled` itself is waiting on -- which might be a picker call that never returns
 *  at all. The queue itself (`innerSettledQuiet` above) is unaffected: it still waits for the real
 *  `innerSettled`, so a save queued behind THIS one is not let through early just because this one's
 *  own caller stopped waiting for it. */
function raceAbort<T>(innerSettled: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return innerSettled
  }
  if (signal.aborted) {
    return Promise.reject(new PickerGateAbandonedError())
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(new PickerGateAbandonedError())
    }
    signal.addEventListener('abort', onAbort)
    innerSettled.then(
      (value) => {
        if (settled) {
          return
        }
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/** Starts (only if an escape is configured) the watch that frees the queue when `opened` looks like
 *  a lost result: the app active continuously for `activeMs` while `opened` is still unsettled. */
function watchForLostResult(opened: Promise<unknown>, releaseQueueEarly: () => void): void {
  const escape = staleEscape
  if (!escape) {
    return
  }
  // Seeded synchronously, not on the first tick: if the app is already active the moment `open`
  // runs (the common case -- a picker whose result is lost still leaves the app in front), the
  // clock starts now, not up to one `pollMs` later.
  let activeSinceMs: number | null = escape.isActive() ? Date.now() : null
  const timer = setInterval(() => {
    if (!escape.isActive()) {
      activeSinceMs = null
      return
    }
    if (activeSinceMs === null) {
      activeSinceMs = Date.now()
      return
    }
    if (Date.now() - activeSinceMs >= escape.activeMs) {
      clearInterval(timer)
      releaseQueueEarly()
    }
  }, escape.pollMs)
  opened.then(
    () => clearInterval(timer),
    () => clearInterval(timer)
  )
}

/** Test-only: clears the queue and any configured escape between test cases, so a test that leaves
 *  a picker call unsettled (a failure partway through, say) cannot hang the tests that run after it
 *  (mobile-picker-gate.test.ts, mobile-file-save-picker-gate.test.ts). Never called from production
 *  code. */
export function resetPickerGateForTests(): void {
  queueTail = Promise.resolve()
  staleEscape = null
}
