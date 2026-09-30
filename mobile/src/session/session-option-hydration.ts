import { forgetModelReportScope } from './mobile-native-chat-model-report-authority'
import {
  mergeStoredSessionOptionRecord,
  readSessionOptionRecord,
  writeSessionOptionRecord,
  type StoredSessionOptionRead
} from '../storage/session-option-records'
import type { SessionOptionValue } from '../../../src/shared/native-chat-session-options'
import {
  applyNativeChatReportedSessionOptions,
  createNativeChatSessionOptionRecord,
  type NativeChatSessionOptionRecord
} from '../../../src/shared/native-chat-session-option-state'

// Why: per-tab records survive chat↔terminal flips and remounts, like desktop's
// scope cache. Bounded so long sessions across many tabs can't grow unbounded.
const MOBILE_SESSION_OPTION_RECORD_CAP = 32
const recordsByScope = new Map<string, NativeChatSessionOptionRecord>()

/**
 * Where a tab's stored picks stand this process. Effort and toggles are never
 * reported back by the agent, so a record lost with the process comes back
 * only from disk, and one save of the live record before that read lands is
 * enough to lose it on disk as well. That is what happened on every Claude and
 * Codex tab: the live record existed before the restore ran, the restore
 * skipped any tab that had one, and the agent's first model report saved a
 * record holding only that model over every stored pick (review, 2026-09-30).
 *
 * - `reading`: the read is out. Saves wait (`owed`) and land once, merged.
 * - `settled`: the stored picks are folded in, or there were none. Saves go.
 * - `refused`: the store would not answer. Nothing is saved this run until a
 *   later mount reads again; picks made meanwhile still work in memory.
 * - no entry: never read. A save waits, like `reading`, for the read to come.
 */
type ScopeRead = {
  status: 'reading' | 'settled' | 'refused'
  owed: boolean
  /** Stored picks folded into a record that had no model yet, for the
   *  agent's first report to fold in again (see `applyAgentModelReport`). */
  parked?: { record: NativeChatSessionOptionRecord; stored: NativeChatSessionOptionRecord }
}
const scopeReads = new Map<string, ScopeRead>()
/** Scopes with a save that waited for a read no one has started yet. */
const owedBeforeRead = new Set<string>()
/** The mounted pickers of each scope, repainted when its restore lands. */
const repaints = new Map<string, Set<() => void>>()

export function getScopedRecord(scopeKey: string, agent: string): NativeChatSessionOptionRecord {
  const existing = recordsByScope.get(scopeKey)
  const record =
    existing && existing.agent === agent ? existing : createNativeChatSessionOptionRecord(agent)
  if (record !== existing) {
    // The agent under this tab changed: nothing the OLD one said about itself
    // is evidence about this one. Leaving any of it latched left the fresh
    // record with no model at all (2026-09-15).
    forgetModelReportScope(scopeKey)
  }
  // Why: delete-then-set on every read makes the touched scope most-recent, so
  // eviction only sheds the oldest UNTOUCHED tab. Insertion order alone would let
  // a long-lived active tab be the oldest key and lose its tracked model.
  recordsByScope.delete(scopeKey)
  recordsByScope.set(scopeKey, record)
  while (recordsByScope.size > MOBILE_SESSION_OPTION_RECORD_CAP) {
    const oldest = recordsByScope.keys().next().value
    if (oldest === undefined) {
      break
    }
    recordsByScope.delete(oldest)
    forgetModelReportScope(oldest)
    // The record is gone from memory, so the tab must read its disk again when
    // it comes back. Left `settled`, its fresh record was saved over the picks.
    if (scopeReads.get(oldest)?.status === 'settled') {
      scopeReads.delete(oldest)
    }
  }
  return record
}

/** Save the scope's live record now if its stored picks have been read, or
 *  once they have. Never over a read the store refused. */
export function persistSessionOptionScope(scopeKey: string): void {
  const read = scopeReads.get(scopeKey)
  if (!read) {
    owedBeforeRead.add(scopeKey)
    return
  }
  if (read.status !== 'settled') {
    read.owed = true
    return
  }
  const record = recordsByScope.get(scopeKey)
  if (record) {
    // A refused save leaves its own line (refused-write-log.ts).
    void writeSessionOptionRecord(scopeKey, record).catch(() => undefined)
  }
}

/**
 * Read the scope's stored picks once per process and fold them into its live
 * record, which the pickers have usually made already. `repaint` is called
 * when the restore changed the record or a save waited for it; the caller's
 * repaint saves again through `persistSessionOptionScope`. Returns the
 * unsubscribe.
 */
