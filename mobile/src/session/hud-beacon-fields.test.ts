import { describe, expect, it } from 'vitest'
import type { AgentHudBeacon } from './agent-hud-beacon'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { agentHudBeaconMatches, applyAgentHudBeaconFields } from './hud-beacon-fields'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

function beaconOf(payload: string): AgentHudBeacon {
  const beacon = parseAgentHudBeaconPayload(payload, 0)
  if (!beacon) {
    throw new Error(`fixture payload did not parse: ${payload}`)
  }
  return beacon
}

// What Claude Code 2.1.266 sends once it has replied once, and what a Codex
// tab sends after a turn. Both byte-for-byte from agent-hud-launch-args.test.ts.
const CLAUDE = beaconOf(
  'CUIHUD1 agent=claude model=claude-fable-5-1 name=Fable%205.1 effort=medium used=649540 win=1000000 pct=64 h5=37:1788967200 d7=36:1788973200'
)
const CODEX = beaconOf('CUIHUD1 agent=codex model=gpt-6-astra effort=high used=22147 win=258400')

const screen: TerminalHudObservation = {
  modelLabel: 'Sonnet 4.5',
  modelId: 'claude-sonnet-4-5',
  effort: null,
  context: null,
  permissionMode: 'acceptEdits'
}

describe("the HUD believes the agent about itself, not the screen", () => {
  it('shows the model, effort and context the agent just reported, over a stale screen', () => {
    const merged = applyAgentHudBeaconFields(screen, CLAUDE)
    expect(merged).toMatchObject({
      modelLabel: 'Fable 5.1',
      modelId: 'claude-fable-5-1',
      effort: 'medium',
      context: { usedPercent: 64, usedLabel: '650k', windowLabel: '1.0M' },
      // Still the screen's: no beacon carries the permission footer.
      permissionMode: 'acceptEdits'
    })
  })

  it('fills the whole HUD on a Claude tab that has no readable screen at all', () => {
    const merged = applyAgentHudBeaconFields(null, CLAUDE)
    expect(merged?.modelLabel).toBe('Fable 5.1')
    expect(merged?.permissionMode).toBe('default')
  })

  it('carries the rate-limit windows the agent stated, in seconds', () => {
    expect(applyAgentHudBeaconFields(null, CLAUDE)?.context?.limits).toEqual([
      { name: 'Session', usedPercent: 37, resetsAt: 1788967200, windowMinutes: null },
      { name: 'Weekly', usedPercent: 36, resetsAt: 1788973200, windowMinutes: null }
    ])
  })

  it("computes Codex's percentage from its own two figures", () => {
    const merged = applyAgentHudBeaconFields(null, CODEX)
    expect(merged?.context).toMatchObject({
      usedPercent: 9,
      usedLabel: '22.1k',
      windowLabel: '258k'
    })
    expect(merged?.context?.limits).toBeUndefined()
  })

  it('never invents a denominator: tokens with no window leave the ring alone', () => {
    const merged = applyAgentHudBeaconFields(
      screen,
      beaconOf('CUIHUD1 agent=claude model=claude-opus-5 used=493000')
    )
    expect(merged?.modelId).toBe('claude-opus-5')
    expect(merged?.context).toBeNull()
  })

  it('leaves the screen exactly as it was when no beacon has arrived', () => {
    expect(applyAgentHudBeaconFields(screen, null)).toBe(screen)
  })
})

describe('a beacon is only used on the tab it came from', () => {
  it('matches the agent that sent it, and openclaude to claude', () => {
    expect(agentHudBeaconMatches(CLAUDE, 'claude')).toBe(true)
    expect(agentHudBeaconMatches(CLAUDE, 'openclaude')).toBe(true)
    expect(agentHudBeaconMatches(CLAUDE, 'codex')).toBe(false)
    expect(agentHudBeaconMatches(CODEX, 'codex')).toBe(true)
    expect(agentHudBeaconMatches(null, 'codex')).toBe(false)
  })
})

// 2026-09-15: asked whether any of this works on a host that keeps no status
// line of its own. It does, and must: the phone's injected status-line command
// prints nothing, so such a host shows no `[Model effort]` badge and the screen
// observation is null. Every figure then comes from the agent's own beacon.
describe('a host with no status line of its own', () => {
  it('names the model, effort and context from the beacon alone', () => {
    const merged = applyAgentHudBeaconFields(null, {
      agent: 'claude',
      modelId: 'claude-opus-5',
      modelLabel: 'Opus 5',
      effort: 'xhigh',
      usedTokens: 914_000,
      windowTokens: 1_000_000,
      usedPercent: 91,
      limits: [],
      doneTaskIds: [],
      runningTaskIds: null,
      runningTaskIdsAt: null,
      promptHook: false,
      desktopPrompt: null,
      desktopPrompts: [],
      launchedTaskIds: [],
      receivedAt: 0
    })
    expect({
      modelId: merged?.modelId,
      modelLabel: merged?.modelLabel,
      effort: merged?.effort,
      usedPercent: merged?.context?.usedPercent
    }).toEqual({
      modelId: 'claude-opus-5',
      modelLabel: 'Opus 5',
      effort: 'xhigh',
      usedPercent: 91
    })
  })
})
