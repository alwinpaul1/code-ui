import type { TerminalDocumentScope } from './document-scope'
import { C1_CSI, ESC } from './escape-introducers'
import { nowMs } from './viewport-transform'

// A scroll that outlasts this drains anyway: a reader parked in scrollback
// must not freeze the live view indefinitely.
const SCROLL_WRITE_HOLD_MAX_MS = 1200

/** Claude's record dot, which iOS WebKit would otherwise promote to a colourful emoji glyph. */
const CLAUDE_STATUS_DOT = '\u23fa'

/** The variation selector that forces the text glyph. */
const TEXT_PRESENTATION_SELECTOR = '\ufe0e'

/** The variation selector that forces the emoji glyph. */
const EMOJI_PRESENTATION_SELECTOR = '\ufe0f'

/**
 * The dot with any trailing selectors, as one pattern.
 *
 * A literal rather than a construction: a `new RegExp` at a module's top level is parse-time work
 * (ruling 20), and `replace` leaves no `lastIndex` behind for the next document to find.
 */
const CLAUDE_STATUS_DOT_PATTERN = /\u23fa[\ufe0e\ufe0f]*/g

/** How far a split DECSET may be carried before the mode scan gives up. */
const PRIVATE_MODE_SCAN_TAIL_LIMIT = 4096

export function resetWriteQueue(scope: TerminalDocumentScope) {
  scope.writeQueue = []
  scope.writeQueueHead = 0
  // A replacement terminal owes nothing to the gesture the old one saw.
  scope.scrollGestureActive = false
  cancelHeldWritePump(scope)
}

export function isStatusDotPresentationSelector(value: string) {
  return value === TEXT_PRESENTATION_SELECTOR || value === EMOJI_PRESENTATION_SELECTOR
}

export function endsWithStatusDotPresentationSequence(data: string) {
  let i = data.length - 1
  while (i >= 0 && isStatusDotPresentationSelector(data.charAt(i))) {
    i--
  }
  return i >= 0 && data.charAt(i) === CLAUDE_STATUS_DOT
}

// Why: iOS WebKit promotes Claude's record/status dot to a colorful emoji glyph.
export function normalizeStatusDotPresentation(scope: TerminalDocumentScope, data: string) {
  if (typeof data !== 'string' || data.length === 0) {
    return data
  }
  if (scope.statusDotPendingSelector) {
    scope.statusDotPendingSelector = false
    let strippedPendingSelectors = false
    while (data.length > 0 && isStatusDotPresentationSelector(data.charAt(0))) {
      data = data.slice(1)
    }
    strippedPendingSelectors = data.length === 0
    if (strippedPendingSelectors) {
      scope.statusDotPendingSelector = true
      return ''
    }
  }
  const normalized = data.replace(
    CLAUDE_STATUS_DOT_PATTERN,
    CLAUDE_STATUS_DOT + TEXT_PRESENTATION_SELECTOR
  )
  scope.statusDotPendingSelector = endsWithStatusDotPresentationSequence(data)
  return normalized
}

export function enqueueWrite(scope: TerminalDocumentScope, data: string) {
  scope.writeQueue.push(normalizeStatusDotPresentation(scope, data))
}

export function enqueueWriteBoundary(scope: TerminalDocumentScope, callback: () => void) {
  scope.writeQueue.push(callback)
}

export function nextQueuedWrite(scope: TerminalDocumentScope) {
  if (scope.writeQueueHead >= scope.writeQueue.length) {
    resetWriteQueue(scope)
    return undefined
  }
  const next = scope.writeQueue[scope.writeQueueHead]
  scope.writeQueue[scope.writeQueueHead] = undefined
  scope.writeQueueHead++
  // Why: high-throughput terminals can enqueue faster than xterm parses;
  // compact consumed slots so drain work stays O(1) without retaining old chunks.
  if (scope.writeQueueHead > 128 && scope.writeQueueHead * 2 > scope.writeQueue.length) {
    scope.writeQueue = scope.writeQueue.slice(scope.writeQueueHead)
    scope.writeQueueHead = 0
  }
  return next
}

export function disposeTermObservers(scope: TerminalDocumentScope) {
  const disposables = scope.termObserverDisposables
  scope.termObserverDisposables = []
  for (let i = 0; i < disposables.length; i++) {
    try {
      // oxlint-disable-next-line no-unused-expressions -- the guard is the call's own condition; the document's text is pinned token for token
      disposables[i] && disposables[i].dispose && disposables[i].dispose!()
    } catch {}
  }
}

