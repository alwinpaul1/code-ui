import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readClaudeContextReport, type ContextReportRead } from './claude-context-report'
import { clearHeldContextReportsForTests, useHeldContextReport } from './use-held-context-report'
import { clearStickyLiveHudForTests } from './use-sticky-live-hud'

// The held table of a session (Claude Code 2.1.300's `/context`, fixtures/claude-context-2.1.300/).
// `/context` prints once, so it is on the screen only until something scrolls it off; the sheet reads it
// minutes later.
const table = (name: string) => {
  const report = readClaudeContextReport(
    readFileSync(join(import.meta.dirname, 'fixtures/claude-context-2.1.300', name), 'utf8').split('\n')
  )
  if (!report) {
    throw new Error(`${name} did not parse`)
  }
  return report
}
const FIRST = table('context-130-cols.txt')
const SECOND = table('context-110-cols-memory-files.txt')
const seen = (report = FIRST, firstRead = false): ContextReportRead => ({ report, firstRead })

beforeEach(() => {
  clearHeldContextReportsForTests()
  // The scope key's own memory of the last terminal and session each tab had.
  clearStickyLiveHudForTests()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 14, 21, 30))
})
afterEach(() => vi.useRealTimers())

describe('the /context table a session was seen with', () => {
  it('is kept after the screen no longer shows it', () => {
    expect(useHeldContextReport(seen(), 'tab-1', 'term_a', 'session-1')?.report).toBe(FIRST)
    // The next reads find the table scrolled away.
    expect(useHeldContextReport(null, 'tab-1', 'term_a', 'session-1')?.report).toBe(FIRST)
  })

  it('is stamped with when the phone saw it painted', () => {
    expect(useHeldContextReport(seen(), 'tab-1', 'term_a', 'session-1')?.readAt).toBe(new Date(2026, 9, 14, 21, 30).getTime())
    vi.setSystemTime(new Date(2026, 9, 14, 21, 45))
    // The same table on the next poll is not a newer one.
    expect(useHeldContextReport(seen(), 'tab-1', 'term_a', 'session-1')?.readAt).toBe(new Date(2026, 9, 14, 21, 30).getTime())
  })

  it('has no age when it was already on the screen as the phone began to look', () => {
    expect(useHeldContextReport(seen(FIRST, true), 'tab-1', 'term_a', 'session-1')?.readAt).toBeNull()
  })

  it('is replaced, with a new stamp, by a table that differs', () => {
    useHeldContextReport(seen(FIRST), 'tab-1', 'term_a', 'session-1')
    vi.setSystemTime(new Date(2026, 9, 14, 22, 0))
    const held = useHeldContextReport(seen(SECOND), 'tab-1', 'term_a', 'session-1')
    expect(held?.report).toBe(SECOND)
    expect(held?.readAt).toBe(new Date(2026, 9, 14, 22, 0).getTime())
  })

  it('belongs to its session: a /clear, which starts another, starts with none', () => {
    useHeldContextReport(seen(), 'tab-1', 'term_a', 'session-1')
    expect(useHeldContextReport(null, 'tab-1', 'term_a', 'session-2')).toBeNull()
    // And the first session's table is still its own when it comes back.
    expect(useHeldContextReport(null, 'tab-1', 'term_a', 'session-1')?.report).toBe(FIRST)
  })

  it('belongs to its terminal and its tab', () => {
    useHeldContextReport(seen(), 'tab-1', 'term_a', 'session-1')
    expect(useHeldContextReport(null, 'tab-1', 'term_b', 'session-1')).toBeNull()
    expect(useHeldContextReport(null, 'tab-2', 'term_a', 'session-1')).toBeNull()
  })

  it('survives a moment when the session id or the terminal is not known: null is "not yet", not "another"', () => {
    useHeldContextReport(seen(), 'tab-1', 'term_a', 'session-1')
    expect(useHeldContextReport(null, 'tab-1', 'term_a', null)?.report).toBe(FIRST)
    expect(useHeldContextReport(null, 'tab-1', null, 'session-1')?.report).toBe(FIRST)
  })

  it('is none for a session never seen with one, and for no tab at all', () => {
    expect(useHeldContextReport(null, 'tab-1', 'term_a', 'session-1')).toBeNull()
    expect(useHeldContextReport(null, null, null, null)).toBeNull()
  })
})
