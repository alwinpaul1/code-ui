import AsyncStorage from '@react-native-async-storage/async-storage'
import { barrierAfterWrite } from './refused-write-log'
import type {
  NativeChatSessionOptionRecord,
  TrackedNativeChatSessionOption
} from '../../../src/shared/native-chat-session-option-state'

const SESSION_OPTION_RECORD_PREFIX = 'orca:sessionOptions:'

function sessionOptionRecordKey(scopeKey: string): string {
  return `${SESSION_OPTION_RECORD_PREFIX}${encodeURIComponent(scopeKey)}`
}

const TRACKED_SOURCES: ReadonlySet<string> = new Set<TrackedNativeChatSessionOption['source']>([
  'applied',
  'dispatched',
  'reported',
  'default'
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One stored pick: a value a picker can show and a source it knows. */
function isTracked(value: unknown): value is TrackedNativeChatSessionOption {
  return (
    isPlainObject(value) &&
    (typeof value.value === 'string' || typeof value.value === 'boolean') &&
    typeof value.source === 'string' &&
    TRACKED_SOURCES.has(value.source)
  )
}

/** A model's stored picks, every entry that is not a tracked pick left out:
 *  a record cut short, an older build's shape, a hand edit. One bad entry
 *  costs that entry, not the record. */
function trackedValues(values: unknown): Record<string, TrackedNativeChatSessionOption> {
  const kept: Record<string, TrackedNativeChatSessionOption> = {}
  if (!isPlainObject(values)) {
    return kept
  }
  for (const [optionId, tracked] of Object.entries(values)) {
    if (isTracked(tracked)) {
      kept[optionId] = tracked
    }
  }
  return kept
}

/** What storage holds is checked, not trusted. Null when the record itself is
 *  unusable (no agent, no per-model map); otherwise the good picks, with a
 *  model left out when none of its picks is good, so nothing downstream meets
 *  a bad entry. */
function storedRecord(value: unknown): NativeChatSessionOptionRecord | null {
  if (!isPlainObject(value) || typeof value.agent !== 'string' || !isPlainObject(value.valuesByModel)) {
    return null
  }
  const valuesByModel: NativeChatSessionOptionRecord['valuesByModel'] = {}
  for (const [modelId, values] of Object.entries(value.valuesByModel)) {
    const kept = trackedValues(values)
    if (Object.keys(kept).length > 0) {
      valuesByModel[modelId] = kept
    }
  }
  return {
    agent: value.agent as NativeChatSessionOptionRecord['agent'],
    ...(isTracked(value.model) ? { model: value.model } : {}),
    valuesByModel
  }
}

/** What a read of a tab's stored picks found. `none` covers a record that
 *  is there but unusable: saving over it loses nothing a picker could show.
 *  `refused` is the store itself failing, and only that: the picks may well
 *  be on disk, so nothing may be saved over them on the strength of this read. */
export type StoredSessionOptionRead =
  | { status: 'none' }
  | { status: 'record'; record: NativeChatSessionOptionRecord }
  | { status: 'refused'; error: unknown }

/** The stored text as a record, or why it is not one. */
function parseStoredRecord(raw: string): NativeChatSessionOptionRecord | string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error: unknown) {
    return `the stored record does not parse (${error instanceof Error ? error.message : String(error)})`
  }
  return storedRecord(parsed) ?? 'the stored record has no agent or no per-model map'
}

/**
 * The model / effort / fast-mode picks made in Chat UI, per host+worktree+tab.
 *
 * Why persist: the agent's hook reports the model back, but nothing ever reports
 * effort or a toggle, so those live only in the phone's memory. Android reclaims
 * that memory freely while the user is in another worktree or app, and the
 * pickers then reopened showing the catalog default even though the agent was
 * still running with the picked values.
 *
 * A refused read used to come back as null, the same answer as "nothing
 * stored", so the hook took the tab as restored and saved its live record,
 * which held only the reported model, over every pick on disk.
 */
