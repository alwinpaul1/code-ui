import { describe, expect, it } from 'vitest'
import { parseCcrSessionRow } from './ccr-session-row'
import {
  CLAUDE_SESSION_FILTERS,
  CLAUDE_SESSION_FILTER_EMPTY,
  CLAUDE_SESSION_WORKING_WINDOW_MS,
  ccrSessionStateOfRow,
  claudeSessionStateLabel,
  orcaClaudeSessionState
} from './claude-session-state'

// The Claude Android app 1.261013.20 files each Code session under one of its list filters with
// q730.z(session, clock): archived → Archived; status requires_action → Needs input; working (q730.t)
// → Working; then the post-turn summary's status_category (t1v maps the enum). These rows are the
// list's own JSON (SessionV2, xnv.java), parsed by the phone's row reader.
const NOW = Date.parse('2026-10-15T12:00:00Z')
const row = (fields: Record<string, unknown>) => {
  const parsed = parseCcrSessionRow({ id: 'cse_01QXaaaaaaaaaaaaaaaaaaaa', created_at: '2026-10-15T10:00:00Z', ...fields })
  if (!parsed) {
    throw new Error('fixture row did not parse')
  }
  return parsed
}
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

describe('a Claude session row, filed the way the Claude app files it', () => {
  it('reads an archived session as Archived whatever else it says', () => {
    expect(ccrSessionStateOfRow(row({ status: 'archived', worker_status: 'running', updated_at: minutesAgo(1) }), NOW)).toBe('archived')
  })

  it('reads a session waiting on a permission prompt as Needs input', () => {
    expect(ccrSessionStateOfRow(row({ status: 'requires_action', updated_at: minutesAgo(1) }), NOW)).toBe('needs-input')
  })

  it('reads a session whose worker runs as Working', () => {
    expect(ccrSessionStateOfRow(row({ status: 'idle', worker_status: 'running', updated_at: minutesAgo(5) }), NOW)).toBe('working')
  })

  it('reads a running session as Working, and one with a task summary too', () => {
    expect(ccrSessionStateOfRow(row({ status: 'running', updated_at: minutesAgo(5) }), NOW)).toBe('working')
    expect(ccrSessionStateOfRow(row({ status: 'idle', task_summary: { title: 'x' }, updated_at: minutesAgo(5) }), NOW)).toBe('working')
  })

  it('stops calling a session Working once it has not changed for an hour (gnv.a)', () => {
    const stale = row({ status: 'running', updated_at: new Date(NOW - CLAUDE_SESSION_WORKING_WINDOW_MS).toISOString() })
    expect(ccrSessionStateOfRow(stale, NOW)).toBe('completed')
  })

  it('never calls a pending session Working', () => {
    expect(ccrSessionStateOfRow(row({ status: 'pending', worker_status: 'running', updated_at: minutesAgo(1) }), NOW)).toBe('completed')
  })

  it('files the post-turn summary category the way t1v maps it', () => {
    const at = (category: string, extra: Record<string, unknown> = {}) =>
      ccrSessionStateOfRow(row({ status: 'idle', updated_at: minutesAgo(5), post_turn_summary: { status_category: category, ...extra } }), NOW)
    expect(at('review_ready')).toBe('ready-for-review')
    expect(at('completed')).toBe('completed')
    expect(at('blocked')).toBe('needs-input')
    expect(at('need_input')).toBe('needs-input')
    expect(at('failed')).toBe('needs-input')
    // WAITING: Working unless the session is pending, and then the summary's needs_action decides.
    expect(at('waiting')).toBe('working')
  })

  it('reads a pending session that is waiting by whether the summary names an action', () => {
    const waiting = (needs: string | null) =>
      ccrSessionStateOfRow(row({ status: 'pending', updated_at: minutesAgo(5), post_turn_summary: { status_category: 'waiting', needs_action: needs } }), NOW)
    expect(waiting('Approve the migration')).toBe('needs-input')
    expect(waiting('   ')).toBe('completed')
    expect(waiting(null)).toBe('completed')
  })

  it('reads a session with no summary as Completed, or Needs input when an action is named', () => {
    expect(ccrSessionStateOfRow(row({ status: 'idle', updated_at: minutesAgo(5) }), NOW)).toBe('completed')
    expect(ccrSessionStateOfRow(row({ status: 'idle', updated_at: minutesAgo(5), post_turn_summary: { status_category: 'unknown', needs_action: 'Pick a branch' } }), NOW)).toBe('needs-input')
  })

  it('reads a summary category it does not know as no category, not as a guess', () => {
    expect(ccrSessionStateOfRow(row({ status: 'idle', updated_at: minutesAgo(5), post_turn_summary: { status_category: 'celebrating' } }), NOW)).toBe('completed')
  })

  it('reads a bare row (no status, no times) as Completed rather than throwing', () => {
    const bare = parseCcrSessionRow({ id: 'cse_01QXbbbbbbbbbbbbbbbbbbbb' })
    expect(bare).not.toBeNull()
    expect(ccrSessionStateOfRow(bare!, NOW)).toBe('completed')
  })
})

describe('the session row fields the list reads', () => {
  it('keeps unread, worker_status, the summary and the update time from the row', () => {
    const parsed = row({ unread: true, worker_status: 'running', updated_at: minutesAgo(2), post_turn_summary: { status_category: 'review_ready', needs_action: 'Review the PR' }, task_summary: { a: 1 } })
    expect(parsed).toMatchObject({ unread: true, workerStatus: 'running', summaryCategory: 'review_ready', needsAction: 'Review the PR', hasTaskSummary: true, updatedAt: NOW - 2 * 60_000 })
  })

  it('reads unread as unknown when the row does not say, never as read', () => {
    expect(row({}).unread).toBeNull()
    expect(row({ unread: 'yes' }).unread).toBeNull()
    expect(row({ unread: false }).unread).toBe(false)
  })
})

describe('an Orca agent row, filed under the same filters when there is no fresh session row', () => {
  it('maps the desktop agent states onto the app filters', () => {
    expect(orcaClaudeSessionState('working')).toBe('working')
    expect(orcaClaudeSessionState('monitoring')).toBe('working')
    expect(orcaClaudeSessionState('waiting')).toBe('needs-input')
    expect(orcaClaudeSessionState('blocked')).toBe('needs-input')
    expect(orcaClaudeSessionState('failed')).toBe('needs-input')
    expect(orcaClaudeSessionState('done')).toBe('completed')
    expect(orcaClaudeSessionState('interrupted')).toBe('completed')
    expect(orcaClaudeSessionState('unconfirmed')).toBe('completed')
    expect(orcaClaudeSessionState('idle')).toBe('completed')
  })
})

describe('the filter words', () => {
  it('are the app session_filter_* strings in its order, without Archived', () => {
    // Archived is left out: Orca's own Show archived already filters the list, and archiving a
    // session on Anthropic is an unproven write (CCR_SESSION_WRITES).
    expect(CLAUDE_SESSION_FILTERS.map((filter) => filter.label)).toEqual(['All', 'Working', 'Needs input', 'Ready for review', 'Completed'])
    expect(claudeSessionStateLabel('ready-for-review')).toBe('Ready for review')
    expect(claudeSessionStateLabel('archived')).toBe('Archived')
    expect(CLAUDE_SESSION_FILTER_EMPTY).toBe('No sessions match this filter')
  })
})
