import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { consumeAgentHudBeacons, resetAgentHudBeacons } from './agent-hud-beacon'
import { clearStickyLiveHudForTests } from './use-sticky-live-hud'
import { parseTerminalHudObservation, type TerminalHudObservation } from './mobile-terminal-hud-parse'
import {
  useMobileNativeChatHud,
  type NativeChatHudPhase,
  type NativeChatLiveHud
} from './use-mobile-native-chat-hud'

// The screen the phone reads is stubbed at the RPC boundary: what matters
// here is what the merge does with a real screen and a real beacon.
const fakes = vi.hoisted(() => ({
  screen: null as TerminalHudObservation | null,
  /** The host's `accounts.subscribe` feed, shaped as `hudRateLimitsForAgent` reads it. */
  accounts: null as unknown
}))
vi.mock('./use-mobile-terminal-hud-observation', () => ({
  useMobileTerminalHudObservation: () => ({
    observation: fakes.screen,
    refresh: async () => fakes.screen,
    dialogOptions: null,
    terminalPermission: null,
    permissionDismissed: false,
    queuedMessages: [],
    sentPrompts: []
  })
}))
vi.mock('./use-host-rate-limits', () => ({
  useHostAccountsSnapshot: () => fakes.accounts
}))

const ESC = '\u001b'
const BEL = '\u0007'
const HANDLE = 'term_f2fc5afd-cae1-4cc8-ac9e-ee2e28649941'
// The session the phone-launched agent ran as, and — verified on Claude Code
// 2.1.276 with `claude -p -c` and `--resume` — the SAME id a hand-typed
// `claude -c` in that terminal keeps, so the session check alone cannot tell
// the two processes apart. That is what the screen and the silence are for.
const S1 = '77954fea-1013-4225-b187-a8b3162a04ce'
const S2 = '8b19cb22-996c-40e5-a887-a5323a9845e1'

// 2026-09-18 10:14, read through Orca's own socket (`terminal.read`): the
// status line of the hand-started `claude -c` in that terminal, verbatim.
const DESK_SCREEN = [
  '[Opus 5 (1M context) xhigh | Max 20x] ██░░░░░░░░ 22% (217k/1.0M) | Code UI git:(main ↑15) | 2 CLAUDE.md | 4 rules | 3 MCPs',
  '',
  '❯ ',
  '  ⏵⏵ accept edits on (shift+tab to cycle)'
]
// What the phone still held for that handle: the phone-launched agent's last
// beacon, Fable 5.1 at medium, the phone's default at the time.
const STALE_FABLE = `${ESC}]7777;CUIHUD1 agent=claude hk=1 sid=${S1} model=claude-fable-5-1 name=Fable%205.1 effort=medium used=649540 win=1000000 pct=64${BEL}`
const LIVE_OPUS = `${ESC}]7777;CUIHUD1 agent=claude hk=1 sid=${S1} model=claude-opus-5 name=Opus%205%20(1M%20context) effort=xhigh used=217000 win=1000000 pct=22${BEL}`

type Probe = {
  agent: string | null
  sessionId: string | null
  phase: NativeChatHudPhase
}
/** What the pill and the ring read (`live`), beside the footer state the
 *  other readers take from `observation`. */
type Read = { live: NativeChatLiveHud; observation: TerminalHudObservation | null }
let latest: Read | null = null
const handleRef = { current: HANDLE as string | null }
function Harness({ agent, sessionId, phase }: Probe) {
  const hud = useMobileNativeChatHud({
    client: {} as RpcClient,
    enabled: true,
    handleRef,
    scopeKey: 'scope',
    tabId: 'tab-1',
    sessionId,
    agent,
    phase,
    agentStatus: null
  })
  latest = { live: hud.live, observation: hud.observation }
  return null
}

