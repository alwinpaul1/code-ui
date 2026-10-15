import type { AgentDotState } from '../worktree/agent-row-display'
import type { CcrSessionRow } from './ccr-session-row'

/**
 * Which of the Claude app's session filters a Claude session falls under, read the way the app
 * reads it (com.anthropic.claude 1.261013.20, jadx):
 *
 *  - the filters (`a8v`): All, Working (`IN_PROGRESS`), Needs input (`BLOCKED`), Ready for review
 *    (`REVIEW_READY`), Completed (`DONE`), Archived; their words are `session_filter_*`
 *    (so30.r, strings.xml);
 *  - a session's filter (`q730.z`): archived → Archived; `status` `requires_action` → Needs input;
 *    working (`q730.t`) → Working; otherwise the post-turn summary's `status_category`
 *    (`e0y`, mapped by `t1v`): no category or `unknown` → Needs input when the summary names a
 *    `needs_action`, else Completed; `waiting` → Working unless the session is `pending` (then as
 *    no category); `blocked`, `need_input`, `failed` → Needs input; `review_ready` → Ready for
 *    review; `completed` → Completed;
 *  - working (`q730.t`): not `pending`, and the worker running (`rp20.PROCESSING`), or `status`
 *    `running`, or a `task_summary` present (`lx30.n`), and `updated_at` less than an hour ago
 *    (`gnv.a`, one hour).
 *
 * The app's list also has Archived. Code UI leaves that filter out: Orca's own "Show archived"
 * already filters the workspace list, and archiving a session on Anthropic is an unproven write
 * (`CCR_SESSION_WRITES`, ccr-session-writes.ts).
 */

export type ClaudeSessionState = 'working' | 'needs-input' | 'ready-for-review' | 'completed' | 'archived'

export type ClaudeSessionFilter = 'all' | Exclude<ClaudeSessionState, 'archived'>

/** `gnv.a`: a session not updated for this long is no longer Working. */
export const CLAUDE_SESSION_WORKING_WINDOW_MS = 60 * 60 * 1000

/** The app's `session_list_filter_empty`, word for word. */
export const CLAUDE_SESSION_FILTER_EMPTY = 'No sessions match this filter'

const LABELS: Record<ClaudeSessionState, string> = {
  working: 'Working',
  'needs-input': 'Needs input',
  'ready-for-review': 'Ready for review',
  completed: 'Completed',
  archived: 'Archived'
}

export const CLAUDE_SESSION_FILTERS: readonly { value: ClaudeSessionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'working', label: LABELS.working },
  { value: 'needs-input', label: LABELS['needs-input'] },
  { value: 'ready-for-review', label: LABELS['ready-for-review'] },
  { value: 'completed', label: LABELS.completed }
]

export function claudeSessionStateLabel(state: ClaudeSessionState): string {
  return LABELS[state]
}

type StateRow = Pick<CcrSessionRow, 'status' | 'workerStatus' | 'summaryCategory' | 'needsAction' | 'hasTaskSummary' | 'updatedAt'>

function lower(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

/** `q730.t`: the session counts as working now. */
function workingNow(row: StateRow, now: number): boolean {
  const status = lower(row.status)
  if (status === 'pending') {
    return false
  }
  const running = lower(row.workerStatus) === 'running' || status === 'running' || row.hasTaskSummary === true
  const updatedAt = row.updatedAt ?? 0
  return running && updatedAt > 0 && now - updatedAt < CLAUDE_SESSION_WORKING_WINDOW_MS
}

/** `q730.z` over a session row. */
export function ccrSessionStateOfRow(row: StateRow, now: number): ClaudeSessionState {
  const status = lower(row.status)
  if (status === 'archived') {
    return 'archived'
  }
  if (status === 'requires_action') {
    return 'needs-input'
  }
  const namesAction = typeof row.needsAction === 'string' && row.needsAction.trim() !== ''
  if (workingNow(row, now)) {
    return 'working'
  }
  const noCategory: ClaudeSessionState = namesAction ? 'needs-input' : 'completed'
  switch (lower(row.summaryCategory)) {
    case 'waiting':
      return status !== 'pending' ? 'working' : noCategory
    case 'blocked':
    case 'need_input':
    case 'failed':
      return 'needs-input'
    case 'review_ready':
      return 'ready-for-review'
    case 'completed':
      return 'completed'
    default:
      // `unknown`, absent, or a category this build does not know.
      return noCategory
  }
}

/** A Claude agent row's state from Orca (the desktop's agent status) when no fresh session row is
 *  held: the same filters, from the dot the row already draws. */
export function orcaClaudeSessionState(dot: AgentDotState): ClaudeSessionState {
  switch (dot) {
    case 'working':
    case 'monitoring':
      return 'working'
    case 'waiting':
    case 'blocked':
    case 'failed':
      return 'needs-input'
    case 'done':
    case 'interrupted':
    case 'unconfirmed':
    case 'idle':
      return 'completed'
    default: {
      const unhandled: never = dot
      return unhandled
    }
  }
}
