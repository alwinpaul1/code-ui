import type { CcrSessionRow } from './ccr-session-api'
import { claudeTranscriptModelName, type ModelPillPair } from './claude-transcript-model'

/**
 * The model and effort Claude Code itself last reported for a tab's session
 * to Anthropic (`external_metadata.model` and `.effort_level`, see
 * ccr-session-api.ts), as the composer pill's pair.
 *
 * The session's own word, used where the terminal states nothing (no beacon,
 * no badge, no recorded /model): a hand-started tab, a Windows host. Never a guess: an id this phone cannot name as a
 * Claude model, or a reading older than CCR_MODEL_FRESH_MS or from before the
 * relay last connected, is not used, and the pill keeps today's sources.
 */

export const CCR_MODEL_FRESH_MS = 90_000
export const CCR_MODEL_REFRESH_MS = 60_000

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export type CcrModelReading = {
  sessionId: string
  epoch: number | null
  model: string
  effort: string | null
  fetchedAt: number
}

export type CcrModelRead = { model: string; effort: string | null } | { skip: 'no-model' | 'unknown-model' }

/** A row's reported pair, or why it has none the pill may use. */
export function ccrModelOfRow(row: Pick<CcrSessionRow, 'model' | 'effortLevel'>): CcrModelRead {
  const model = row.model?.trim()
  if (!model) {
    return { skip: 'no-model' }
  }
  const name = claudeTranscriptModelName(model)
  // A family this phone names (Opus, Sonnet, …); a bare `claude-…` it cannot
  // name is left to today's sources.
  if (!name || name === model) {
    return { skip: 'unknown-model' }
  }
  const effort = row.effortLevel?.trim().toLowerCase() ?? null
  return { model, effort: effort && EFFORTS.has(effort) ? effort : null }
}

const readings = new Map<string, CcrModelReading>()
const listeners = new Set<() => void>()
let version = 0

export function recordCcrModel(tabId: string, reading: CcrModelReading): void {
  readings.set(tabId, reading)
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

export function forgetCcrModel(tabId: string): void {
  if (readings.delete(tabId)) {
    version += 1
    for (const listener of listeners) {
      listener()
    }
  }
}

export function subscribeCcrModel(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function ccrModelVersion(): number {
  return version
}

/** The tab's reading when it is fresh and from this connection. */
export function ccrModelForTab(tabId: string, epoch: number | null, now = Date.now()): CcrModelReading | null {
  const reading = readings.get(tabId)
  if (!reading || reading.epoch !== epoch || now - reading.fetchedAt > CCR_MODEL_FRESH_MS) {
    return null
  }
  return reading
}

export function resetCcrModelForTests(): void {
  readings.clear()
  version += 1
}

/**
 * The pill's pair: the API's only where nothing live states one, else
 * `today` unchanged. A beacon heard at all, the badge, or a `/model` command
 * the transcript recorded (all in `today.model`) is the session speaking
 * through the terminal, and it wins: the API row's age is the phone's read,
 * not when Claude Code wrote it, so a row fetched after a switch can still
 * name the old model (review of 2026-10-14). The reading still outranks the
 * transcript scan's fallback, which `claudeModelPillPair` applies after this.
 * The pair travels whole: the API's model never takes another source's effort.
 */
export function preferCcrModelPair<T extends ModelPillPair>(today: T, reading: CcrModelReading | null, beaconAt: number | null): T {
  if (!reading || beaconAt !== null || today.model) {
    return today
  }
  // Named as the Claude app names it ("Opus 5.5"): with no label the pill drew the raw id.
  return { ...today, model: reading.model, label: claudeTranscriptModelName(reading.model), effort: reading.effort }
}
