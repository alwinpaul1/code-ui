import { expect, it } from 'vitest'
import { agentHudContextIsMeasured, mergeAgentHudObservation } from './agent-hud-merge'
import type { AgentHudSnapshot } from './agent-hud-snapshot'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

const screen: TerminalHudObservation = {
  modelLabel: 'Opus 4.8',
  modelId: 'claude-opus-4-8',
  effort: 'high',
  context: { usedPercent: 54, usedLabel: '537.2k', windowLabel: '1M' },
  permissionMode: 'acceptEdits'
}

const snapshot = (over: Partial<AgentHudSnapshot> = {}): AgentHudSnapshot => ({
  agent: 'claude',
  model: 'claude-opus-5',
  effort: 'xhigh',
  agentVersion: '2.1.263',
  contextUsedTokens: 507540,
  contextWindowTokens: 1000000,
  contextWindowSource: 'statusline-cache',
  mode: 'auto',
  planType: null,
  limits: [],
  error: null,
  ...over
})

it('believes the agent over the status line for the model, effort and context', () => {
  // The screen figure is whatever status line the user happens to run, wrapped
  // to the pane width. The snapshot is the agent's own record.
  const merged = mergeAgentHudObservation(screen, snapshot())!
  expect(merged.modelId).toBe('claude-opus-5')
  expect(merged.effort).toBe('xhigh')
  expect(merged.context).toEqual({ usedPercent: 51, usedLabel: '508k', windowLabel: '1.0M' })
})

it('keeps the permission mode with the screen, which is the only thing that sees it', () => {
  const merged = mergeAgentHudObservation(screen, snapshot())!
  expect(merged.permissionMode).toBe('acceptEdits')
})

it('keeps the screen figure rather than drawing an empty ring', () => {
  // A zero percent is drawn as an empty ring and read aloud as "0% used",
  // which is the opposite of the truth on a nearly full session. With no
  // denominator there is no percentage to state, so leave what the screen had.
  const merged = mergeAgentHudObservation(screen, snapshot({
    contextWindowTokens: null,
    contextWindowSource: 'unknown'
  }))!
  expect(merged.context).toBe(screen.context)
  expect(agentHudContextIsMeasured(snapshot({ contextWindowTokens: null }))).toBe(false)
  expect(agentHudContextIsMeasured(snapshot())).toBe(true)
})

it('falls back to the screen rather than blanking when no snapshot could be taken', () => {
  expect(mergeAgentHudObservation(screen, null)).toBe(screen)
  expect(mergeAgentHudObservation(screen, snapshot({ error: 'no-rollout' }))).toBe(screen)
  expect(mergeAgentHudObservation(null, null)).toBeNull()
})

it('reads a Codex snapshot with the window the agent reported', () => {
  // A screen reading is still required: only the screen sees the mode footer,
  // and asserting a mode nobody observed would send the mode sheet cycling from
  // the wrong current value.
  const merged = mergeAgentHudObservation({ ...screen, permissionMode: 'default' }, {
    ...snapshot(),
    agent: 'codex',
    model: 'gpt-5.6-terra',
    contextUsedTokens: 217306,
    contextWindowTokens: 258400,
    contextWindowSource: 'reported-by-agent'
  })!
  expect(merged.modelId).toBe('gpt-5.6-terra')
  expect(merged.context).toEqual({ usedPercent: 84, usedLabel: '217k', windowLabel: '258k' })
  expect(merged.permissionMode).toBe('default')
})

it('says nothing at all when no screen reading backs the snapshot', () => {
  // Returning an observation with a fabricated 'default' mode drew a Manual
  // chip for an agent launched with --permission-mode acceptEdits.
  expect(mergeAgentHudObservation(null, snapshot())).toBeNull()
})