let renderer: ReactTestRenderer | null = null
function render(probe: Probe): Read {
  act(() => {
    if (renderer) {
      renderer.update(createElement(Harness, probe))
    } else {
      renderer = create(createElement(Harness, probe))
    }
  })
  if (!latest) {
    throw new Error('the harness did not render')
  }
  return latest
}
function pair(read: Read) {
  return { modelId: read.live.model, modelLabel: read.live.label, effort: read.live.effort }
}
function beacon(bytes: string) {
  act(() => {
    consumeAgentHudBeacons(HANDLE, bytes)
  })
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('the model pill on a terminal whose process changed under it', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    resetAgentHudBeacons()
    clearStickyLiveHudForTests()
    fakes.screen = null
    latest = null
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  // The reported case, whole: same handle, same session id, a badge on
  // screen that names Opus, and a Fable beacon left behind in the store.
  it('states Opus xhigh from the status line, not the Fable the dead process last beaconed (2026-09-18)', () => {
    beacon(STALE_FABLE)
    fakes.screen = parseTerminalHudObservation(DESK_SCREEN)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'idle' }))).toEqual({
      modelId: 'opus',
      modelLabel: 'Opus 5 (1M context)',
      effort: 'xhigh'
    })
  })

  it('states nothing, rather than the dead process\'s model, when a new session has no status line', () => {
    beacon(STALE_FABLE)
    // No bar of their own: the screen names no model.
    fakes.screen = null
    expect(pair(render({ agent: 'claude', sessionId: S2, phase: 'idle' }))).toEqual({
      modelId: null,
      modelLabel: null,
      effort: null
    })
  })

  it('states nothing while the tab does not yet know which session it is showing', () => {
    beacon(STALE_FABLE)
    fakes.screen = null
    expect(pair(render({ agent: 'claude', sessionId: null, phase: 'idle' })).modelId).toBeNull()
  })

  it('believes a beacon that names the session on screen, on a host with no status line', () => {
    beacon(LIVE_OPUS)
    fakes.screen = null
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'idle' }))).toEqual({
      modelId: 'claude-opus-5',
      modelLabel: 'Opus 5 (1M context)',
      effort: 'xhigh'
    })
  })

  it('keeps the host\'s rate-limit windows on the ring the pill reads', () => {
    // The context sheet draws the windows off the same context object the
    // ring is drawn from; they must ride the held reading, not only this
    // tick's raw one.
    fakes.accounts = {
      rateLimits: {
        claude: {
          provider: 'claude',
          session: { usedPercent: 37, windowMinutes: 300, resetsAt: 1_788_967_200_000 },
          weekly: null,
          updatedAt: 1,
          error: null,
          status: 'ok'
        },
        codex: null
      }
    }
    try {
      fakes.screen = parseTerminalHudObservation(DESK_SCREEN)
      const read = render({ agent: 'claude', sessionId: S1, phase: 'idle' })
      expect(read.live.context?.limits).toEqual([
        { name: 'Session', usedPercent: 37, windowMinutes: 300, resetsAt: 1_788_967_200 }
      ])
    } finally {
      fakes.accounts = null
    }
  })

  it('keeps the badge\'s pair through an empty screen read, and lets the footer state go honest', () => {
    fakes.screen = parseTerminalHudObservation(DESK_SCREEN)
    render({ agent: 'claude', sessionId: S1, phase: 'idle' })
    fakes.screen = null
    const read = render({ agent: 'claude', sessionId: S1, phase: 'idle' })
    expect(pair(read)).toEqual({ modelId: 'opus', modelLabel: 'Opus 5 (1M context)', effort: 'xhigh' })
    expect(read.live.context).toMatchObject({ usedPercent: 22 })
    // No screen this tick: the permission pill has nothing to state, as before.
    expect(read.observation).toBeNull()
  })

  it('keeps the context ring from the beacon beside a badge that names the model', () => {
    beacon(LIVE_OPUS)
    fakes.screen = parseTerminalHudObservation(DESK_SCREEN)
    const merged = render({ agent: 'claude', sessionId: S1, phase: 'idle' })
    expect(merged.live.context).toMatchObject({ usedPercent: 22, usedLabel: '217k', windowLabel: '1.0M' })
    // …and the permission mode is still the screen's.
    expect(merged.observation?.permissionMode).toBe('acceptEdits')
  })

  // Same session id, no status line: the only thing that can tell a
  // hand-continued session from the phone-launched one is that the latter
  // repaints — and beacons — several times a second while it works.
  it('drops a beacon that stays silent through 31 s of the agent working, and keeps it through 29 s', async () => {
    beacon(STALE_FABLE)
    fakes.screen = null
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'working' })).modelId).toBe(
      'claude-fable-5-1'
    )
    await advance(29_000)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'working' })).modelId).toBe(
      'claude-fable-5-1'
    )
    await advance(2_000)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'working' }))).toEqual({
      modelId: null,
      modelLabel: null,
      effort: null
    })
    expect(latest?.live.context ?? null).toBeNull()
  })

  it('holds a beacon through five idle minutes', async () => {
    beacon(STALE_FABLE)
    fakes.screen = null
    render({ agent: 'claude', sessionId: S1, phase: 'idle' })
    await advance(300_000)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'idle' })).modelId).toBe(
      'claude-fable-5-1'
    )
  })

  it('starts the silence window again when a fresh beacon lands at 20 s', async () => {
    beacon(STALE_FABLE)
    fakes.screen = null
    render({ agent: 'claude', sessionId: S1, phase: 'working' })
    await advance(20_000)
    beacon(LIVE_OPUS)
    await advance(25_000)
    // 45 s in, 25 s since the last beacon: still live, and the fresh figures.
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'working' })).modelId).toBe(
      'claude-opus-5'
    )
    await advance(7_000)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'working' })).modelId).toBeNull()
  })

  it('comes back when the process speaks again after being written off', async () => {
    beacon(STALE_FABLE)
    fakes.screen = null
    render({ agent: 'claude', sessionId: S1, phase: 'working' })
    await advance(31_000)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'working' })).modelId).toBeNull()
    beacon(LIVE_OPUS)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'working' })).modelId).toBe(
      'claude-opus-5'
    )
  })

  it('does not fall back to the sticky hold once the beacon is dropped', async () => {
    // The hold keeps what the SCREEN last said; it must not keep the beacon
    // alive past its process. With no badge ever read, there is nothing held.
    beacon(STALE_FABLE)
    fakes.screen = null
    render({ agent: 'claude', sessionId: S1, phase: 'working' })
    await advance(31_000)
    expect(pair(render({ agent: 'claude', sessionId: S1, phase: 'idle' })).modelId).toBeNull()
  })
})