export function hydrateSessionOptionScope(scopeKey: string, agent: string, repaint: () => void): () => void {
  const listeners = repaints.get(scopeKey) ?? new Set<() => void>()
  repaints.set(scopeKey, listeners)
  listeners.add(repaint)
  const previous = scopeReads.get(scopeKey)
  if (!previous || previous.status === 'refused') {
    const read: ScopeRead = { status: 'reading', owed: (previous?.owed ?? false) || owedBeforeRead.has(scopeKey) }
    owedBeforeRead.delete(scopeKey)
    scopeReads.set(scopeKey, read)
    void readSessionOptionRecord(scopeKey)
      .then((outcome) => settleRead(scopeKey, agent, read, outcome))
      // Nobody awaits this promise: a throw here was an unhandled rejection
      // with no line behind it. Held like a refusal, since what is on disk
      // is unknown.
      .catch((error: unknown) => settleRead(scopeKey, agent, read, { status: 'refused', error }))
  }
  return () => {
    listeners.delete(repaint)
    if (listeners.size === 0 && repaints.get(scopeKey) === listeners) {
      repaints.delete(scopeKey)
    }
  }
}

function settleRead(scopeKey: string, agent: string, read: ScopeRead, outcome: StoredSessionOptionRead): void {
  if (scopeReads.get(scopeKey) !== read) {
    return
  }
  if (outcome.status === 'refused') {
    read.status = 'refused'
    const why = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    console.warn(
      `[session-options] picks for ${JSON.stringify(scopeKey)} not restored: the store refused the read (${why}); ` +
        'picks made now are kept in memory and not saved until a read succeeds'
    )
    return
  }
  const changed = outcome.status === 'record' && foldStoredRecord(scopeKey, agent, read, outcome.record)
  read.status = 'settled'
  if (!changed && !read.owed) {
    return
  }
  const owed = read.owed
  read.owed = false
  const listeners = [...(repaints.get(scopeKey) ?? [])]
  for (const listener of listeners) {
    listener()
  }
  if (listeners.length === 0 && owed) {
    persistSessionOptionScope(scopeKey)
  }
}

/** Fold the stored record in, if it is the tab's agent's. */
function foldStoredRecord(
  scopeKey: string,
  agent: string,
  read: ScopeRead,
  stored: NativeChatSessionOptionRecord
): boolean {
  const live = recordsByScope.get(scopeKey)
  // A record another agent left under this tab says nothing about this one.
  // The tab's agent is its live record's, which can have changed while the
  // read was out; checked against the agent the read began under, the new
  // one's own picks were skipped and then saved over.
  if (stored.agent !== (live?.agent ?? agent)) {
    return false
  }
  const record = live ?? getScopedRecord(scopeKey, agent)
  const changed = mergeStoredSessionOptionRecord(record, stored)
  if (changed && record.model === undefined) {
    read.parked = { record, stored }
  }
  return changed
}

/**
 * The agent's model report, applied without losing the picks restored ahead
 * of it. `applyNativeChatReportedSessionOptions` (vendored) fills the reported
 * model with the picks carried from the previous one when the model changes,
 * and from no model at all that is nothing: the stored effort the restore had
 * just put under Opus became `{}`, and the next save wrote that to disk. On a
 * cold start the disk answers in milliseconds and the agent only once the
 * relay is up, so this was the usual order. The merge only fills what the
 * report left empty, so the report's own values still win. Once, and only on
 * a report: a model the user picks resets that model's picks on purpose.
 */
export function applyAgentModelReport(
  scopeKey: string,
  record: NativeChatSessionOptionRecord,
  values: Record<string, SessionOptionValue>
): boolean {
  const read = scopeReads.get(scopeKey)
  const refold = read?.parked?.record === record && record.model === undefined ? read.parked.stored : null
  let changed = applyNativeChatReportedSessionOptions(record, values)
  if (read && record.model !== undefined) {
    delete read.parked
  }
  if (refold && mergeStoredSessionOptionRecord(record, refold)) {
    changed = true
  }
  return changed
}

/** Test-only: the live records alone; what each scope's read found stays. */
export function clearSessionOptionScopeRecordsForTests(): void {
  recordsByScope.clear()
}

/** Test-only: the records and every read, as a fresh process has them. */
export function resetSessionOptionScopesForTests(): void {
  recordsByScope.clear()
  scopeReads.clear()
  owedBeforeRead.clear()
}
