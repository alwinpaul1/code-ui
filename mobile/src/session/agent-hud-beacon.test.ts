import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendDesktopPrompt,
  consumeAgentHudBeacons,
  getAgentHudBeacon,
  getAgentHudBeaconArrivedAt,
  parseAgentHudBeaconPayload,
  resetAgentHudBeacons
} from './agent-hud-beacon'

const ESC = '\u001b'
const BEL = '\u0007'
const ST = '\u001b\\'

// The exact bytes the host script emits; asserted byte-for-byte in
// agent-hud-launch-args.test.ts against Claude Code 2.1.266's own JSON.
const CLAUDE_BEACON = `${ESC}]7777;CUIHUD1 agent=claude model=claude-fable-5-1 name=Fable%205.1 effort=medium used=649540 win=1000000 pct=64 h5=37:1788967200 d7=36:1788973200${BEL}`
const CODEX_BEACON = `${ESC}]7777;CUIHUD1 agent=codex model=gpt-6-astra effort=high used=22147 win=258400${BEL}`

beforeEach(() => {
  resetAgentHudBeacons()
})

describe('the HUD beacon never reaches the terminal the user is looking at', () => {
  it('takes the whole sequence out of one chunk and leaves the rest byte-identical', () => {
    const rest = consumeAgentHudBeacons('t1', `before${CLAUDE_BEACON}after\r\n`)
    expect(rest).toBe('beforeafter\r\n')
    expect(getAgentHudBeacon('t1')).toMatchObject({
      agent: 'claude',
      modelId: 'claude-fable-5-1',
      modelLabel: 'Fable 5.1',
      effort: 'medium',
      usedTokens: 649540,
      windowTokens: 1000000,
      usedPercent: 64,
      limits: [
        { name: 'Session', usedPercent: 37, resetsAt: 1788967200 },
        { name: 'Weekly', usedPercent: 36, resetsAt: 1788973200 }
      ]
    })
  })

  it('stitches a sequence the PTY split across two chunks', () => {
    const cut = 30
    const first = consumeAgentHudBeacons('t1', `x${CODEX_BEACON.slice(0, cut)}`)
    expect(first).toBe('x')
    expect(getAgentHudBeacon('t1')).toBeNull()
    const second = consumeAgentHudBeacons('t1', `${CODEX_BEACON.slice(cut)}y`)
    expect(second).toBe('y')
    expect(getAgentHudBeacon('t1')).toMatchObject({
      agent: 'codex',
      modelId: 'gpt-6-astra',
      effort: 'high',
      usedTokens: 22147,
      windowTokens: 258400,
      usedPercent: null
    })
  })

  it('stitches one split in the middle of the introducer itself', () => {
    expect(consumeAgentHudBeacons('t1', `hi${ESC}]77`)).toBe('hi')
    expect(consumeAgentHudBeacons('t1', `77;CUIHUD1 agent=codex used=5${BEL}bye`)).toBe('bye')
    expect(getAgentHudBeacon('t1')?.usedTokens).toBe(5)
  })

  it('accepts a string terminator as well as a BEL', () => {
    const rest = consumeAgentHudBeacons('t1', `a${ESC}]7777;CUIHUD1 agent=claude effort=low${ST}b`)
    expect(rest).toBe('ab')
    expect(getAgentHudBeacon('t1')?.effort).toBe('low')
  })

  it("passes another program's OSC through untouched", () => {
    // A window title and an OSC 8 hyperlink: neither is ours, both must render.
    const title = `${ESC}]0;my shell${BEL}`
    const link = `${ESC}]8;;https://example.com${BEL}text${ESC}]8;;${BEL}`
    expect(consumeAgentHudBeacons('t1', `${title}${link}`)).toBe(`${title}${link}`)
    expect(getAgentHudBeacon('t1')).toBeNull()
  })

  it('gives the bytes back rather than swallowing a sequence that never ends', () => {
    const runaway = `${ESC}]7777;${'x'.repeat(4000)}`
    expect(consumeAgentHudBeacons('t1', runaway)).toBe(runaway)
  })

  it('keeps one terminal’s reading out of another’s, split chunks included', () => {
    consumeAgentHudBeacons('t1', CLAUDE_BEACON.slice(0, 40))
    consumeAgentHudBeacons('t2', CODEX_BEACON)
    // t2 completing must not hand t1's half-arrived sequence to anyone.
    expect(getAgentHudBeacon('t1')).toBeNull()
    expect(getAgentHudBeacon('t2')?.agent).toBe('codex')
    consumeAgentHudBeacons('t1', CLAUDE_BEACON.slice(40))
    expect(getAgentHudBeacon('t1')?.agent).toBe('claude')
    expect(getAgentHudBeacon('t2')?.agent).toBe('codex')
  })
})

