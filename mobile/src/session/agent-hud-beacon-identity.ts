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
 * Claude repaints its status line several times a second, and each repaint
 * used to publish a new object and wake every reader — one of which recounts
 * the background tasks over the whole transcript (2026-09-13). `receivedAt`
 * and the timestamps are left out on purpose: a repaint that repeats itself
 * is not a change.
 */
export function unchangedBeacon(a: AgentHudBeacon, b: AgentHudBeacon): boolean {
  return (
    a.agent === b.agent &&
    a.modelId === b.modelId &&
    a.modelLabel === b.modelLabel &&
    a.effort === b.effort &&
    a.usedTokens === b.usedTokens &&
    a.windowTokens === b.windowTokens &&
    a.usedPercent === b.usedPercent &&
    a.promptHook === b.promptHook &&
    a.runningTaskIdsAt === b.runningTaskIdsAt &&
    sameIds(a.runningTaskIds, b.runningTaskIds) &&
    sameIds(a.doneTaskIds, b.doneTaskIds) &&
    sameIds(a.launchedTaskIds, b.launchedTaskIds) &&
    a.desktopPrompts === b.desktopPrompts &&
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
