import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  nativeChatStatusReadingLogLine,
  phoneOwnership,
  readNativeChatTabStatus,
  type NativeChatStatusEvidence,
  type NativeChatStatusReading
} from './native-chat-kept-session'
import {
  nativeChatKeptSessionKey,
  ownTabStatus,
  readSessionId,
  resetNativeChatKeptSessionsForTests,
  useNativeChatTabStatusReading,
  type NativeChatTabStatus
} from './native-chat-kept-session-store'
import { readNativeChatStreamFrame } from './mobile-native-chat-stream-frame'
import { consumeAgentHudBeacons, getAgentHudBeacon, resetAgentHudBeacons } from './agent-hud-beacon'
import { resetBeaconWatches } from './agent-hud-beacon-liveness'
import { useFreshNativeChatBeaconSession } from './native-chat-kept-session-store'

const CLAUDE_SESSION = '76ba8f2f-3727-4cbb-bfc4-3f09fba4d67b'
const CLAUDE_TRANSCRIPT = `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${CLAUDE_SESSION}.jsonl`
const GROK_SESSION = '5690de4f-8d81-4478-b1ae-5ec01e15451b'
const NEXT_SESSION = '0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5'
const NEXT_TRANSCRIPT = `/Users/alwinpaul/.claude/projects/-Users-alwinpaul-Desktop-Project-Thesis/${NEXT_SESSION}.jsonl`
const KEPT = { sessionId: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT }

function read(overrides: Partial<NativeChatStatusEvidence>): NativeChatStatusReading {
  return readNativeChatTabStatus({
    agent: 'claude',
    providerSession: { id: GROK_SESSION },
    kept: KEPT,
    keptTurn: null,
    painting: null,
    ...overrides
  })
}