describe('what the payload is allowed to say', () => {
  it('reports no percentage and no tokens when the agent stated none', () => {
    // 2026-09-14: the prompt hook beacons the transcript's last projected row
    // at submit time, so a queued prompt anchors where its record sits rather
    // than wherever the phone's tail was when the beacon arrived.
    const anchored = parseAgentHudBeaconPayload(
      'CUIHUD1 agent=claude up=4242:queued%20while%20busy at=c3c3c3c3-0000-4000-8000-000000000003'
    )
    expect(anchored?.desktopPrompt).toEqual({
      nonce: '4242',
      text: 'queued while busy',
      cut: false,
      anchorId: 'c3c3c3c3-0000-4000-8000-000000000003'
    })
    // An older hook sends no at=; a malformed one is not trusted as an anchor.
    expect(parseAgentHudBeaconPayload('CUIHUD1 agent=claude up=1:hi')?.desktopPrompt).toEqual({
      nonce: '1',
      text: 'hi',
      cut: false
    })
    expect(
      parseAgentHudBeaconPayload('CUIHUD1 agent=claude up=1:hi at=not_a_uuid!')?.desktopPrompt
    ).toEqual({ nonce: '1', text: 'hi', cut: false })
    const beacon = parseAgentHudBeaconPayload('CUIHUD1 agent=claude model=x win=200000')
    expect(beacon).toMatchObject({ usedTokens: null, usedPercent: null, windowTokens: 200000 })
  })

  it('refuses a payload from a version it does not know', () => {
    expect(parseAgentHudBeaconPayload('CUIHUD2 agent=claude model=x')).toBeNull()
    expect(parseAgentHudBeaconPayload('hello there')).toBeNull()
    expect(parseAgentHudBeaconPayload('CUIHUD1 model=x')).toBeNull()
  })

  it('puts the spaces and semicolons back into a model name', () => {
    const beacon = parseAgentHudBeaconPayload('CUIHUD1 agent=claude name=Opus%205%20(1M%3Bbig)')
    expect(beacon?.modelLabel).toBe('Opus 5 (1M;big)')
  })

  it('drops a rate-limit window whose reset time the agent did not know', () => {
    const beacon = parseAgentHudBeaconPayload('CUIHUD1 agent=claude h5=12:0 d7=nope')
    expect(beacon?.limits).toEqual([{ name: 'Session', usedPercent: 12, resetsAt: null }])
  })
})

describe('finished task ids on the beacon', () => {
  it('reads the done list and ignores anything that is not an id', () => {
    const beacon = parseAgentHudBeaconPayload(
      'CUIHUD1 agent=claude model=claude-fable-5-1 done=bqo82xkjk,b5v3z4u8o,,a63a93c4664bb92cc'
    )
    expect(beacon?.doneTaskIds).toEqual(['bqo82xkjk', 'b5v3z4u8o', 'a63a93c4664bb92cc'])
  })

  it('reports no finished tasks when the beacon carries none', () => {
    expect(parseAgentHudBeaconPayload('CUIHUD1 agent=claude')?.doneTaskIds).toEqual([])
  })

  it('remembers when the run= answer was given, and keeps it across status-line beacons', () => {
    // The reader needs to know whether a launch came before or after the
    // Stop hook spoke; a status-line beacon carries no run= and must not
    // move that time.
    resetAgentHudBeacons()
    consumeAgentHudBeacons('h', '\x1b]7777;CUIHUD1 agent=claude model=m bg=b1\x07')
    expect(getAgentHudBeacon('h')?.runningTaskIdsAt).toBeNull()
    const before = Date.now()
    consumeAgentHudBeacons('h', '\x1b]7777;CUIHUD1 agent=claude run=b1\x07')
    const answeredAt = getAgentHudBeacon('h')?.runningTaskIdsAt ?? null
    expect(answeredAt).not.toBeNull()
    expect(answeredAt as number).toBeGreaterThanOrEqual(before)
    consumeAgentHudBeacons('h', '\x1b]7777;CUIHUD1 agent=claude model=m bg=b1,b2\x07')
    expect(getAgentHudBeacon('h')?.runningTaskIds).toEqual(['b1'])
    expect(getAgentHudBeacon('h')?.runningTaskIdsAt).toBe(answeredAt)
  })

  it('reads the launched shell ids and keeps the last non-empty list across a beacon without one', () => {
    resetAgentHudBeacons()
    consumeAgentHudBeacons('h', '\x1b]7777;CUIHUD1 agent=claude bg=b1,b2 done=b1\x07')
    expect(getAgentHudBeacon('h')?.launchedTaskIds).toEqual(['b1', 'b2'])
    consumeAgentHudBeacons('h', '\x1b]7777;CUIHUD1 agent=claude run=b2\x07')
    expect(getAgentHudBeacon('h')?.launchedTaskIds).toEqual(['b1', 'b2'])
    expect(getAgentHudBeacon('h')?.runningTaskIds).toEqual(['b2'])
  })
})

