import AsyncStorage from '@react-native-async-storage/async-storage'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'

const SESSION_OPTION_RECORD_PREFIX = 'orca:sessionOptions:'

function sessionOptionRecordKey(scopeKey: string): string {
  return `${SESSION_OPTION_RECORD_PREFIX}${encodeURIComponent(scopeKey)}`
}

function isRecord(value: unknown): value is NativeChatSessionOptionRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<NativeChatSessionOptionRecord>
  return (
    typeof candidate.agent === 'string' &&
    candidate.valuesByModel !== null &&
    typeof candidate.valuesByModel === 'object'
  )
}

/**
 * The model / effort / fast-mode picks made in Chat UI, per host+worktree+tab.
 *
 * Why persist: the agent's hook reports the model back, but nothing ever reports
 * effort or a toggle, so those live only in the phone's memory. Android reclaims
 * that memory freely while the user is in another worktree or app, and the
 * pickers then reopened showing the catalog default even though the agent was
 * still running with the picked values.
 */
export async function readSessionOptionRecord(
  scopeKey: string
): Promise<NativeChatSessionOptionRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionOptionRecordKey(scopeKey))
    if (raw === null) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
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
  const barrier = write.catch(() => undefined)
  writeBarriers.set(scopeKey, barrier)
  void barrier.then(() => {
    if (writeBarriers.get(scopeKey) === barrier) {
      writeBarriers.delete(scopeKey)
    }
  })
  return write
}

/**
 * Fold a stored record into the live one. The hook report usually lands before
 * the disk read resolves and has already created a record holding only the
 * reported model, so the stored one cannot simply replace it. The report stays
 * authoritative for the model; the user's own option picks (effort, toggles) are
 * carried over per model unless a newer pick already exists in memory.
 * Returns true when the live record changed.
 */
export function mergeStoredSessionOptionRecord(
  live: NativeChatSessionOptionRecord,
  stored: NativeChatSessionOptionRecord
): boolean {
  let changed = false
  for (const [modelId, values] of Object.entries(stored.valuesByModel)) {
    const target = (live.valuesByModel[modelId] ??= {})
    for (const [optionId, tracked] of Object.entries(values)) {
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
