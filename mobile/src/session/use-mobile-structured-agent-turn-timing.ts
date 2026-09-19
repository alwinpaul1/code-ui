import { useMemo, useRef, useState } from 'react'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import type { NativeChatSettledTurns } from '../../../src/shared/native-chat-turn-status'
import type { StructuredAgentHostClock } from '../../../src/shared/structured-agent-session-reducer'
import {
  selectStructuredAgentRunningTurnTiming,
  selectStructuredAgentSettledTurns
} from '../../../src/shared/structured-agent-session-turn-timing'
import {
  stepStructuredAgentTurnClock,
  type StructuredAgentTurnClockLatch
} from '../../../src/shared/structured-agent-turn-clock-anchor'

/** Host-recorded turn timing for the structured lane: settled durations straight
 *  off the journal, and a skew-free start for the live counter whose host-to-local
 *  conversion is latched once per turn. */
export function useMobileStructuredAgentTurnTiming(
  {
    items,
    submissions,
    hostClock
  }: {
    items: readonly AgentJournalRenderItem[]
    submissions: readonly AgentJournalSubmission[]
    hostClock?: StructuredAgentHostClock | null
  },
  turnId: string | null
): { settledTurns: NativeChatSettledTurns; workingStartedAt: number | null } {
  // Selected per batch, but handed on only when its content changed: the
  // turn-status memo downstream keys on this map, and a new map per token
  // batch re-rendered every visible settled user row (review, 2026-09-19).
  const selected = useMemo(
    () => selectStructuredAgentSettledTurns(items, submissions),
    [items, submissions]
  )
  const settledRef = useRef<NativeChatSettledTurns>(selected)
  if (!sameSettledTurns(settledRef.current, selected)) {
    settledRef.current = selected
  }
  const settledTurns = settledRef.current
  const [latch, setLatch] = useState<StructuredAgentTurnClockLatch | null>(null)
  const runningTiming = useMemo(
    () => (turnId === null ? null : selectStructuredAgentRunningTurnTiming(items, turnId)),
    [items, turnId]
  )
  // Stamp during render (React's derive-from-props pattern) so the first paint of
  // a new turn already counts from the right instant.
  const step = stepStructuredAgentTurnClock({
    timing: runningTiming,
    turnId,
    now: Date.now,
    hostClock,
    latch
  })
  if (step.latch !== latch) {
    setLatch(step.latch)
  }
  return { settledTurns, workingStartedAt: step.workingStartedAt }
}

function sameSettledTurns(a: NativeChatSettledTurns, b: NativeChatSettledTurns): boolean {
  if (a === b) {
    return true
  }
  if (a.size !== b.size) {
    return false
  }
  for (const [turn, settled] of a) {
    if (!b.has(turn)) {
      return false
    }
    const other = b.get(turn)
    if (settled === null || other === null || other === undefined) {
      if (settled !== other) {
        return false
      }
      continue
    }
    if (settled.startedAt !== other.startedAt || settled.workedSeconds !== other.workedSeconds) {
      return false
    }
  }
  return true
}