// 2026-09-18: the phone read "Fable 5.1 medium" for a terminal whose process
// was a hand-started `claude -c` painting "[Opus 5 (1M context) xhigh]". The
// beacon store is keyed by terminal handle, and a handle outlives the process
// that emitted into it, so a beacon must say which session it came from.
describe('a beacon names the session it came from', () => {
  const S1 = '77954fea-1013-4225-b187-a8b3162a04ce'
  const S2 = '8b19cb22-996c-40e5-a887-a5323a9845e1'

  it('reads the session id off the payload', () => {
    expect(parseAgentHudBeaconPayload(`CUIHUD1 agent=claude sid=${S1} model=m`)?.sessionId).toBe(S1)
    // Codex names its thread; the same field carries it.
    expect(
      parseAgentHudBeaconPayload('CUIHUD1 agent=codex sid=01a08736-aaaa-bbbb-cccc-000000000001')
        ?.sessionId
    ).toBe('01a08736-aaaa-bbbb-cccc-000000000001')
  })

  it('reports no session for an emitter that sends none, or one it cannot trust', () => {
    expect(parseAgentHudBeaconPayload('CUIHUD1 agent=claude model=m')?.sessionId).toBeNull()
    expect(parseAgentHudBeaconPayload('CUIHUD1 agent=claude sid=')?.sessionId).toBeNull()
    // An id is `[A-Za-z0-9._-]`; anything else is not one and is refused.
    expect(parseAgentHudBeaconPayload('CUIHUD1 agent=claude sid=not%20an%20id')?.sessionId).toBeNull()
  })

  it('replaces everything held for a handle when a beacon from another session arrives', () => {
    // The first process left prompts, running tasks and a model behind. The
    // next session on the same terminal must not inherit any of it.
    consumeAgentHudBeacons(
      'h',
      `\x1b]7777;CUIHUD1 agent=claude sid=${S1} model=claude-fable-5-1 name=Fable%205.1 effort=medium up=41:old%20prompt bg=b1 run=b1\x07`
    )
    expect(getAgentHudBeacon('h')?.desktopPrompts).toHaveLength(1)
    consumeAgentHudBeacons('h', `\x1b]7777;CUIHUD1 agent=claude sid=${S2} model=claude-opus-5 name=Opus%205 effort=xhigh\x07`)
    expect(getAgentHudBeacon('h')).toMatchObject({
      sessionId: S2,
      modelId: 'claude-opus-5',
      effort: 'xhigh',
      desktopPrompts: [],
      desktopPrompt: null,
      runningTaskIds: null,
      launchedTaskIds: []
    })
  })

  it('merges as before within one session, the Stop hook included', () => {
    consumeAgentHudBeacons('h', `\x1b]7777;CUIHUD1 agent=claude sid=${S1} model=claude-opus-5 effort=xhigh\x07`)
    consumeAgentHudBeacons('h', `\x1b]7777;CUIHUD1 agent=claude sid=${S1} run=b7\x07`)
    expect(getAgentHudBeacon('h')).toMatchObject({
      sessionId: S1,
      modelId: 'claude-opus-5',
      effort: 'xhigh',
      runningTaskIds: ['b7']
    })
  })

  it('keeps the session a beacon without one merges into', () => {
    // A Codex notify whose argument named no thread, from the same process.
    consumeAgentHudBeacons('h', `\x1b]7777;CUIHUD1 agent=codex sid=${S1} model=gpt-6-astra\x07`)
    consumeAgentHudBeacons('h', '\x1b]7777;CUIHUD1 agent=codex\x07')
    expect(getAgentHudBeacon('h')?.sessionId).toBe(S1)
  })
})

// The phone-launched agent repaints its status line several times a second
// while it works, and every repaint re-emits the beacon. So "when did a beacon
// last ARRIVE" is what tells a painting process from a dead one; the
// beacon's own `receivedAt` is not it, because a repeat that says nothing new
// is deliberately not republished.
describe('when a beacon last arrived on a handle', () => {
  it('is unknown until one arrives this run', () => {
    expect(getAgentHudBeaconArrivedAt('h')).toBeNull()
  })

  it('moves on every arrival, a byte-identical repeat included', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const payload = '\x1b]7777;CUIHUD1 agent=claude sid=s model=m\x07'
      consumeAgentHudBeacons('h', payload)
      expect(getAgentHudBeaconArrivedAt('h')).toBe(1_000_000)
      const held = getAgentHudBeacon('h')
      vi.setSystemTime(1_005_000)
      consumeAgentHudBeacons('h', payload)
      // Readers keep the same object (nothing new was said)…
      expect(getAgentHudBeacon('h')).toBe(held)
      // …but the arrival clock still moved.
      expect(getAgentHudBeaconArrivedAt('h')).toBe(1_005_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is per handle, and forgotten with the rest of the store', () => {
    consumeAgentHudBeacons('h1', '\x1b]7777;CUIHUD1 agent=claude sid=s model=m\x07')
    expect(getAgentHudBeaconArrivedAt('h2')).toBeNull()
    resetAgentHudBeacons()
    expect(getAgentHudBeaconArrivedAt('h1')).toBeNull()
  })
})

// 2026-09-13: a fresh copy on every status-line repaint changed the list's
// identity and refolded the whole chat downstream.
it('returns the same list when the beacon repeats a prompt it already holds', () => {
  const previous = [{ nonce: '1', text: 'a' }]
  expect(appendDesktopPrompt(previous, { nonce: '1', text: 'a' })).toBe(previous)
  expect(appendDesktopPrompt(previous, null)).toBe(previous)
})
