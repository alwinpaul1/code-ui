import { useCallback, useEffect, useRef, useState } from 'react'
import { STOP_FAILED_MESSAGE } from './native-chat-stop-words'

/** How long the agent may still read as working after a Stop went out before
 *  the button comes back. Claude Code and Codex end the turn on the first
 *  Escape within a second; the phone's working flag follows the screen and the
 *  beacon, which can trail that by a few seconds more. */
export const STOP_STILL_WORKING_MS = 10_000

/**
 * The composer's Stop button, as the Claude app runs it (parity gap G24): a tap
 * marks it stopping (a ring; repeat taps are swallowed, the button is never
 * disabled) until the turn ends; a stop that did not go, or an agent still
 * working {@link STOP_STILL_WORKING_MS} after it went, clears the mark.
 *
 * `stop`'s verdict is false when the lane already reported a failure (the terminal
 * lane's "Couldn't stop the session"), so the button comes back without a second message.
 * A lane that answers nothing counts as sent at the tap, unless it hands back a promise
 * (the structured cancel's): one that settles false has already said why, so the button comes
 * back at once, and no 10 s message follows the one the lane gave.
 * The 10 s starts when the verdict comes; on the terminal lane that is when both
 * Escapes have settled, inside the send budget.
 */
export function useChatStopButton(args: {
  /** Calls `onVerdict` once its keys have settled when `reportsVerdict`. A lane with no
   *  verdict callback may return whether its stop was accepted instead. */
  stop: (onVerdict: (sent: boolean) => void) => void | Promise<boolean>
  /** False for a lane that reports nothing through `onVerdict` (the structured cancel): its
   *  stop counts as sent at the tap, until a returned promise says false. */
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
        // The Claude app's words (native-chat-stop-words.ts); what the phone saw goes to the log.
        console.warn(`[stop] the agent was still working ${STOP_STILL_WORKING_MS / 1000} s after Stop went out`)
        latest.current.onSendError(STOP_FAILED_MESSAGE)
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
    let answer: void | Promise<boolean>
    try {
      answer = stop(onVerdict)
    } catch {
      standDown()
      return
    }
    if (!reportsVerdict) {
      watch()
      // A promise that settles true changes nothing (the watch is armed); one that rejects is
      // left to the watch, which says so if the turn is still running.
      if (answer) {
        answer.then(
          (sent) => {
            if (!sent) {
              onVerdict(false)
            }
          },
          () => undefined
        )
      }
    }
  }, [reportsVerdict, standDown, stop])

  return { onStop, stopping }
}
