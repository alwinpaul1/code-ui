import { describe, expect, it } from 'vitest'
import { applyAgentHudBeaconFields } from './hud-beacon-fields'
import type { AgentHudBeacon } from './agent-hud-beacon'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

function beacon(fields: Partial<AgentHudBeacon>): AgentHudBeacon {
  return {
    agent: 'claude',
    modelId: null,
    modelLabel: null,
    effort: null,
    usedTokens: null,
    windowTokens: null,
    usedPercent: null,
    limits: [],
    ...fields
  } as AgentHudBeacon
}

const RUNNING_OPUS: TerminalHudObservation = {
  modelLabel: 'Opus 4.8.5',
  modelId: 'opus',
  effort: 'xhigh',
  context: null,
  permissionMode: 'default'
}

// A model's ID and its NAME are one statement about one session. This file
// already enforces that for model and effort — "take the pill's model and effort
// from one source, never two" — but the id and the label still fell back
// INDEPENDENTLY, so a beacon naming a model without an id kept the previous
// id beside the new name. The pill then stated a pair that never existed, which
// is the same defect that produced "Opus Medium" on an Opus xhigh session.
describe('the model id and the name it is shown under', () => {
  it('never keeps the old id beside a new name', () => {
    const merged = applyAgentHudBeaconFields(
      RUNNING_OPUS,
      beacon({ modelLabel: 'Sonnet 4.5', effort: 'high' })
    )
    expect(merged?.modelLabel).toBe('Sonnet 4.5')
    expect(merged?.modelId).not.toBe('opus')
  })

  it('never keeps the old name beside a new id', () => {
    const merged = applyAgentHudBeaconFields(
      RUNNING_OPUS,
      beacon({ modelId: 'claude-sonnet-5', effort: 'high' })
    )
    expect(merged?.modelId).toBe('claude-sonnet-5')
    expect(merged?.modelLabel).not.toBe('Opus 4.8.5')
  })

  it('takes both from the beacon when it states both', () => {
    const merged = applyAgentHudBeaconFields(
      RUNNING_OPUS,
      beacon({ modelId: 'claude-sonnet-5', modelLabel: 'Sonnet 5', effort: 'high' })
    )
    expect(merged).toMatchObject({
      modelId: 'claude-sonnet-5',
      modelLabel: 'Sonnet 5',
      effort: 'high'
    })
  })

  it('leaves both alone when the beacon names no model at all', () => {
    // The Stop hook talks about running tasks and says nothing about the model.
    const merged = applyAgentHudBeaconFields(RUNNING_OPUS, beacon({ usedTokens: 10 }))
    expect(merged).toMatchObject({
      modelId: 'opus',
      modelLabel: 'Opus 4.8.5',
      effort: 'xhigh'
    })
  })

  it('keeps the screen reading when there is no beacon', () => {
    expect(applyAgentHudBeaconFields(RUNNING_OPUS, null)).toBe(RUNNING_OPUS)
  })
})
