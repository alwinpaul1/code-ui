import { describe, expect, it } from 'vitest'
import type { AgentHudBeacon } from './agent-hud-beacon'
import { parseAgentHudBeaconPayload } from './agent-hud-beacon'
import { agentHudBeaconMatches, applyAgentHudBeaconFields } from './hud-beacon-fields'
import {
  parseTerminalHudObservation,
  type TerminalHudObservation
} from './mobile-terminal-hud-parse'

function beaconOf(payload: string): AgentHudBeacon {
  const beacon = parseAgentHudBeaconPayload(payload, 0)
  if (!beacon) {
    throw new Error(`fixture payload did not parse: ${payload}`)
  }
  return beacon
}

const SID = '77954fea-1013-4225-b187-a8b3162a04ce'
// What Claude Code 2.1.266 sends once it has replied once, and what a Codex
// tab sends after a turn. Both byte-for-byte from agent-hud-launch-args.test.ts.
const CLAUDE = beaconOf(
  `CUIHUD1 agent=claude sid=${SID} model=claude-fable-5-1 name=Fable%205.1 effort=medium used=649540 win=1000000 pct=64 h5=37:1788967200 d7=36:1788973200`
)
const CODEX = beaconOf(
  `CUIHUD1 agent=codex sid=${SID} model=gpt-6-astra effort=high used=22147 win=258400`
)

// A screen that names no model: the phone's injected status line prints
// nothing, so a host with no bar of its own paints no badge at all.
const screen: TerminalHudObservation = {
  modelLabel: '',
  modelId: null,
  effort: null,
  context: null,
  permissionMode: 'acceptEdits'
}

// 2026-09-18 10:14, read through Orca's own socket (`terminal.read` on
// term_f2fc5afd-cae1-4cc8-ac9e-ee2e28649941): the status line of a
// hand-started `claude -c`, verbatim. The phone said "Fable 5.1 medium".
const DESK_STATUS_LINE =
  '[Opus 5 (1M context) xhigh | Max 20x] ██░░░░░░░░ 22% (217k/1.0M) | Code UI git:(main ↑15) | 2 CLAUDE.md | 4 rules | 3 MCPs'
// What the phone still held for that same handle: the last beacon of the
// phone-launched agent that had run in that terminal before, Fable 5.1 at
// medium (the phone's default at the time). A hand-started `claude -c` runs
// without `--settings`, so it never emits a beacon of its own to replace it.
const STALE_FABLE = beaconOf(
  `CUIHUD1 agent=claude hk=1 sid=${SID} model=claude-fable-5-1 name=Fable%205.1 effort=medium used=649540 win=1000000 pct=64`
)

describe('the screen is the present', () => {
  // A live beacon and the badge describe the same repaint and cannot
  // disagree for longer than the instant after `/model`. When they do
  // disagree, the beacon is describing something that is no longer on
  // screen — here, a process that had exited.
  it('states the model the status line paints, not the one a beacon last said (Fable on an Opus session, 2026-09-18)', () => {
    const desk = parseTerminalHudObservation([DESK_STATUS_LINE, '', '❯ '])
    expect(desk).toMatchObject({ modelId: 'opus', effort: 'xhigh', modelLabel: 'Opus 5 (1M context)' })
    const merged = applyAgentHudBeaconFields(desk, STALE_FABLE)
    expect({ modelId: merged?.modelId, modelLabel: merged?.modelLabel, effort: merged?.effort }).toEqual({
      modelId: 'opus',
      modelLabel: 'Opus 5 (1M context)',
      effort: 'xhigh'
    })
  })

  it('takes the badge\'s effort with its model, null included, never the beacon\'s beside it', () => {
    // A user's own bar that prints "[Opus 5]" and no effort word: the pair is
    // Opus with no effort, not Opus at the beacon's medium.
    const bare = parseTerminalHudObservation(['[Opus 5 | Max 20x] 22%', '❯ '])
    expect(bare?.modelId).toBe('opus')
    expect(bare?.effort).toBeNull()
    expect(applyAgentHudBeaconFields(bare, STALE_FABLE)).toMatchObject({ modelId: 'opus', effort: null })
  })

  it('lets the beacon name the model when the screen names none, as on a host with no status line', () => {
    const merged = applyAgentHudBeaconFields(screen, STALE_FABLE)
    expect(merged).toMatchObject({
      modelLabel: 'Fable 5.1',
      modelId: 'claude-fable-5-1',
      effort: 'medium'
    })
  })

  // Codex paints its own footer ("gpt-6-astra medium · ~/Project"), which the
  // parser reads as a model too, so the same rule holds on that lane.
  it('lets the Codex footer beat a beacon that names another model', () => {
    const footer = parseTerminalHudObservation(['› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project'])
    expect(footer?.modelId).toBe('gpt-5.6-sol')
    expect(applyAgentHudBeaconFields(footer, CODEX)).toMatchObject({
      modelId: 'gpt-5.6-sol',
      effort: 'xhigh'
    })
  })
})

