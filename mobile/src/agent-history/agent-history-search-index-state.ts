import type { AgentSessionSearchStatus } from './agent-history-search-reply-schema'

/**
 * What the host's search index is doing, as the search panel draws it.
 *
 * The rules mirror the desktop's own status row (session-history-status-copy.ts on Orca
 * origin/main, 2026-09-25), so the phone and the desktop never disagree about the same index:
 *
 * - off: indexing is not enabled on that computer. Only its owner can turn it on, in Orca's
 *   Settings; stock Orca keeps `aiVault.setSearchEnabled` off the mobile allowlist.
 * - building: enabled and a pass is still reading files (`indexing`, or `degraded` with files
 *   still due), so the counts move between reads.
 * - paused: enabled, but the service is `idle` or `closed`, which the desktop words as "not
 *   available on this computer right now".
 * - ready: anything else, including a phase this build does not know. A settled reading is the
 *   one that stops the poll, so an unknown phase must not read as "still building" forever.
 */

export type SearchIndexProgress = {
  sessionsIndexed: number
  /** What the pass knows about so far, so it is a fraction and never a percentage. */
  sessionsTotal: number
  /** Absent on a host older than the field; the line then reads in sessions only. */
  messagesIndexed: number | null
}

export type SearchIndexState =
  | { kind: 'checking' }
  | { kind: 'off' }
  | { kind: 'building'; progress: SearchIndexProgress; notes: string[] }
  | { kind: 'paused'; notes: string[] }
  | { kind: 'ready'; progress: SearchIndexProgress; notes: string[] }
  | { kind: 'unsupported' }
  | { kind: 'unreadable'; message: string }

export type SearchIndexKind = SearchIndexState['kind']

export function searchIndexStateFromStatus(status: AgentSessionSearchStatus): SearchIndexState {
  if (!status.enabled) {
    return { kind: 'off' }
  }
  const notes = searchIndexNotes(status)
  if (status.phase === 'idle' || status.phase === 'closed') {
    return { kind: 'paused', notes }
  }
  const progress: SearchIndexProgress = {
    sessionsIndexed: status.filesIndexed,
    sessionsTotal: status.filesIndexed + status.filesDue + status.filesFailed,
    messagesIndexed: status.messagesIndexed ?? null
  }
  const sweeping =
    status.phase === 'indexing' || (status.phase === 'degraded' && status.filesDue > 0)
  return sweeping ? { kind: 'building', progress, notes } : { kind: 'ready', progress, notes }
}

/**
 * Whether the panel keeps asking. Off, building and paused are the states the user is waiting
 * out (turning search on at the desktop, a first pass finishing), so the phone has to notice the
 * change itself: Orca pushes no event for it. Ready and the failures stop the poll.
 */
export function searchIndexNeedsPolling(state: SearchIndexState): boolean {
  switch (state.kind) {
    case 'off':
    case 'building':
    case 'paused':
      return true
    case 'checking':
    case 'ready':
    case 'unsupported':
    case 'unreadable':
      return false
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

/** The line under a building or ready index: how much of the history is searchable yet. */
export function searchIndexProgressLine(
  progress: SearchIndexProgress,
  kind: 'building' | 'ready'
): string {
  const sessions =
    kind === 'building'
      ? `${progress.sessionsIndexed} of ${countNoun(progress.sessionsTotal, 'session', 'sessions')}`
      : countNoun(progress.sessionsIndexed, 'session', 'sessions')
  if (progress.messagesIndexed === null) {
    return `${sessions} searchable`
  }
  return `${sessions} · ${countNoun(progress.messagesIndexed, 'message', 'messages')} searchable`
}

/**
 * The index's own account of what it could not read. The desktop shows the two counts; the reasons
 * are added as the host words them, because a host that knows why (Orca #20971's
 * "OpenCode-in-WSL is not searchable from Windows yet") says it better than the phone could guess.
 * Over the relay every reason is currently redacted to one fixed sentence, which is shown once.
 */
function searchIndexNotes(status: AgentSessionSearchStatus): string[] {
  const notes: string[] = []
  if (status.phase === 'degraded' && status.filesFailed > 0) {
    notes.push(
      `${countNoun(status.filesFailed, 'session', 'sessions')} could not be read and will be retried.`
    )
  }
  if (status.degradedRoots.length > 0) {
    notes.push(
      `${countNoun(status.degradedRoots.length, 'session folder', 'session folders')} could not be checked.`
    )
    for (const reason of new Set(status.degradedRoots.map((root) => root.reason.trim()))) {
      if (reason) {
        notes.push(reason)
      }
    }
  }
  return notes
}

// String(n), never toLocaleString: the browser locale is not the app's (see the messaging
// timestamps fixed in 2026-08), and a count needs no grouping to be read.
export function countNoun(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`
}
