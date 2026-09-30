import type { AgentHudBeacon } from './agent-hud-beacon'

export function sameIds(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/**
 * Whether two readings of a tab say the same thing.
 *
 * Claude re-runs its status line on every streamed message and, on the
 * phone's launch flag, every 5 s besides; each run used to publish a new
 * object and wake every reader — one of which recounts
 * the background tasks over the whole transcript (2026-09-13). `receivedAt`
 * and the timestamps are left out on purpose: a repaint that repeats itself
 * is not a change.
 */
export function unchangedBeacon(a: AgentHudBeacon, b: AgentHudBeacon): boolean {
  return (
    a.agent === b.agent &&
    a.sessionId === b.sessionId &&
    a.modelId === b.modelId &&
    a.modelLabel === b.modelLabel &&
    a.effort === b.effort &&
    a.usedTokens === b.usedTokens &&
    a.windowTokens === b.windowTokens &&
    a.usedPercent === b.usedPercent &&
    a.promptHook === b.promptHook &&
    a.runningTaskIdsAt === b.runningTaskIdsAt &&
    sameIds(a.runningTaskIds, b.runningTaskIds) &&
    (a.stopRunningTaskIdsAt ?? null) === (b.stopRunningTaskIdsAt ?? null) &&
    sameIds(a.stopRunningTaskIds ?? null, b.stopRunningTaskIds ?? null) &&
    sameIds(a.doneTaskIds, b.doneTaskIds) &&
    sameIds(a.launchedTaskIds, b.launchedTaskIds) &&
    a.desktopPrompts === b.desktopPrompts &&
    a.agentMessagePrompts === b.agentMessagePrompts &&
    a.desktopPrompt?.nonce === b.desktopPrompt?.nonce &&
    JSON.stringify(a.limits ?? null) === JSON.stringify(b.limits ?? null)
  )
}

/** When to move the running-task timestamp: only once the list itself moves,
 *  never on a repaint that repeats the same ids. */
export function restamp(next: AgentHudBeacon, previous: AgentHudBeacon): number | null {
  if (sameIds(next.runningTaskIds, previous.runningTaskIds)) {
    return previous.runningTaskIdsAt ?? null
  }
  return next.runningTaskIds !== null ? next.runningTaskIdsAt : (previous.runningTaskIdsAt ?? null)
}

/** The Stop hook's own list from one beacon: ids, and when it arrived. */
export function stopList(run: string | undefined, receivedAt: number): Pick<AgentHudBeacon, 'stopRunningTaskIds' | 'stopRunningTaskIdsAt'> {
  return {
    stopRunningTaskIds: (run ?? '').split(',').filter((id) => /^[A-Za-z0-9_-]+$/.test(id)),
    stopRunningTaskIdsAt: receivedAt
  }
}

/** A beacon without `run=` keeps the last Stop's list and time; one with it
 *  replaces both, every time: a repeat of the same ids is still a new answer,
 *  and a launch after the old time is not judged by it. */
export function keepStopList(next: AgentHudBeacon, previous: AgentHudBeacon): Pick<AgentHudBeacon, 'stopRunningTaskIds' | 'stopRunningTaskIdsAt'> {
  return next.stopRunningTaskIds != null
    ? { stopRunningTaskIds: next.stopRunningTaskIds, stopRunningTaskIdsAt: next.stopRunningTaskIdsAt ?? null }
    : { stopRunningTaskIds: previous.stopRunningTaskIds ?? null, stopRunningTaskIdsAt: previous.stopRunningTaskIdsAt ?? null }
}