describe('the same rules on the Codex lane', () => {
  const T1 = '01a08736-aaaa-bbbb-cccc-000000000001'
  const T2 = '01a08736-aaaa-bbbb-cccc-000000000002'
  const CODEX_BEACON = `${ESC}]7777;CUIHUD1 agent=codex sid=${T1} model=gpt-6-astra effort=high used=22147 win=258400${BEL}`

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    resetAgentHudBeacons()
    clearStickyLiveHudForTests()
    fakes.screen = null
    latest = null
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('refuses a Codex beacon from another thread on the same handle', () => {
    beacon(CODEX_BEACON)
    expect(pair(render({ agent: 'codex', sessionId: T2, phase: 'idle' })).modelId).toBeNull()
    expect(pair(render({ agent: 'codex', sessionId: T1, phase: 'idle' })).modelId).toBe('gpt-6-astra')
  })

  it('lets the Codex footer name the model over the beacon', () => {
    beacon(CODEX_BEACON)
    fakes.screen = parseTerminalHudObservation(['› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project'])
    expect(pair(render({ agent: 'codex', sessionId: T1, phase: 'idle' }))).toEqual({
      modelId: 'gpt-5.6-sol',
      modelLabel: 'gpt-5.6-sol',
      effort: 'xhigh'
    })
  })

  it('holds a Codex beacon through a long turn, since Codex only beacons when a turn ends', async () => {
    beacon(CODEX_BEACON)
    render({ agent: 'codex', sessionId: T1, phase: 'working' })
    await advance(600_000)
    expect(render({ agent: 'codex', sessionId: T1, phase: 'working' }).live.context?.usedPercent).toBe(9)
  })

  it('drops a Codex beacon when a turn ends and none follows', async () => {
    beacon(CODEX_BEACON)
    render({ agent: 'codex', sessionId: T1, phase: 'working' })
    await advance(40_000)
    render({ agent: 'codex', sessionId: T1, phase: 'idle' })
    await advance(30_000)
    expect(render({ agent: 'codex', sessionId: T1, phase: 'idle' }).live.context).toBeNull()
  })
})