export function extractMouseModeScanTail(input: string) {
  const start = Math.max(input.lastIndexOf(ESC), input.lastIndexOf(C1_CSI))
  if (start === -1) {
    return ''
  }
  const tail = input.slice(start)
  // Why: PTY/SSH chunks can split a long combined DECSET before the final h/l.
  // Keep parser state far beyond normal mode lists while still bounding memory.
  if (tail.length > PRIVATE_MODE_SCAN_TAIL_LIMIT) {
    return ''
  }
  if (tail === ESC || tail === ESC + '[' || tail === C1_CSI) {
    return tail
  }
  if (tail.indexOf(ESC + '[?') === 0) {
    return /^[0-9;]*$/.test(tail.slice(3)) ? tail : ''
  }
  if (tail.indexOf(C1_CSI + '?') === 0) {
    return /^[0-9;]*$/.test(tail.slice(2)) ? tail : ''
  }
  return ''
}

/**
 * xterm.write() parses AND repaints, on the same WebView JS thread that has
 * to move the finger's pixels. A Claude or Codex TUI repaints its whole
 * screen several times a second, so a drag spent most of its frames waiting
 * on a parse.
 *
 * Measured on a 120 Hz S23, real finger, same gesture back to back: the chat
 * held a flat 120 fps with zero frames over 16.7ms, while the terminal
 * managed 15 fps with 42% of frames over 16.7ms and a p90 of 193ms — and its
 * median frame was 9.5ms, so it was fast whenever it was not blocked.
 *
 * Nothing is dropped. The bytes stay queued and land the moment the gesture
 * settles, and the cap below means a long scroll cannot freeze the view.
 */
export function writesHeldForScrollGesture(scope: TerminalDocumentScope) {
  if (!scope.scrollGestureActive) {
    return false
  }
  return nowMs() - scope.scrollGestureStartedAt <= SCROLL_WRITE_HOLD_MAX_MS
}

export function scheduleHeldWritePump(scope: TerminalDocumentScope, gen: number) {
  if (scope.heldWritePumpTimer !== null) {
    return
  }
  const remaining = SCROLL_WRITE_HOLD_MAX_MS - (nowMs() - scope.scrollGestureStartedAt)
  scope.heldWritePumpTimer = setTimeout(
    function () {
      scope.heldWritePumpTimer = null
      pumpWrites(scope, gen)
    },
    remaining > 0 ? remaining + 1 : 1
  )
}

export function cancelHeldWritePump(scope: TerminalDocumentScope) {
  if (scope.heldWritePumpTimer === null) {
    return
  }
  clearTimeout(scope.heldWritePumpTimer)
  scope.heldWritePumpTimer = null
}

export function beginScrollGestureWriteHold(scope: TerminalDocumentScope) {
  if (scope.scrollGestureActive) {
    return
  }
  scope.scrollGestureActive = true
  scope.scrollGestureStartedAt = nowMs()
}

export function endScrollGestureWriteHold(scope: TerminalDocumentScope) {
  if (!scope.scrollGestureActive) {
    return
  }
  scope.scrollGestureActive = false
  cancelHeldWritePump(scope)
  pumpWrites(scope, scope.terminalGeneration)
}

export function pumpWrites(scope: TerminalDocumentScope, gen: number): void {
  if (!scope.ready || !scope.term || scope.writesDraining || gen !== scope.terminalGeneration) {
    return
  }
  if (writesHeldForScrollGesture(scope)) {
    // Why: the hold can also end by simply timing out, and a terminal with
    // nothing more to say would then never pump again — the queued bytes
    // (a resize's re-serialised buffer, for one) would sit there and the
    // view would stay blank. Wake it when the cap expires.
    scheduleHeldWritePump(scope, gen)
    return
  }
  const next = nextQueuedWrite(scope)
  if (typeof next !== 'string') {
    if (typeof next === 'function') {
      return (next(), pumpWrites(scope, gen))
    }
    const callbacks = scope.afterDrainCallbacks
    scope.afterDrainCallbacks = []
    for (let i = 0; i < callbacks.length; i++) {
      callbacks[i]()
    }
    return
  }
  scope.writesDraining = true
  // Why: xterm.write() parses asynchronously. Row adjustment/resizing must
  // wait until replayed SGR attributes have landed in the buffer.
  scope.term.write(next, function () {
    if (gen !== scope.terminalGeneration) {
      return
    }
    scope.writesDraining = false
    pumpWrites(scope, gen)
  })
}

export function afterWritesDrained(scope: TerminalDocumentScope, callback: () => void) {
  scope.afterDrainCallbacks.push(callback)
  pumpWrites(scope, scope.terminalGeneration)
}

/** Ruling 21: the held pump's wake timer, which would otherwise pump the next mount's queue. */
export function stopWriteQueue(scope: TerminalDocumentScope) {
  cancelHeldWritePump(scope)
}
