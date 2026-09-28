import { useEffect, useMemo, useRef, useState } from 'react'
import { nativeChatAskDismissKey, type AskPrompt } from '../../../src/shared/native-chat-ask'

/** How a card left: taken down at once (a Cancel the host accepted), or
 *  answered, which keeps it up as sent until the hook row lets go of it. */
export type AskDismissOutcome = 'dismissed' | 'answered'

/** `sentAt` is when an answer from this phone was accepted, while the card
 *  still shows it as sent; null is a plain dismissal (the card is hidden). */
type AskDismissal = { sessionKey: string | null; askKey: string; sentAt: number | null }
type DetectedAsk = { sessionKey: string | null; askKey: string | null }

/** Track the answered-ask key so the lingering live status doesn't re-show the
 *  same card. The agent emits a post-tool event with the same prompt right after
 *  an answer, so the card is hidden until a genuinely different question arrives.
 *
 *  An ANSWER is not hidden at once, though. The host accepting the keystrokes
 *  says they were written, not that the agent took them, and a card that
 *  vanished on the write left a lost answer with nothing on screen: no card,
 *  and no "waits in the terminal" notice either, since the prompt was still
 *  detected. So an answered card stays up as sent (a Sent status, no Submit) while
 *  the hook row still shows the question pending, and becomes a plain
 *  dismissal the moment it stops. With no hook row carrying the question (a
 *  stale row, the transcript's copy the only source) there is nothing to wait
 *  on, and the card goes at once, as a dismissal always did.
 *
 *  Owned by the controller, not the chat subtree: the overlay unmounts on a
 *  chat↔terminal view toggle, and a dismissal must survive that round-trip. */
export function useMobileNativeChatAskDismiss(args: {
  ask: AskPrompt | null
  /** Ungated prompt payload. A working/done status hides the card but does not
   *  prove the sticky prompt itself cleared. Required, and never defaulted to
   *  `ask`: reading the gated prompt as the detected one is the resurfacing bug
   *  this hook exists to close. */
  detectedAsk: AskPrompt | null
  /** The question the hook row shows as pending (`liveAsk` from
   *  useMobileNativeChatPrompts). Required, and never the transcript's copy:
   *  that one lingers until its result row, which would hold an answer the
   *  agent already took on screen as unanswered. */
  liveAsk: AskPrompt | null
  /** Tab scope retains dismissals across tab switches. */
  scopeKey: string | null
  /** Provider-session identity distinguishes restarts without growing the tab map. */
  sessionKey: string | null
  /** True while the chat surface can actually observe the prompt. A null ask it
   *  cannot see — off-chat, or before a re-subscribed transcript lands — proves
   *  nothing and must not reset the dismissal; that reset resurfaced the card. */
  observing: boolean
}): {
  askKey: string | null
  showAsk: boolean
  /** When this phone's answer to the shown card was accepted, while the card
   *  shows it as sent; null otherwise. */
  askSentAt: number | null
  dismissAsk: (outcome?: AskDismissOutcome) => void
} {
  const { ask, detectedAsk, liveAsk, scopeKey, sessionKey, observing } = args
  const askKey = useMemo(() => nativeChatAskDismissKey(ask), [ask])
  const detectedAskKey = useMemo(() => nativeChatAskDismissKey(detectedAsk), [detectedAsk])
  const liveAskKey = useMemo(() => nativeChatAskDismissKey(liveAsk), [liveAsk])
  const detectedByScopeRef = useRef(new Map<string | null, DetectedAsk>())
  const [dismissedByScope, setDismissedByScope] = useState<Map<string | null, AskDismissal>>(
    () => new Map()
  )
  useEffect(() => {
    if (observing) {
      detectedByScopeRef.current.set(scopeKey, { sessionKey, askKey: detectedAskKey })
    }
  }, [observing, detectedAskKey, scopeKey, sessionKey])
  // A cleared or genuinely different detected prompt retires the old dismissal.
  useEffect(() => {
    if (observing) {
      setDismissedByScope((previous) => {
        const dismissed = previous.get(scopeKey)
        if (
          dismissed === undefined ||
          (dismissed.sessionKey === sessionKey && dismissed.askKey === detectedAskKey)
        ) {
          return previous
        }
        const next = new Map(previous)
        next.delete(scopeKey)
        return next
      })
    }
  }, [observing, detectedAskKey, scopeKey, sessionKey])
  // The hook row let go of an answered question: the agent took it. From here
  // it is a plain dismissal, so the same question drawn again (a flapping row,
  // an identical re-ask) stays hidden exactly as an answered card always did.
  useEffect(() => {
    if (observing) {
      setDismissedByScope((previous) => {
        const dismissed = previous.get(scopeKey)
        if (
          dismissed === undefined ||
          dismissed.sentAt === null ||
          dismissed.sessionKey !== sessionKey ||
          dismissed.askKey === liveAskKey
        ) {
          return previous
        }
        return new Map(previous).set(scopeKey, { ...dismissed, sentAt: null })
      })
    }
  }, [observing, liveAskKey, scopeKey, sessionKey])
  const dismissed = dismissedByScope.get(scopeKey)
  const matches =
    askKey !== null && dismissed?.sessionKey === sessionKey && dismissed.askKey === askKey
  // Read in render as well as in the effect above, so the card never draws one
  // frame as sent after the row that took the answer.
  const askSentAt = matches && dismissed.sentAt !== null && liveAskKey === askKey ? dismissed.sentAt : null
  const showAsk = askKey !== null && (!matches || askSentAt !== null)
  const dismissAsk = (outcome: AskDismissOutcome = 'dismissed'): void => {
    const detected = detectedByScopeRef.current.get(scopeKey)
    if (askKey !== null && detected?.sessionKey === sessionKey && detected.askKey === askKey) {
      setDismissedByScope((previous) => {
        const current = previous.get(scopeKey)
        const same = current?.sessionKey === sessionKey && current.askKey === askKey
        // An answer never re-opens a dismissal, nor restarts its own clock.
        if (same && (outcome === 'answered' || current.sentAt === null)) {
          return previous
        }
        return new Map(previous).set(scopeKey, {
          sessionKey,
          askKey,
          sentAt: outcome === 'answered' ? Date.now() : null
        })
      })
    }
  }

  return { askKey, showAsk, askSentAt, dismissAsk }
}
