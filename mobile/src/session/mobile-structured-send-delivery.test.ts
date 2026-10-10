import { describe, expect, it } from 'vitest'
import type { AgentJournalDispatchState } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionSendResult } from '../../../src/shared/agent-session-wire'
import { mobileStructuredSendDelivery } from './mobile-structured-send-delivery'
import type { StructuredAgentSessionMutationCallResult } from './mobile-structured-agent-session-rpc'
import { structuredSendResultFixture } from './structured-agent-send-result.test-fixture'

function accepted(
  dispatchState: AgentJournalDispatchState,
  reason: string | null = null
): StructuredAgentSessionMutationCallResult<AgentSessionSendResult> {
  return { status: 'accepted', value: structuredSendResultFixture(dispatchState, reason) }
}

describe('mobileStructuredSendDelivery', () => {
  // Orca #26544: a rejected send keeps its typed sign-in fact beside the host's guidance, so the
  // banner can step aside once the transcript states the same failure.
  it('keeps the typed auth fact beside guidance until the transcript can explain it', () => {
    const result = structuredSendResultFixture('rejected', 'Sign in to Grok with `grok login`.')
    if (!('submission' in result)) {
      throw new Error('expected submission')
    }
    const fact = {
      kind: 'notSignedIn' as const,
      detail: { text: 'Key expired.', audience: 'person' as const }
    }
    result.submission.rejection = fact
    expect(mobileStructuredSendDelivery({ status: 'accepted', value: result })).toEqual({
      outcome: 'rejected',
      error: 'Sign in to Grok with `grok login`.',
      failure: fact
    })
    result.submission.rejection = { kind: 'providerRejected' }
    expect(mobileStructuredSendDelivery({ status: 'accepted', value: result })).toEqual({
      outcome: 'rejected',
      error: 'Sign in to Grok with `grok login`.'
    })
  })
  it('reports transport and host uncertainty on this send', () => {
    expect(mobileStructuredSendDelivery({ status: 'unknown' })).toEqual({
      outcome: 'unknown',
      error: null
    })
    expect(mobileStructuredSendDelivery(accepted('unknown'))).toEqual({
      outcome: 'unknown',
      error: null
    })
  })

  // `pending` is written and awaiting the provider's acknowledgement — not doubt.
  it.each(['accepted', 'pending'] as const)('reports a written %s send as accepted', (state) => {
    expect(mobileStructuredSendDelivery(accepted(state))).toEqual({
      outcome: 'accepted',
      error: null
    })
  })

  it('withholds internal provider write reasons', () => {
    // The marker names nothing a person can act on, so it must not reach the screen.
    expect(
      mobileStructuredSendDelivery(accepted('rejected', 'provider_write_failed: broken pipe'))
    ).toEqual({
      outcome: 'rejected',
      error: "Couldn't reach the agent. Your message was not sent — Retry to send it again."
    })
  })

  it('shows a provider content rejection verbatim', () => {
    expect(
      mobileStructuredSendDelivery(accepted('rejected', 'Claude does not support .bmp'))
    ).toEqual({ outcome: 'rejected', error: 'Claude does not support .bmp' })
  })

  // An expired id is now only ever this press's own: no earlier attempt's id is sent again, so the
  // refusal is reported like any other and the words go back to the composer.
  it.each([
    ['agent_session_operation_invalid', 'Invalid operation'],
    ['agent_session_checkpoint_stale', 'Fence moved'],
    ['agent_session_operation_expired', 'Operation expired'],
    ['agent_session_operation_conflict', 'Operation conflict']
  ] as const)('reports the current %s refusal', (code, message) => {
    expect(mobileStructuredSendDelivery({ status: 'refused', code, message })).toEqual({
      outcome: 'rejected',
      error: message
    })
  })

  it('preserves an unknown operation refusal as uncertainty', () => {
    expect(
      mobileStructuredSendDelivery({
        status: 'refused',
        code: 'agent_session_operation_unknown',
        message: 'Outcome unknown'
      })
    ).toEqual({ outcome: 'unknown', error: null })
  })

  it('reports a request failure without consulting earlier sends', () => {
    expect(mobileStructuredSendDelivery({ status: 'failed', message: 'Request not sent' })).toEqual(
      { outcome: 'rejected', error: 'Message not sent' }
    )
    expect(
      mobileStructuredSendDelivery({
        status: 'failed',
        message: 'Your message was not sent. Send it again.'
      })
    ).toEqual({ outcome: 'rejected', error: 'Your message was not sent. Send it again.' })
  })

  it("reports a send the host refused after it could not restart the chat's agent", () => {
    // Orca 1.4.217 (#22364, 6ae6ed08bb): a send to a chat whose provider had died makes the host restart
    // it first. When that fails the host refuses the send with this code and the restart's own
    // cause as the message, in the wording of ownerRestartFailedOutcome.
    for (const agentName of ['Claude', 'Codex']) {
      expect(
        mobileStructuredSendDelivery({
          status: 'refused',
          code: 'agent_session_owner_restart_failed',
          message: `${agentName} couldn't restart: the process exited with code 1.`
        })
      ).toEqual({
        outcome: 'rejected',
        error: `${agentName} couldn't restart: the process exited with code 1.`
      })
    }
  })

  it('fails closed when an invalid host response omits the required submission', () => {
    const result = {
      status: 'accepted',
      value: { clientMessageId: 'msg-1' }
    } as unknown as StructuredAgentSessionMutationCallResult<AgentSessionSendResult>
    expect(mobileStructuredSendDelivery(result)).toEqual({ outcome: 'unknown', error: null })
  })
})
