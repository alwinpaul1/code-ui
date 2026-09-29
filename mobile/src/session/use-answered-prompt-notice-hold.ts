import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * Which screen reads the waiting notice may believe once the phone has
 * answered a prompt card.
 *
 * Not the read from before the answer: the dialog on it is the one answered,
 * and it raised "A menu is open in the terminal" the moment the card left
 * (2026-09-29, "the screen flashes"). Nor a read taken while the answered card
 * is still up: on a fast link the phone's look right after the answer reaches
 * the host before the agent has repainted, and sees the dialog too. The card
 * leaves when the agent says it took the answer (its hook row, or the
 * transcript's tool result), and by then its screen has moved on. So the
 * notice holds from the accepted answer until that card leaves, the screen is
 * read again then, and only a read begun after that speaks
 * (`dialogBeforeAnswer`, use-mobile-terminal-hud-observation.ts).
 */
export function useAnsweredPromptNoticeHold(args: {
  /** Whatever card stands for the prompt now: terminalPromptWait's `card`. */
  card: unknown
  /** The screen poll's own flag: its dialog reading predates its last re-read. */
  dialogBeforeAnswer: boolean
  rereadAfterAnswer: () => void
}): {
  /** For terminalPromptWait: the screen's dialog may not raise the notice. */
  dialogBeforeAnswer: boolean
  /** The host accepted the phone's answer to the card now up. */
  answered: () => void
} {
  const { card, dialogBeforeAnswer, rereadAfterAnswer } = args
  const cardUp = card != null
  const cardUpRef = useRef(cardUp)
  const [holding, setHolding] = useState(false)
  // Layout, not passive: the render the card left in has already held the
  // notice back, and the flag this re-read raises must replace the hold
  // before that frame is painted.
  useLayoutEffect(() => {
    cardUpRef.current = cardUp
    if (holding && !cardUp) {
      setHolding(false)
      rereadAfterAnswer()
    }
  }, [cardUp, holding, rereadAfterAnswer])
  const answered = useCallback(() => {
    if (cardUpRef.current) {
      setHolding(true)
    } else {
      // The agent's report beat the host's ack: the card has already left.
      rereadAfterAnswer()
    }
  }, [rereadAfterAnswer])
  return { dialogBeforeAnswer: holding || dialogBeforeAnswer, answered }
}
