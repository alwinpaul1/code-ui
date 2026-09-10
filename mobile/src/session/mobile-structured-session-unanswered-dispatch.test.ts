// The shared projection's own test file is vendored but never collected here —
// this fork's vitest root is `mobile/`. Orca #19822's working-state half is
// pinned where the gate runs it.

import { describe, expect, it } from 'vitest'
import type { AgentJournalSubmission } from '../../../src/shared/agent-session-journal-types'
import { hasUnansweredStructuredAgentSessionDispatch } from '../../../src/shared/structured-agent-session-projection'

function submission(overrides: Partial<AgentJournalSubmission> = {}): AgentJournalSubmission {
  return {
    clientMessageId: 'msg-1',
    fence: 3,
    payloadFingerprint: 'fp',
    dispatchState: 'pending',
    providerItemId: null,
    reason: null,
    submittedAt: 1_000,
    resolvedAt: null,
    ...overrides
  }
}

describe('a send the host journalled that the provider has not answered', () => {
  it('counts while the dispatch is still pending', () => {
    expect(hasUnansweredStructuredAgentSessionDispatch([submission()], 3)).toBe(true)
  })

  it('still counts once the ack budget has elapsed', () => {
    // `unknown` answers delivery, not whether work is owed — a third of Claude
    // sends time out on the ack and the turn arrives anyway.
    expect(
      hasUnansweredStructuredAgentSessionDispatch([submission({ dispatchState: 'unknown' })], 3)
    ).toBe(true)
  })

  it('stops counting once the provider accepts or refuses it', () => {
    expect(
      hasUnansweredStructuredAgentSessionDispatch([submission({ dispatchState: 'accepted' })], 3)
    ).toBe(false)
    expect(
      hasUnansweredStructuredAgentSessionDispatch([submission({ dispatchState: 'rejected' })], 3)
    ).toBe(false)
  })

  it('does not count one that crash reconciliation resolved', () => {
    // A recovered `unknown` outlived the host generation that sent it, so there
    // is nothing still running to report.
    expect(
      hasUnansweredStructuredAgentSessionDispatch(
        [submission({ dispatchState: 'unknown', recovered: true })],
        3
      )
    ).toBe(false)
  })

  it('reads the recovery off an older host that omits the marker', () => {
    expect(
      hasUnansweredStructuredAgentSessionDispatch(
        [
          submission({
            dispatchState: 'unknown',
            reason: 'host_restarted_before_acknowledgement'
          })
        ],
        3
      )
    ).toBe(false)
  })

  it('ignores a send from a fence the session has moved past', () => {
    expect(hasUnansweredStructuredAgentSessionDispatch([submission({ fence: 2 })], 3)).toBe(false)
    expect(hasUnansweredStructuredAgentSessionDispatch([submission({ fence: 4 })], 3)).toBe(true)
  })

  it('counts every send when the caller knows no fence', () => {
    expect(hasUnansweredStructuredAgentSessionDispatch([submission({ fence: 1 })], null)).toBe(true)
    expect(hasUnansweredStructuredAgentSessionDispatch([submission({ fence: 1 })])).toBe(true)
  })
})
