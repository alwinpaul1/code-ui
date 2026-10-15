import { useEffect, useState } from 'react'

/**
 * How long an accepted answer waits for the hook row to let go of the question
 * before the card says it is still waiting. After the last key is acknowledged,
 * the agent's PostToolUse hook goes to the desktop and the status comes back
 * over the relay: one relayed leg (a ~250 ms floor, measured behind the VPN on
 * 2026-09-11) plus the agent's own handling, well under a second on a healthy
 * link. Codex's request_user_input lets go the same way (its PostToolUse). 3 s is
 * several times that, so a normal hand-off never shows the line, and it is
 * still short of a network change, where the relay takes 5–8 s to migrate and
 * re-handshake (docs/network-measurements-2026-09-06.md) and the wait is
 * genuinely unexplained to the phone. Saying so then is the truth.
 */
export const ASK_SENT_WAIT_MS = 3_000

/** The caption an answered card shows once it has waited ASK_SENT_WAIT_MS. */
export const ASK_SENT_WAITING_LINE = 'Sent — waiting for the agent to take it'

// The answer whose wait was last logged: a card remounted past the wait (a
// chat↔terminal toggle) must not log the same answer again.
let waitLoggedFor: number | null = null

/** True once `sentAt` is ASK_SENT_WAIT_MS old. Logs one line per answer when it
 *  turns, so one the agent never took leaves a trace saying where it stopped. */
export function useSentWaitElapsed(sentAt: number | null): boolean {
  const [elapsedFor, setElapsedFor] = useState<number | null>(null)
  useEffect(() => {
    if (sentAt === null) {
      return
    }
    const remaining = ASK_SENT_WAIT_MS - (Date.now() - sentAt)
    const turn = (): void => {
      if (waitLoggedFor !== sentAt) {
        waitLoggedFor = sentAt
        console.warn(
          `[ask] answer accepted ${Date.now() - sentAt} ms ago; the hook row still shows the question pending, so the card waits (no resend offered)`
        )
      }
      setElapsedFor(sentAt)
    }
    if (remaining <= 0) {
      turn()
      return
    }
    const timer = setTimeout(turn, remaining)
    return () => clearTimeout(timer)
  }, [sentAt])
  return sentAt !== null && elapsedFor === sentAt
}