describe("the HUD believes the agent about itself where the screen says nothing", () => {
  it('shows the model, effort and context the agent reported, on a screen with no badge', () => {
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

  it('still supplies the context beside a badge that names the model', () => {
    // The badge owns the pair; the beacon's figures are the agent's own
    // token counts and remain the better reading of the ring.
    const desk = parseTerminalHudObservation([DESK_STATUS_LINE, '❯ '])
    const merged = applyAgentHudBeaconFields(desk, CLAUDE)
    expect(merged?.context).toMatchObject({ usedPercent: 64, usedLabel: '650k' })
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
    expect(agentHudBeaconMatches(CLAUDE, 'claude', SID)).toBe(true)
    expect(agentHudBeaconMatches(CLAUDE, 'openclaude', SID)).toBe(true)
    expect(agentHudBeaconMatches(CLAUDE, 'codex', SID)).toBe(false)
    expect(agentHudBeaconMatches(CODEX, 'codex', SID)).toBe(true)
    expect(agentHudBeaconMatches(null, 'codex', SID)).toBe(false)
  })

  // 2026-09-18: a beacon is keyed by terminal HANDLE and carried nothing that
  // tied it to the process that emitted it. A terminal that once ran a
  // phone-launched agent kept that agent's last beacon after it exited, and a
  // `claude` typed by hand into the same terminal — same handle, same PTY, no
  // beacon of its own — inherited it as live. The beacon now names the session
  // it came from, and the phone believes it only for the session it is showing.
  it('refuses a beacon from another session on the same handle', () => {
    const other = beaconOf(
      'CUIHUD1 agent=claude sid=8b19cb22-996c-40e5-a887-a5323a9845e1 model=claude-fable-5-1'
    )
    expect(agentHudBeaconMatches(other, 'claude', SID)).toBe(false)
  })

  it('refuses a beacon that names no session while the tab knows its own', () => {
    // An older emitter, or a record from before the field existed: no evidence
    // it is this process.
    const unsigned = beaconOf('CUIHUD1 agent=claude model=claude-fable-5-1')
    expect(unsigned.sessionId).toBeNull()
    expect(agentHudBeaconMatches(unsigned, 'claude', SID)).toBe(false)
  })

  it('holds a beacon unused until the tab knows which session it is showing', () => {
    // Show nothing rather than a figure from a process that may be gone.
    expect(agentHudBeaconMatches(CLAUDE, 'claude', null)).toBe(false)
    expect(agentHudBeaconMatches(beaconOf('CUIHUD1 agent=claude model=x'), 'claude', null)).toBe(
      false
    )
  })

  it('applies the same session check on the Codex lane', () => {
    expect(agentHudBeaconMatches(CODEX, 'codex', '01a08736-aaaa-bbbb-cccc-000000000001')).toBe(false)
    expect(agentHudBeaconMatches(CODEX, 'codex', null)).toBe(false)
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
      sessionId: SID,
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

// 2026-09-15 regression review: the merge order puts `agentStatus` in FIRST
// (`use-mobile-native-chat-hud.ts`), so a beacon that names a model but carries
// no effort inherited the host's LAUNCH-time effort from the base. The pair was
// already mixed before `useStickyLiveHud` — which now moves the two together —
// ever saw it, so "Opus Medium" on an Opus xhigh session survived through this
// second door. A beacon naming a model speaks for the effort beside it too.
describe('the effort that belongs to a beaconed model', () => {
  // Real payload shape, minus the effort field: Claude omits it entirely when
  // the model carries no reasoning level.
  const NO_EFFORT = beaconOf(
    'CUIHUD1 agent=claude model=claude-opus-5 name=Opus%205 used=649540 win=1000000 pct=64'
  )
  // What the host's agentStatus merge leaves on the base on a host with no
  // status line: no model (the screen named none) carrying a launch-time
  // effort — `applyAgentStatusHudFields` never sets a model, only the effort.
  const withLaunchEffort: TerminalHudObservation = {
    modelLabel: '',
    modelId: null,
    effort: 'medium',
    context: null,
    permissionMode: 'default'
  }

  it('does not let a beaconed model inherit the launch effort', () => {
    expect(applyAgentHudBeaconFields(withLaunchEffort, NO_EFFORT)).toMatchObject({
      modelId: 'claude-opus-5',
      effort: null
    })
  })

  it('keeps the effort a beacon states alongside its model', () => {
    expect(applyAgentHudBeaconFields(withLaunchEffort, CLAUDE)).toMatchObject({
      modelId: 'claude-fable-5-1',
      effort: 'medium'
    })
  })

  // A beacon naming no model is the Stop hook speaking about running tasks. It
  // says nothing about either half, so both must stand.
  it('leaves the pair alone for a beacon that names no model', () => {
    const stopHook = beaconOf('CUIHUD1 agent=claude run=abc123')
    expect(
      applyAgentHudBeaconFields(
        {
          modelLabel: 'Opus 5',
          modelId: 'claude-opus-5',
          effort: 'xhigh',
          context: null,
          permissionMode: 'default'
        },
        stopHook
      )
    ).toMatchObject({ modelId: 'claude-opus-5', effort: 'xhigh' })
  })
})
