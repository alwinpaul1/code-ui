import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import { applyAgentStatusHudFields, hudFieldsFromAgentStatus } from './hud-agent-status-fields'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

// The fields proposed for Orca's agentStatus on 2026-09-09. A host that has
// them makes the HUD complete on a bare install; a host without them changes
// nothing. This is the phone half of that contract.
const status = {
  state: 'working',
  prompt: '',
  updatedAt: 1,
  stateStartedAt: 1,
  paneKey: 'p',
  stateHistory: [],
  model: 'claude-fable-5-1',
  effort: 'medium',
  contextUsedTokens: 649_000,
  contextWindowTokens: 1_000_000
} as unknown as AgentStatusEntry

const screen: TerminalHudObservation = {
  modelLabel: 'Fable 5.1',
  modelId: 'fable',
  effort: null,
  context: null,
  permissionMode: 'acceptEdits'
}

describe('HUD fields from a newer Orca host', () => {
  it('reads effort and context tokens when the host sends them, ignoring junk', () => {
    expect(hudFieldsFromAgentStatus(status)).toEqual({
      effort: 'medium',
      contextUsedTokens: 649_000,
      contextWindowTokens: 1_000_000
    })
    expect(hudFieldsFromAgentStatus({ ...status, contextWindowTokens: 0, effort: '' } as never)).toEqual({
      contextUsedTokens: 649_000
    })
    expect(hudFieldsFromAgentStatus(undefined)).toEqual({})
  })

  it('fills the ring and effort on a bare footer, keeping the screen\'s mode', () => {
    const merged = applyAgentStatusHudFields(screen, hudFieldsFromAgentStatus(status))
    expect(merged?.effort).toBe('medium')
    expect(merged?.context).toEqual({ usedPercent: 65, usedLabel: '649k', windowLabel: '1.0M' })
    expect(merged?.permissionMode).toBe('acceptEdits')
  })

  it('states no percentage when the host knows the tokens but not the window', () => {
    const merged = applyAgentStatusHudFields(
      screen,
      hudFieldsFromAgentStatus({ ...status, contextWindowTokens: undefined } as never)
    )
    expect(merged?.context).toBeNull()
    expect(merged?.effort).toBe('medium')
  })

  it('changes nothing on a host that does not send the fields', () => {
    expect(applyAgentStatusHudFields(screen, {})).toBe(screen)
    expect(applyAgentStatusHudFields(null, {})).toBeNull()
  })
})
