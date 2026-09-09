import { beforeEach, describe, expect, it } from 'vitest'
import {
  consumeAgentHudBeacons,
  getAgentHudBeacon,
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
})
