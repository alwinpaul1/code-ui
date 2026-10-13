import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EFFORT_PICK_READ_BACK_MS,
  forgetEffortPick,
  getEffortPick,
  judgeEffortPick,
  noteEffortPick
} from './native-chat-effort-pick'
import type { PickFailureReport } from './session-option-pick-failure'

/** An effort pick waiting for the agent to state it (native-chat-effort-pick.ts). */
export type PendingEffortPick = { value: string; queued: boolean }

const NO_QUEUE: readonly string[] = []

/**
 * Follows the active tab's effort pick until the agent confirms it or it is
 * given up. While it waits the screen is read once a second, the first time at
 * once, so a status line that has already repainted is seen without waiting for
 * the HUD's own poll. A pick made on another tab is judged when that tab is
 * active again: its window is wall-clock, so coming back late gives it up there.
 */
export function useNativeChatEffortPick(args: {
  scopeKey: string | null
  reportedEffort: string | null
  queuedMessages?: readonly string[]
  /** A fresh read of the screen (the HUD's refresh). */
  readBack?: () => unknown
  /** The pick was given up while the agent states `reported`. */
  onGivenUp: (scopeKey: string, reported: string | null) => void
}): {
  pending: PendingEffortPick | null
  note: (scopeKey: string, value: string, report?: PickFailureReport) => void
} {
  const { scopeKey, reportedEffort, readBack, onGivenUp } = args
  const queuedMessages = args.queuedMessages ?? NO_QUEUE
  const [pending, setPending] = useState<PendingEffortPick | null>(null)
  const [tick, setTick] = useState(0)
  const readBackRef = useRef(readBack)
  readBackRef.current = readBack
  const onGivenUpRef = useRef(onGivenUp)
  onGivenUpRef.current = onGivenUp
  const queuedKey = queuedMessages.join('\n')

  useEffect(() => {
    const pick = scopeKey ? getEffortPick(scopeKey) : null
    if (!scopeKey || !pick) {
      setPending(null)
      return
    }
    const verdict = judgeEffortPick(pick, { reportedEffort, queuedMessages, now: Date.now() })
    if (verdict.kind === 'confirmed') {
      forgetEffortPick(scopeKey)
      setPending(null)
      return
    }
    if (verdict.kind === 'given-up') {
      // Forgotten before it is said, so no later look can say it again.
      forgetEffortPick(scopeKey)
      setPending(null)
      onGivenUpRef.current(scopeKey, verdict.reported)
      // The line left behind if nobody saw the message: what was asked, what the
      // agent stated, and that the write itself had been acked (it was noted).
      console.warn('[effort-pick] given up', { value: verdict.value, reported: verdict.reported })
      pick.report?.(verdict.message)
      return
    }
    setPending((current) =>
      current?.value === verdict.value && current.queued === verdict.queued
        ? current
        : { value: verdict.value, queued: verdict.queued }
    )
    const judgeAgain = setTimeout(() => setTick((value) => value + 1), verdict.remainingMs)
    const look = setInterval(() => void readBackRef.current?.(), EFFORT_PICK_READ_BACK_MS)
    return () => {
      clearTimeout(judgeAgain)
      clearInterval(look)
    }
    // `queuedKey` stands for `queuedMessages`, whose array is new on every read.
  }, [scopeKey, reportedEffort, queuedKey, tick])

  const note = useCallback((pickScope: string, value: string, report?: PickFailureReport) => {
    noteEffortPick(pickScope, {
      value,
      at: Date.now(),
      ...(report ? { report } : {})
    })
    void readBackRef.current?.()
    setTick((current) => current + 1)
  }, [])

  return { pending, note }
}
