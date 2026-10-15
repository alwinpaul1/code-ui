import type { CcrPipelineResult } from './ccr-session-shared'

/**
 * How each tab's last match against Anthropic ended, so a Claude tab that has no session there
 * can say why instead of showing nothing (the user, 2026-10-15: "never silently fall back to
 * Orca"). Recorded by the pipeline after every run (ccr-session-pipeline.ts), read by the chat
 * (use-claude-anthropic-transcript.ts).
 */

export type CcrMatchOutcome =
  | { kind: 'matched' }
  /** The run ended without a session; `detail` is the failing stage's own line. */
  | { kind: 'unmatched'; stage: string; detail: string }

const outcomes = new Map<string, { outcome: CcrMatchOutcome; epoch: number | null }>()
const listeners = new Set<() => void>()
let version = 0

export function recordCcrMatchOutcome(tabId: string, epoch: number | null, result: CcrPipelineResult): void {
  const failed = result.stages.findLast((stage) => !stage.ok)
  const outcome: CcrMatchOutcome = result.sessionId
    ? { kind: 'matched' }
    : { kind: 'unmatched', stage: failed?.stage ?? 'match', detail: failed?.detail ?? 'no Remote Control session holds this tab’s messages' }
  outcomes.set(tabId, { outcome, epoch })
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

/** The tab's last outcome on this relay connection, or null when none was recorded on it. */
export function ccrMatchOutcome(tabId: string, epoch: number | null): CcrMatchOutcome | null {
  const held = outcomes.get(tabId)
  return held && held.epoch === epoch ? held.outcome : null
}

export function subscribeCcrMatchOutcomes(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function ccrMatchOutcomesVersion(): number {
  return version
}

export function resetCcrMatchOutcomesForTests(): void {
  outcomes.clear()
  version += 1
}
