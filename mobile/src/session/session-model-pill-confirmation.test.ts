import { beforeEach, describe, expect, it } from 'vitest'
import {
  forgetModelReportScope,
  hasSeenLiveModelReport,
  noteLiveModelReport
} from './mobile-native-chat-model-report-authority'
import { sessionModelPillLabel } from './session-model-pill'

const SCOPE = 'host-1:wt-1:tab-1'
const HANDLE = 'term-1'

/**
 * The pill states a fact: "this session is running X". The tracked record is
 * not that fact — it is a model somebody PICKED, which the agent may never have
 * honoured, and which outlives the session that picked it.
 *
 * Observed 2026-09-17 on a session whose transcript is 1479 turns of
 * claude-opus-5 and 234 of claude-opus-4-8, with no Fable anywhere: the pill
 * read "Fable" and the composer "Fable Medium". The same wording appears in
 * this module's own 2026-09-15 note — "seen earlier as 'Fable Medium' on an
 * Opus 5 session" — so that fix made a live reading outrank a stale one without
 * covering the case where there is NO live reading at all.
 *
 * That case is not rare: a hand-started `claude` has no HUD beacon, so nothing
 * ever states its model and the pill shows a leftover pick for ever. CLAUDE.md's
 * rule for this is to refuse rather than guess.
 */
describe('the model pill only states what the agent has confirmed', () => {
  beforeEach(() => {
    forgetModelReportScope(SCOPE)
  })

  it('shows nothing when the agent has never stated its model', () => {
    expect(hasSeenLiveModelReport(SCOPE, HANDLE)).toBe(false)
    expect(sessionModelPillLabel('Fable', SCOPE, HANDLE)).toBeNull()
  })

  it('shows the label once the agent has stated it', () => {
    noteLiveModelReport(SCOPE, HANDLE)
    expect(sessionModelPillLabel('Opus 5 (1M context)', SCOPE, HANDLE)).toBe('Opus 5 (1M context)')
  })

  // A scope outlives its terminal, so a new agent in the same tab must earn its
  // own confirmation rather than inherit the last one's.
  it('does not let a new terminal inherit the previous one confirmation', () => {
    noteLiveModelReport(SCOPE, HANDLE)
    expect(sessionModelPillLabel('Opus 5', SCOPE, 'term-2')).toBeNull()
  })

  // Degenerate: nothing to show, and no scope at all.
  it.each([
    ['no label', null, SCOPE, HANDLE],
    ['no scope', 'Opus 5', null, HANDLE]
  ])('shows nothing for %s', (_label, label, scope, handle) => {
    expect(sessionModelPillLabel(label, scope, handle)).toBeNull()
  })
})
