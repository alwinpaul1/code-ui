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
}

export function createTerminalLivePendingFlushState(): TerminalLivePendingFlushState {
  return {
    current: null,
    activeRequests: [],
    generation: 0,
    pendingBatches: []
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
  requests.forEach(({ resolve }) => resolve(false))
}

async function drainTerminalLiveMirrorSends(
  state: TerminalLivePendingFlushState,
  generation: number
): Promise<boolean> {
  let allSent = true
  while (state.generation === generation) {
    const batch = state.pendingBatches.shift()
    if (!batch) {
      state.current = null
      return allSent
    }

    if (batch.requiresPriorSuccess && !allSent) {
      batch.requests.forEach(({ resolve }) => resolve(false))
      continue
    }
    state.activeRequests = batch.requests
    const sent = await batch.sender(batch.handle, batch.payload).catch(() => false)
    if (state.generation !== generation) {
      return false
    }

    state.activeRequests = []
    batch.requests.forEach(({ resolve }) => resolve(sent))
    allSent &&= sent
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