describe('whose word a tab status is, for a Claude chat', () => {
  it('reads a status naming no transcript as a nested agent’s, and keeps the session it had', () => {
    expect(read({})).toEqual({
      kind: 'nested',
      nestedSessionId: GROK_SESSION,
      read: KEPT,
      reason: { kind: 'no-transcript' }
    })
  })

  it('reads a whitespace-only transcript path as no path', () => {
    expect(read({ providerSession: { id: GROK_SESSION, transcriptPath: '   ' } }).kind).toBe('nested')
  })

  it('reads the kept session named bare as the agent’s own, with the transcript it named before', () => {
    expect(read({ providerSession: { id: CLAUDE_SESSION } })).toEqual({
      kind: 'own',
      sessionId: CLAUDE_SESSION,
      transcriptPath: CLAUDE_TRANSCRIPT,
      keep: null,
      switched: null
    })
  })

  it('reads a status with no session, or an agent with no rule, as reported', () => {
    expect(read({ providerSession: null }).kind).toBe('as-reported')
    expect(read({ providerSession: { id: '  ' } }).kind).toBe('as-reported')
    expect(read({ agent: 'omp' }).kind).toBe('as-reported')
    expect(read({ agent: null }).kind).toBe('as-reported')
  })

  it('draws none of a status naming no transcript with nothing kept, and reads its session as reported', () => {
    const reading = read({ kept: null })
    expect(reading).toEqual({
      kind: 'nested',
      nestedSessionId: GROK_SESSION,
      read: null,
      reason: { kind: 'no-transcript' }
    })
    expect(readSessionId(reading, GROK_SESSION)).toBe(GROK_SESSION)
    expect(nativeChatStatusReadingLogLine('claude', reading)).toBe(
      "[native-chat] no claude session kept for this tab; 5690de4f's status named no claude transcript (a nested agent's, most likely), so the chat draws none of it and reads 5690de4f as reported"
    )
  })

  it('keeps nothing and reads as its own a first status that names a transcript', () => {
    expect(read({ kept: null, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })).toEqual({
      kind: 'own',
      sessionId: NEXT_SESSION,
      transcriptPath: NEXT_TRANSCRIPT,
      keep: { sessionId: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT },
      switched: null
    })
  })

  it('takes a transcript in a layout it does not recognise as the agent’s own', () => {
    const odd = '/Volumes/work/claude-home/sessions/x.jsonl'
    expect(read({ kept: null, providerSession: { id: NEXT_SESSION, transcriptPath: odd } }).kind).toBe('own')
  })

  it('reads a Codex rollout named on a Claude tab as another agent’s', () => {
    const rollout = '/Users/me/.codex/sessions/2026/09/27/rollout-2026-09-27T21-40-11-019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b.jsonl'
    const reading = read({ providerSession: { id: NEXT_SESSION, transcriptPath: rollout } })
    expect(reading).toMatchObject({ kind: 'nested', read: KEPT, reason: { kind: 'other-agent', writer: 'codex' } })
  })

  it('keeps the session when a new one names its transcript while the kept one runs a tool', () => {
    const reading = read({ keptTurn: 'working', providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT }, state: 'working' })
    expect(reading).toMatchObject({ kind: 'nested', read: KEPT, reason: { kind: 'mid-turn' } })
    expect(nativeChatStatusReadingLogLine('claude', reading)).toBe(
      '[native-chat] kept session 76ba8f2f over 0c1d2e3f: it appeared while 76ba8f2f was mid-turn (a nested agent on this pane)'
    )
  })

  it('follows a new session naming its transcript when nothing has said the kept one runs a tool', () => {
    // A cold start knows no turn; nothing known is not evidence of a nested run.
    expect(read({ keptTurn: null, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })).toMatchObject({
      kind: 'own',
      switched: { from: CLAUDE_SESSION, why: 'nothing said 76ba8f2f was mid-turn' }
    })
  })

  it('follows a new session that started a second turn, while the kept one still reads as running', () => {
    expect(
      read({ keptTurn: 'working', secondTurn: true, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    ).toMatchObject({ kind: 'own', switched: { why: 'it started a second turn of its own' } })
  })

  it('does not take a finished first turn of the new session as leave to move', () => {
    const reading = read({
      keptTurn: 'working',
      providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT },
      state: 'done'
    })
    expect(reading.kind).toBe('nested')
  })

  it('reads a session naming its transcript as nested when a fresh beacon names another, even with nothing kept', () => {
    const reading = read({ kept: null, painting: CLAUDE_SESSION, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(reading).toMatchObject({
      kind: 'nested',
      read: { sessionId: CLAUDE_SESSION, transcriptPath: null },
      reason: { kind: 'painting' }
    })
  })

  it('moves to a new session naming its transcript once the kept turn has ended', () => {
    expect(read({ keptTurn: 'ended', providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })).toMatchObject({
      kind: 'own',
      sessionId: NEXT_SESSION,
      switched: { from: CLAUDE_SESSION, why: "76ba8f2f's turn had ended" }
    })
  })

  it('lets a fresh beacon pick the session over a status naming none, and allow a switch to the one it names', () => {
    expect(read({ kept: null, painting: CLAUDE_SESSION })).toMatchObject({
      kind: 'nested',
      read: { sessionId: CLAUDE_SESSION, transcriptPath: null },
      reason: { kind: 'painting' }
    })
    expect(
      read({ keptTurn: 'working', painting: NEXT_SESSION, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    ).toMatchObject({ kind: 'own', switched: { why: 'the claude beacon on this terminal names it' } })
  })

  // 2026-09-29: a lead whose turn ended with background work running can
  // still have a nested agent start under it, from that background work.
  it('keeps the session whose turn ended with background work running, over a new one naming its transcript', () => {
    const reading = read({ keptTurn: 'background', providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(reading).toMatchObject({ kind: 'nested', read: KEPT, reason: { kind: 'background' } })
    expect(nativeChatStatusReadingLogLine('claude', reading)).toBe(
      "[native-chat] kept session 76ba8f2f over 0c1d2e3f: it appeared while 76ba8f2f's background work ran (a nested agent on this pane)"
    )
  })

  it('follows a new session whose own turn ended holding the pane’s background work, as a /clear’s does', () => {
    const reading = read({ keptTurn: 'background', holdsBackground: true, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(reading).toMatchObject({ kind: 'own', sessionId: NEXT_SESSION, switched: { from: CLAUDE_SESSION, rule: 'holds-background' } })
    expect(nativeChatStatusReadingLogLine('claude', reading)).toBe(
      "[native-chat] switched session 76ba8f2f to 0c1d2e3f (rule holds-background): 0c1d2e3f's own turn ended with the pane's background work still running"
    )
  })

  it.each([
    ['beacon', { keptTurn: 'background' as const, painting: NEXT_SESSION }],
    ['turn-ended', { keptTurn: 'ended' as const }],
    ['turn-unknown', { keptTurn: null }],
    ['second-turn', { keptTurn: 'background' as const, secondTurn: true }]
  ])('names the rule that let it switch in the log line: %s', (rule, evidence) => {
    const reading = read({ ...evidence, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(nativeChatStatusReadingLogLine('claude', reading)).toMatch(new RegExp(`^\\[native-chat\\] switched session 76ba8f2f to 0c1d2e3f \\(rule ${rule}\\): `))
  })

  describe('what this phone wrote to the terminal', () => {
    const AT = 1_790_705_106_923
    const working = (prompt: string, updatedAt = AT) => ({ state: 'working', prompt, updatedAt })
    const boundary = (updatedAt = AT) => ({ state: 'done', prompt: '', sessionBoundary: true, updatedAt })

    it('owns a session that took a prompt the phone sent, as Orca folds and cuts it', () => {
      expect(phoneOwnership(working('where were we'), [{ text: 'where were we', at: AT - 500 }])).toBe('prompt')
      expect(phoneOwnership(working('two lines'), [{ text: 'two\nlines', at: AT - 500 }])).toBe('prompt')
      const long = 'x'.repeat(260)
      expect(phoneOwnership(working(long.slice(0, 200)), [{ text: long, at: AT - 500 }])).toBe('prompt')
    })

    it('owns a session boundary that came right after the phone sent a session command', () => {
      for (const command of ['/clear', '/new', '/reset', '/resume 0c1d2e3f']) {
        expect(phoneOwnership(boundary(), [{ text: command, at: AT - 1_000 }])).toBe('reset')
      }
    })

    it.each([
      ['no sends', working('where were we'), []],
      ['another text', working('where were we'), [{ text: 'where are we', at: AT - 500 }]],
      ['a send long before', working('where were we'), [{ text: 'where were we', at: AT - 30 * 60_000 }]],
      ['a send after the status', working('where were we'), [{ text: 'where were we', at: AT + 5 * 60_000 }]],
      ['a /clear long before the boundary', boundary(), [{ text: '/clear', at: AT - 10 * 60_000 }]],
      ['a /clear under a working status', working('/clear'), [{ text: '/compact', at: AT - 500 }]],
      ['a command that starts no session', boundary(), [{ text: '/cleanup', at: AT - 1_000 }]],
      ['a status with no time', { state: 'working', prompt: 'where were we' }, [{ text: 'where were we', at: AT }]]
    ])('owns nothing from %s', (_label, status, sends) => {
      expect(phoneOwnership(status, sends)).toBeNull()
    })

    it('reads nothing from no status', () => {
      expect(phoneOwnership(null, [{ text: 'x', at: AT }])).toBeNull()
    })

    it('reads a photo send’s caption through the image markers the hook’s copy leads with', () => {
      expect(phoneOwnership(working('[Image #1] [Image #2] what is wrong here'), [{ text: 'what is wrong here', at: AT - 500 }])).toBe('prompt')
    })

    it('takes only a turn-start row: Orca carries the pane’s last prompt on every tool row, a nested run’s too', () => {
      expect(phoneOwnership({ ...working('where were we'), toolName: 'Grep' }, [{ text: 'where were we', at: AT - 500 }])).toBeNull()
    })

    it('gives a send to the first session that showed it, and to no other', () => {
      const status = { ...working('where were we'), providerSession: { id: NEXT_SESSION } }
      expect(phoneOwnership(status, [{ text: 'where were we', at: AT - 500, claimedBy: CLAUDE_SESSION }])).toBeNull()
      expect(phoneOwnership(status, [{ text: 'where were we', at: AT - 500, claimedBy: NEXT_SESSION }])).toBe('prompt')
      expect(phoneOwnership({ ...boundary(), providerSession: { id: NEXT_SESSION } }, [{ text: '/clear', at: AT - 1_000, claimedBy: GROK_SESSION }])).toBeNull()
    })

    it('reads no /clear into a boundary while the kept session is mid-turn: it waits in the queue then', () => {
      expect(phoneOwnership(boundary(), [{ text: '/clear', at: AT - 1_000 }], 'working')).toBeNull()
      expect(phoneOwnership(boundary(), [{ text: '/clear', at: AT - 1_000 }], 'background')).toBe('reset')
    })
  })

  it('keeps the beacon’s session when a new one names its transcript but the painting process is still the old one', () => {
    const reading = read({ keptTurn: 'ended', painting: CLAUDE_SESSION, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(reading).toMatchObject({ kind: 'nested', read: KEPT, reason: { kind: 'painting' } })
  })
})

describe('the tab status the chat and the tab dot may use', () => {
  it('is none while the status is a nested agent’s, and the status itself otherwise', () => {
    const status = { state: 'working' }
    expect(ownTabStatus(read({}), status)).toBeNull()
    expect(ownTabStatus(read({ providerSession: { id: CLAUDE_SESSION } }), status)).toBe(status)
    expect(ownTabStatus({ kind: 'as-reported' }, status)).toBe(status)
  })
})

// The reading as the tab badge and the chat take it: through the store, which
// keeps the session its own status names and hears the turn from the
// transcript stream.
describe('the kept-session store', () => {
  let renderer: ReactTestRenderer | null = null
  let latest: NativeChatStatusReading | null = null
  const key = nativeChatKeptSessionKey('host-mac', 'tab-store', 'claude')

  function Probe({ status }: { status: NativeChatTabStatus }): null {
    latest = useNativeChatTabStatusReading(key, 'claude', status)
    return null
  }

  function show(status: NativeChatTabStatus) {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { status }))
      } else {
        renderer = create(createElement(Probe, { status }))
      }
    })
  }

  beforeEach(() => {
    resetNativeChatKeptSessionsForTests()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
  })

  it('keeps the session a status of the agent’s own names, and holds it over a nested one', () => {
    show({ state: 'working', providerSession: { id: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT } })
    show({ state: 'working', providerSession: { id: GROK_SESSION } })
    expect(latest).toMatchObject({ kind: 'nested', read: KEPT })
  })

  it('does not hear a Claude transcript’s turn markers: Orca reads a mid-turn note as `completed`', () => {
    show({ state: 'working', providerSession: { id: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT } })
    act(() => {
      readNativeChatStreamFrame({ type: 'appended', messages: [], lifecycle: { state: 'completed' } }, 'claude', CLAUDE_SESSION)
    })
    show({ state: 'done', sessionBoundary: true, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(latest).toMatchObject({ kind: 'nested', reason: { kind: 'mid-turn' } })
  })

  it('counts a later status of the session over an earlier word on its turn', () => {
    show({ state: 'done', updatedAt: 1, providerSession: { id: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT } })
    show({ state: 'working', updatedAt: 2, providerSession: { id: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT } })
    show({ state: 'working', updatedAt: 3, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(latest).toMatchObject({ kind: 'nested', reason: { kind: 'mid-turn' } })
  })

  describe('on a Codex tab, whose rollout marks its turns with explicit task events', () => {
    const CODEX = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b'
    const ROLLOUT = `/Users/me/.codex/sessions/2026/09/27/rollout-2026-09-27T21-40-11-${CODEX}.jsonl`
    const NEXT = '019a2b3d-0000-7000-8000-000000000001'
    const NEXT_ROLLOUT = `/Users/me/.codex/sessions/2026/09/28/rollout-2026-09-28T01-02-03-${NEXT}.jsonl`
    function CodexProbe({ status }: { status: NativeChatTabStatus }): null {
      latest = useNativeChatTabStatusReading(nativeChatKeptSessionKey('host-mac', 'tab-codex-store', 'codex'), 'codex', status)
      return null
    }
    function showCodex(status: NativeChatTabStatus) {
      act(() => {
        if (renderer) {
          renderer.update(createElement(CodexProbe, { status }))
        } else {
          renderer = create(createElement(CodexProbe, { status }))
        }
      })
    }

    it('hears the task-complete marker as the end of the turn, and lets a new thread in', () => {
      showCodex({ state: 'working', updatedAt: 1, providerSession: { id: CODEX, transcriptPath: ROLLOUT } })
      act(() => {
        readNativeChatStreamFrame({ type: 'appended', messages: [], lifecycle: { state: 'completed' } }, 'codex', CODEX)
      })
      showCodex({ state: 'working', updatedAt: 2, providerSession: { id: NEXT, transcriptPath: NEXT_ROLLOUT } })
      expect(latest).toMatchObject({ kind: 'own', sessionId: NEXT })
    })

    it('hears the task-started marker as the turn running again', () => {
      showCodex({ state: 'done', updatedAt: 1, providerSession: { id: CODEX, transcriptPath: ROLLOUT } })
      act(() => {
        readNativeChatStreamFrame({ type: 'appended', messages: [], lifecycle: { state: 'working' } }, 'codex', CODEX)
      })
      showCodex({ state: 'working', updatedAt: 2, providerSession: { id: NEXT, transcriptPath: NEXT_ROLLOUT } })
      expect(latest).toMatchObject({ kind: 'nested', reason: { kind: 'mid-turn' } })
    })
  })

  it('hands an absent or markerless frame back untouched, and hears nothing from it', () => {
    expect(readNativeChatStreamFrame(undefined, 'claude', CLAUDE_SESSION)).toBeUndefined()
    const frame = { type: 'snapshot', messages: [] }
    expect(readNativeChatStreamFrame(frame, 'claude', CLAUDE_SESSION)).toBe(frame)
    expect(readNativeChatStreamFrame({ type: 'snapshot', lifecycle: { state: 'bogus' } }, null, null)).toMatchObject({ type: 'snapshot' })
  })
})

// Review of b97b00d6: the freshness clock froze while no beacon was being
// judged, and the arrival was read at render, so the first frame after a tab
// came back judged a beacon silent for a minute as fresh: long enough to
// re-point a nested status's read and clear the list.
describe('the fresh-beacon check', () => {
  const ESC = '\u001b'
  const BEL = '\u0007'
  let renderer: ReactTestRenderer | null = null
  const seen: (string | null)[] = []

  function Probe({ agent }: { agent: string | null }): null {
    seen.push(useFreshNativeChatBeaconSession(getAgentHudBeacon('term-9'), agent, 'term-9'))
    return null
  }

  function show(agent: string | null) {
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { agent }))
      } else {
        renderer = create(createElement(Probe, { agent }))
      }
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_790_549_000_000 })
    resetAgentHudBeacons()
    resetBeaconWatches()
    seen.length = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('names the session of a beacon that beat within its window', () => {
    consumeAgentHudBeacons('term-9', `${ESC}]7777;CUIHUD1 agent=claude sid=${CLAUDE_SESSION} hb=5 model=m${BEL}`)
    show('claude')
    expect(seen.at(-1)).toBe(CLAUDE_SESSION)
  })

  it('never names a beacon silent past its window, not even on the first frame back', () => {
    consumeAgentHudBeacons('term-9', `${ESC}]7777;CUIHUD1 agent=claude sid=${CLAUDE_SESSION} hb=5 model=m${BEL}`)
    show('claude')
    // The tab shows another agent for a minute; the beacon says nothing.
    show(null)
    act(() => {
      vi.setSystemTime(1_790_549_060_000)
    })
    seen.length = 0
    show('claude')
    expect(seen).not.toContain(CLAUDE_SESSION)
  })
})
