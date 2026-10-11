import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the agent may still read as working after a Stop went out before
 *  the button comes back. Claude Code and Codex end the turn on the first
 *  Escape within a second; the phone's working flag follows the screen and the
 *  beacon, which can trail that by a few seconds more. */
export const STOP_STILL_WORKING_MS = 10_000

/** The Claude app says "Couldn't stop the session. Try again." (1.261009.20).
 *  This one names what the phone saw, which is the part a user can act on. */
export const STOP_STILL_WORKING_MESSAGE = 'The agent is still working after Stop. Try again.'

/**
 * The composer's Stop button, as the Claude app runs it (parity gap G24): a tap
 * marks it stopping (a ring; repeat taps are swallowed, the button is never
 * disabled) until the turn ends; a stop that did not go, or an agent still
 * working {@link STOP_STILL_WORKING_MS} after it went, clears the mark.
 *
 * `stop`'s verdict is false when the lane already reported a failure (the terminal
 * lane's "Stop not sent"), so the button comes back without a second message.
 * A lane that answers nothing (the structured cancel) counts as sent at the tap.
 * The 10 s starts when the verdict comes; on the terminal lane that is when both
 * Escapes have settled, inside the send budget.
 */
export function useChatStopButton(args: {
  /** Calls `onVerdict` once its keys have settled when `reportsVerdict`. */
  stop: (onVerdict: (sent: boolean) => void) => void
  /** False for a lane that reports nothing (the structured cancel): its stop
   *  counts as sent at the tap. */
  reportsVerdict: boolean
  canStop: boolean
  /** The chat the button belongs to; a stop never carries over to another. */
  scope: string
  onSendError: (message: string) => void
}): { onStop: () => void; stopping: boolean } {
  const { stop, reportsVerdict, canStop, scope, onSendError } = args
  const [stopping, setStopping] = useState(false)
  const stoppingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped whenever a stop stands down, so a verdict that lands later is dropped. */
  const attemptRef = useRef(0)
  const latest = useRef({ canStop, onSendError })
  latest.current = { canStop, onSendError }

  const standDown = useCallback(() => {
    attemptRef.current += 1
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    stoppingRef.current = false
    setStopping(false)
  }, [])

  // The turn ended (the stop worked, or it ended by itself), or the user moved
  // to another chat: the button starts fresh either way.
  useEffect(() => {
    if (!canStop) {
      standDown()
    }
  }, [canStop, standDown])
  useEffect(() => standDown, [scope, standDown])

  const onStop = useCallback(() => {
    if (stoppingRef.current) {
      return
    }
    stoppingRef.current = true
    setStopping(true)
    const attempt = ++attemptRef.current
    const watch = (): void => {
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (attemptRef.current !== attempt || !latest.current.canStop) {
          return
        }
        standDown()
        latest.current.onSendError(STOP_STILL_WORKING_MESSAGE)
      }, STOP_STILL_WORKING_MS)
    }
    const onVerdict = (sent: boolean): void => {
      if (attemptRef.current !== attempt) {
        return
      }
      if (sent) {
        watch()
      } else {
        standDown()
      }
    }
    try {
      stop(onVerdict)
    } catch {
      standDown()
      return
    }
    if (!reportsVerdict) {
      watch()
    }
  }, [reportsVerdict, standDown, stop])

  return { onStop, stopping }
}
