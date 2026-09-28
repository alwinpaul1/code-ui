import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  nativeChatStatusReadingLogLine,
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

  it.each([
    ['the kept turn is running', 'working' as const, 'mid-turn'],
    ['nothing has said how the kept turn stands', null, 'turn-unknown']
  ])('keeps the session when a new one names its transcript while %s', (_label, keptTurn, reason) => {
    const reading = read({ keptTurn, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT }, state: 'working' })
    expect(reading).toMatchObject({ kind: 'nested', read: KEPT, reason: { kind: reason } })
  })

  it('moves to a new session naming its transcript once the kept turn has ended', () => {
    expect(read({ keptTurn: 'ended', providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })).toMatchObject({
      kind: 'own',
      sessionId: NEXT_SESSION,
      switched: { from: CLAUDE_SESSION, why: "76ba8f2f's turn had ended" }
    })
  })

  it('does not take a session boundary as a finished turn of the new session', () => {
    const reading = read({
      keptTurn: 'working',
      providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT },
      state: 'done',
      sessionBoundary: true
    })
    expect(reading.kind).toBe('nested')
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

  it('hears the kept session’s turn end from its transcript stream, and then lets a new session in', () => {
    show({ state: 'working', providerSession: { id: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT } })
    const next = { state: 'done', sessionBoundary: true, providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } }
    show(next)
    expect(latest?.kind).toBe('nested')

    act(() => {
      readNativeChatStreamFrame({ type: 'appended', messages: [], lifecycle: { state: 'completed' } }, 'claude', CLAUDE_SESSION)
    })
    expect(latest).toMatchObject({ kind: 'own', sessionId: NEXT_SESSION })
  })

  it('takes a prompt marker on the transcript stream as the turn running again', () => {
    show({ state: 'done', providerSession: { id: CLAUDE_SESSION, transcriptPath: CLAUDE_TRANSCRIPT } })
    act(() => {
      readNativeChatStreamFrame({ type: 'appended', messages: [], lifecycle: { state: 'working' } }, 'claude', CLAUDE_SESSION)
    })
    show({ state: 'working', providerSession: { id: NEXT_SESSION, transcriptPath: NEXT_TRANSCRIPT } })
    expect(latest).toMatchObject({ kind: 'nested', reason: { kind: 'mid-turn' } })
  })

  it('hands an absent or markerless frame back untouched, and hears nothing from it', () => {
    expect(readNativeChatStreamFrame(undefined, 'claude', CLAUDE_SESSION)).toBeUndefined()
    const frame = { type: 'snapshot', messages: [] }
    expect(readNativeChatStreamFrame(frame, 'claude', CLAUDE_SESSION)).toBe(frame)
    expect(readNativeChatStreamFrame({ type: 'snapshot', lifecycle: { state: 'bogus' } }, null, null)).toMatchObject({ type: 'snapshot' })
  })
})
