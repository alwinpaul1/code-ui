type TerminalLiveMirrorSender = (handle: string, payload: string) => Promise<boolean>

type TerminalLivePendingRequest = {
  readonly resolve: (sent: boolean) => void
}

type TerminalLivePendingBatch = {
  readonly handle: string
  payload: string
  readonly requests: TerminalLivePendingRequest[]
  readonly sender: TerminalLiveMirrorSender
  /** Carries control bytes (Enter, Tab, arrows): skipped, not sent, when an
   *  earlier frame of this drain was refused, so a control never lands on a
   *  PTY line whose text did not. */
  requiresPriorSuccess: boolean
}

export type TerminalLiveMirrorSendOptions = {
  requiresPriorSuccess?: boolean
}

export type TerminalLivePendingFlushState = {
  current: Promise<boolean> | null
  activeRequests: TerminalLivePendingRequest[]
  generation: number
  pendingBatches: TerminalLivePendingBatch[]
  /** Wakes a drain that is waiting on in-flight replies when new bytes queue. */
  wake: (() => void) | null
}

export function createTerminalLivePendingFlushState(): TerminalLivePendingFlushState {
  return {
    current: null,
    activeRequests: [],
    generation: 0,
    pendingBatches: [],
    wake: null
  }
}

export function waitForTerminalLivePendingFlush(
  state: TerminalLivePendingFlushState
): Promise<boolean> {
  return state.current ?? Promise.resolve(true)
}

export function cancelTerminalLivePendingFlush(state: TerminalLivePendingFlushState): void {
  state.generation += 1
  const requests = [
    ...state.activeRequests,
    ...state.pendingBatches.flatMap((batch) => batch.requests)
  ]
  state.activeRequests = []
  state.pendingBatches = []
  state.current = null
  state.wake?.()
  state.wake = null
  requests.forEach(({ resolve }) => resolve(false))
}

/** Sends a single terminal may have unanswered at once. Measured on a Galaxy
 *  S23 over Orca Relay, 2026-09-11: one in flight made every keystroke wait
 *  for the previous reply, so typing landed in clumps a few hundred ms late.
 *  The socket keeps order; a control frame (Enter, arrows) still waits for
 *  every earlier frame to be answered before it goes. */
const LIVE_MIRROR_MAX_IN_FLIGHT = 4

async function drainTerminalLiveMirrorSends(
  state: TerminalLivePendingFlushState,
  generation: number
): Promise<boolean> {
  let allSent = true
  const inFlight: Promise<boolean>[] = []
  const settle = async (): Promise<boolean> => {
    const results = await Promise.all(inFlight.splice(0))
    if (state.generation !== generation) {
      return false
    }
    allSent &&= results.every(Boolean)
    return true
  }
  while (state.generation === generation) {
    const batch = state.pendingBatches.shift()
    if (!batch) {
      if (inFlight.length === 0) {
        state.current = null
        return allSent
      }
      // Nothing queued but replies outstanding: wait for a reply OR for the
      // next keystroke, whichever comes first, so typing never waits.
      const woken = new Promise<void>((resolve) => {
        state.wake = resolve
      })
      const anyReply = Promise.race(inFlight).then(() => undefined)
      await Promise.race([woken, anyReply])
      state.wake = null
      if (state.generation !== generation) {
        return false
      }
      if (state.pendingBatches.length === 0 && !(await settle())) {
        return false
      }
      continue
    }

    if (batch.requiresPriorSuccess) {
      if (inFlight.length > 0 && !(await settle())) {
        return false
      }
      if (!allSent) {
        batch.requests.forEach(({ resolve }) => resolve(false))
        continue
      }
    }
    state.activeRequests.push(...batch.requests)
    const send = batch.sender(batch.handle, batch.payload)
      .catch(() => false)
      .then((sent) => {
        if (state.generation === generation) {
          state.activeRequests = state.activeRequests.filter(
            (request) => !batch.requests.includes(request)
          )
          batch.requests.forEach(({ resolve }) => resolve(sent))
          if (state.pendingBatches.length === 0 && state.activeRequests.length === 0) {
            state.current = null
          }
        }
        return sent
      })
    inFlight.push(send)
    if (inFlight.length >= LIVE_MIRROR_MAX_IN_FLIGHT) {
      const sent = await inFlight.shift()!
      if (state.generation !== generation) {
        return false
      }
      allSent &&= sent
    }
  }
  return false
}

// Mirror deltas are ordered PTY bytes; batching pending bytes avoids one RTT per keystroke.
export function queueTerminalLiveMirrorSend(
  state: TerminalLivePendingFlushState,
  handle: string,
  payload: string,
  sender: TerminalLiveMirrorSender,
  options: TerminalLiveMirrorSendOptions = {}
): Promise<boolean> {
  let resolveRequest: (sent: boolean) => void = () => {}
  const request = new Promise<boolean>((resolve) => {
    resolveRequest = resolve
  })
  const pendingTail = state.pendingBatches.at(-1)
  if (pendingTail?.handle === handle && pendingTail.sender === sender) {
    pendingTail.payload += payload
    pendingTail.requests.push({ resolve: resolveRequest })
    pendingTail.requiresPriorSuccess ||= options.requiresPriorSuccess === true
  } else {
    state.pendingBatches.push({
      handle,
      payload,
      requests: [{ resolve: resolveRequest }],
      sender,
      requiresPriorSuccess: options.requiresPriorSuccess === true
    })
  }

  state.wake?.()
  if (!state.current) {
    const generation = state.generation
    // Why a microtask: the drain used to take the first batch synchronously, so
    // text and the Enter queued right after it always went as two frames — two
    // relay round trips per command. Deferring one tick lets everything pushed
    // in the same turn coalesce into one terminal.send, at no visible cost.
    const drain = Promise.resolve()
      .then(() => drainTerminalLiveMirrorSends(state, generation))
      .catch(() => false)
    state.current = drain
    void drain.then(() => {
      if (state.current === drain) {
        state.current = null
      }
    })
  }
  return request
}
