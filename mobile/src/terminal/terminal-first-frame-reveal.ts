import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * When a terminal pane may first be seen.
 *
 * Opening a tab used to show three screens in a row: the empty body, then the
 * WebView's own blank background once it mounted, then the host's frame
 * (0.9.132, 2026-10-13: "Opens in desktop and flashes and changes to mobile").
 * And when the host's first frame came at the desktop's size, the phone drew
 * that too before the fit pass re-subscribed for a phone-size one.
 *
 * So a pane stays covered until the first frame it can keep is in it, and is
 * then shown for good: the cover never comes back for a later re-subscribe,
 * so live typing and scrolling are never hidden. Every way a first frame can
 * fail to come shows the pane instead of keeping it covered: the fit cannot
 * be measured, the re-subscribe is turned away, the host keeps answering at
 * another size, the stream ends, or nothing arrives within the timeout.
 */

/** Longest a pane stays covered after it became the active tab or its subscribe armed. The recording's
 *  open took ~600 ms from mount to frame over the relay; this is a backstop
 *  for a host that never answers, not the expected wait. */
export const TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS = 2500

export type TerminalFirstFrameRevealReason =
  | 'converged'
  | 'held'
  | 'exhausted'
  | 'measure-failed'
  | 'resubscribe-refused'
  | 'fit-retrying'
  | 'desktop-mode'
  | 'resized'
  | 'stream-ended'
  | 'engine-error'
  | 'timeout'

/** Reveals once the pane has DRAWN its frame: init() is posted, not painted,
 *  and lifting the cover in the same tick showed the blank WebView for as long
 *  as the document's first init took. awaitReady carries its own timeout, so
 *  this always resolves; a rejection still reveals. */
export function revealTerminalAfterPaint(
  pane: { awaitReady: () => Promise<unknown> } | undefined,
  handle: string,
  reason: TerminalFirstFrameRevealReason,
  reveal: (handle: string, reason: TerminalFirstFrameRevealReason) => void
): void {
  void Promise.resolve(pane?.awaitReady())
    .catch(() => undefined)
    .then(() => reveal(handle, reason))
}

export function useTerminalFirstFrameReveal(activeHandle: string | null = null) {
  const [revealedTerminalHandles, setRevealedTerminalHandles] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const revealedRef = useRef<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const revealTerminalFirstFrame = useCallback(
    (handle: string, reason: TerminalFirstFrameRevealReason) => {
      const timer = timersRef.current.get(handle)
      if (timer) {
        clearTimeout(timer)
        timersRef.current.delete(handle)
      }
      if (revealedRef.current.has(handle)) {
        return
      }
      revealedRef.current.add(handle)
      setRevealedTerminalHandles(new Set(revealedRef.current))
      // One line per pane, so a cover that lasted names why it lifted.
      console.log('[fit][session] first frame shown', { handle: handle.slice(-8), reason })
    },
    []
  )

  const armTerminalFirstFrameRevealTimeout = useCallback(
    (handle: string) => {
      if (revealedRef.current.has(handle) || timersRef.current.has(handle)) {
        return
      }
      timersRef.current.set(
        handle,
        setTimeout(() => {
          timersRef.current.delete(handle)
          revealTerminalFirstFrame(handle, 'timeout')
        }, TERMINAL_FIRST_FRAME_REVEAL_TIMEOUT_MS)
      )
    },
    [revealTerminalFirstFrame]
  )

  // Why: a subscribe turned away by its gates (the WebView never came up, the
  // relay is down) arms nothing, and the WebView's own error and Reload sit
  // under the cover; the tab on screen is never covered past the timeout.
  useEffect(() => {
    if (activeHandle) {
      armTerminalFirstFrameRevealTimeout(activeHandle)
    }
  }, [activeHandle, armTerminalFirstFrameRevealTimeout])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  return {
    revealedTerminalHandles,
    revealTerminalFirstFrame,
    armTerminalFirstFrameRevealTimeout
  }
}
