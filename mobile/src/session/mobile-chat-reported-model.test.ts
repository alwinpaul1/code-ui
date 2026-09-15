import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { reportedModelPair } from './mobile-chat-reported-model'

function status(fields: Record<string, unknown>): AgentStatusEntry {
  return fields as unknown as AgentStatusEntry
}

describe('the model the chat pill states', () => {
  // 2026-09-15 from the phone: "am using opus 5 with high effort", pill said
  // otherwise. The model came from what the agent said; the effort came from
  // the host's launch record, and the two were never about the same thing.
  it('never mixes a live model with the launch record\'s effort', () => {
    expect(
      reportedModelPair(
        { model: 'opus', effort: 'xhigh' },
        status({ model: 'fable', effort: 'medium' })
      )
    ).toEqual({ label: null,
      model: 'opus', effort: 'xhigh', source: 'live' })
  })

  it('states a live model with no effort rather than borrowing one', () => {
    expect(
      reportedModelPair({ model: 'opus', effort: null }, status({ model: 'fable', effort: 'medium' }))
    ).toEqual({ label: null,
      model: 'opus', effort: null, source: 'live' })
  })

  // 2026-09-15, after the model read wrong on the phone for the fifth time in
  // a day: Orca writes `agentStatus.model` once, when the session starts, and
  // never updates it for a `/model` typed afterwards. It is the one source
  // KNOWN to go stale, and every wrong reading traced back to it. So it is no
  // longer a model source at all — the pill states what the agent has said
  // about itself, or nothing. The project's own rule: show nothing rather than
  // a figure from somewhere else.
  it('states nothing rather than the model the session was launched as', () => {
    expect(
      reportedModelPair({ model: null, effort: null }, status({ model: 'opus', effort: 'high' }))
    ).toEqual({ label: null,
      model: null, effort: null, source: 'launch' })
  })

  it('states nothing when neither source has a model', () => {
    expect(reportedModelPair({ model: null, effort: null }, null)).toEqual({
      label: null,
      model: null,
      effort: null,
      source: 'launch'
    })
  })

  it('does not borrow the launch effort either, with no model to attach it to', () => {
    expect(
      reportedModelPair({ model: null, effort: null }, status({ model: 'opus', effort: 'high' }))
        .effort
    ).toBeNull()
  })
})