export async function readSessionOptionRecord(scopeKey: string): Promise<StoredSessionOptionRead> {
  // A chat can come back while its last pick is still being written; a read
  // that beat the write restored the pick before it. The barrier never
  // rejects, so a failed write in front of it cannot fail this read. With
  // no write in flight the read starts at once, in the caller's own tick,
  // as it always did.
  const writing = writeBarriers.get(scopeKey)
  if (writing) {
    await writing
  }
  let raw: string | null
  try {
    raw = await AsyncStorage.getItem(sessionOptionRecordKey(scopeKey))
  } catch (error: unknown) {
    return { status: 'refused', error }
  }
  if (raw === null) {
    return { status: 'none' }
  }
  const record = parseStoredRecord(raw)
  if (typeof record === 'string') {
    console.warn(`[session-options] picks for ${JSON.stringify(scopeKey)} not restored: ${record}`)
    return { status: 'none' }
  }
  return { status: 'record', record }
}

const writeBarriers = new Map<string, Promise<void>>()

/** Serialized per scope so a slow older write cannot land over a newer pick. */
export function writeSessionOptionRecord(
  scopeKey: string,
  record: NativeChatSessionOptionRecord
): Promise<void> {
  const key = sessionOptionRecordKey(scopeKey)
  const payload = JSON.stringify(record)
  const write = (writeBarriers.get(scopeKey) ?? Promise.resolve()).then(() =>
    AsyncStorage.setItem(key, payload)
  )
  const barrier = barrierAfterWrite(write, 'session options', 'save')
  writeBarriers.set(scopeKey, barrier)
  void barrier.then(() => {
    if (writeBarriers.get(scopeKey) === barrier) {
      writeBarriers.delete(scopeKey)
    }
  })
  return write
}

/**
 * Fold a stored record into the live one. The live record exists before the
 * disk read resolves (the pickers' snapshot makes it during render) and may
 * already hold the reported model or a pick made meanwhile, so the stored one
 * cannot simply replace it. The report stays authoritative for the model; the
 * user's own option picks (effort, toggles) are carried over per model unless a
 * newer pick already exists in memory. Returns true when the live record changed.
 *
 * `stored` came off disk. `readSessionOptionRecord` checks it, and this checks
 * each entry again for any caller that did not: a null model entry or a null
 * pick is skipped, where it used to throw out of the restore and lose every
 * pick in the record.
 */
export function mergeStoredSessionOptionRecord(
  live: NativeChatSessionOptionRecord,
  stored: NativeChatSessionOptionRecord
): boolean {
  let changed = false
  const models: [string, unknown][] = isPlainObject(stored.valuesByModel) ? Object.entries(stored.valuesByModel) : []
  for (const [modelId, values] of models) {
    const picks = Object.entries(trackedValues(values))
    if (picks.length === 0) {
      continue
    }
    const target = (live.valuesByModel[modelId] ??= {})
    for (const [optionId, tracked] of picks) {
      if (tracked.source !== 'reported' && target[optionId] === undefined) {
        target[optionId] = { ...tracked }
        changed = true
      }
    }
  }
  // The stored MODEL is deliberately not restored.
  //
  // The per-model option values above are: effort and toggles are never
  // reported back by the agent, so a record lost with the process is lost for
  // good unless it is read back from disk. The model is the opposite — the
  // agent states it on every repaint, on its own beacon and on the badge — so
  // remembering it buys at most a second and costs a wrong answer for as long
  // as it takes a live reading to arrive.
  //
  // It cost exactly that on 2026-09-15: the pill read "Fable Medium" on a
  // session whose own status line said `[Opus 5 xhigh | Max 20x]`. The live
  // host reported no model at all, so this disk record was the only place the
  // name could have come from — a pick from some earlier session, restored on a
  // cold start and drawn as though it were current, with nothing to mark it as
  // a memory. Same shape as the launch record dropped in the same pass: a
  // remembered value shown as a live one.
  return changed
}
