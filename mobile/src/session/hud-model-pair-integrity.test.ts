import { describe, expect, it } from 'vitest'
import { applyAgentHudBeaconFields } from './hud-beacon-fields'
import type { AgentHudBeacon } from './agent-hud-beacon'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

function beacon(fields: Partial<AgentHudBeacon>): AgentHudBeacon {
  return {
    agent: 'claude',
    sessionId: '77954fea-1013-4225-b187-a8b3162a04ce',
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

// A user's own status line, read off the screen.
const RUNNING_OPUS: TerminalHudObservation = {
  modelLabel: 'Opus 4.8.5',
  modelId: 'opus',
  effort: 'xhigh',
  context: null,
  permissionMode: 'default'
}

// A host with no status line: the screen names no model, and the host's
// agent-status merge has left its launch-time effort on the base.
const NO_MODEL: TerminalHudObservation = {
  modelLabel: '',
  modelId: null,
  effort: 'medium',
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
  // 2026-09-18: the badge on screen is the present, so it owns all three
  // halves at once — id, name and effort — and a beacon naming another model
  // is describing something no longer on screen.
  it('takes id, name and effort together from a badge that names a model', () => {
    const merged = applyAgentHudBeaconFields(
      RUNNING_OPUS,
      beacon({ modelId: 'claude-sonnet-5', modelLabel: 'Sonnet 5', effort: 'high' })
    )
    expect(merged).toMatchObject({ modelId: 'opus', modelLabel: 'Opus 4.8.5', effort: 'xhigh' })
  })

  it('never keeps a stale id beside a new name', () => {
    const merged = applyAgentHudBeaconFields(
      NO_MODEL,
      beacon({ modelLabel: 'Sonnet 4.5', effort: 'high' })
    )
    expect(merged?.modelLabel).toBe('Sonnet 4.5')
    expect(merged?.modelId).toBeNull()
    expect(merged?.effort).toBe('high')
  })

  it('never keeps a stale name beside a new id', () => {
    const merged = applyAgentHudBeaconFields(
      NO_MODEL,
      beacon({ modelId: 'claude-sonnet-5', effort: 'high' })
    )
    expect(merged?.modelId).toBe('claude-sonnet-5')
    expect(merged?.modelLabel).toBe('claude-sonnet-5')
  })

  it('takes both from the beacon when it states both', () => {
    const merged = applyAgentHudBeaconFields(
      NO_MODEL,
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
    expect(applyAgentHudBeaconFields(NO_MODEL, beacon({ usedTokens: 10 }))).toMatchObject({
      modelId: null,
      modelLabel: '',
      effort: 'medium'
    })
  })

  it('keeps the screen reading when there is no beacon', () => {
    expect(applyAgentHudBeaconFields(RUNNING_OPUS, null)).toBe(RUNNING_OPUS)
  })
})
