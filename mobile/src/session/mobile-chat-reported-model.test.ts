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
    ).toEqual({ model: 'opus', effort: 'xhigh' })
  })

  it('states a live model with no effort rather than borrowing one', () => {
    expect(
      reportedModelPair({ model: 'opus', effort: null }, status({ model: 'fable', effort: 'medium' }))
    ).toEqual({ model: 'opus', effort: null })
  })

  // The launch record is coherent with itself, so when the agent has said
  // nothing yet it answers for both halves — a host that sends effort on
  // `agentStatus` keeps showing it.
  it('falls back to the launch record for the model AND its effort', () => {
    expect(reportedModelPair({ model: null, effort: null }, status({ model: 'opus', effort: 'high' }))).toEqual({
      model: 'opus',
      effort: 'high'
    })
  })

  it('states nothing when neither source has a model', () => {
    expect(reportedModelPair({ model: null, effort: null }, null)).toEqual({
      model: null,
      effort: null
    })
  })

  it('ignores an effort the host did not really send', () => {
    expect(reportedModelPair({ model: null, effort: null }, status({ model: 'opus', effort: '' }))).toEqual({
      model: 'opus',
      effort: null
    })
  })
})
