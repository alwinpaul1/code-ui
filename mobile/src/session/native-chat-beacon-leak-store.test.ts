import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const disk = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => disk.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      disk.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      disk.delete(key)
    })
  }
}))

import {
  consumeAgentHudBeacons,
  getAgentHudBeacon,
  hydrateAgentHudBeacons,
  parseAgentHudBeaconPayload,
  resetAgentHudBeacons,
  useAgentHudBeacon
} from './agent-hud-beacon'
import { encodeAgentHudChannelFrame } from './agent-hud-channel'
import { resetBeaconWatches } from './agent-hud-beacon-liveness'
import { readNativeChatTabStatus } from './native-chat-kept-session'
import { useFreshNativeChatBeaconSession } from './native-chat-kept-session-store'

// The store-level half of the leak recovery (2026-10-06): a frame for a session
// that is not the tab's holds the chat on that session only while its beacon is
// FRESH, and a warm-start restore is never fresh. Driven through the real hook,
// the real arrival clock (5 s checks over a 30 s window) and the real store.
const LEAKED = '00000000-0000-4000-8000-000000000000'
const REAL = '790eafa8-07b2-4380-abc2-90e22f965369'
const TRANSCRIPT = `/Users/x/.claude/projects/-p/${REAL}.jsonl`
const frame = (sid: string) => `CUIHUD1 agent=claude hk=1 hb=5 sid=${sid} model=claude-fable-5-1 name=Fable%205.1 effort=medium`
const HANDLE = 'term-leak'

describe('the chat after a beacon frame for a session that is not the tab’s', () => {
  let renderer: ReactTestRenderer | null = null
  const seen: (string | null)[] = []
  function Probe(): null {
    seen.push(useFreshNativeChatBeaconSession(useAgentHudBeacon(HANDLE), 'claude', HANDLE))
    return null
  }
  const mount = () =>
    act(() => {
      renderer = create(createElement(Probe))
    })
  const readChat = (painting: string | null) =>
    readNativeChatTabStatus({
      agent: 'claude',
      providerSession: { id: REAL, transcriptPath: TRANSCRIPT },
      kept: null,
      keptTurn: null,
      painting
    })
  const tick = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms)
    })

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_790_549_000_000 })
    disk.clear()
    resetAgentHudBeacons()
    resetBeaconWatches()
    seen.length = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('holds the chat on the leaked session while its beacon is fresh, then lets go after the 30 s window', () => {
    consumeAgentHudBeacons(HANDLE, encodeAgentHudChannelFrame(frame(LEAKED)))
    mount()
    expect(seen.at(-1)).toBe(LEAKED)
    expect(readChat(seen.at(-1)!)).toMatchObject({ kind: 'nested', read: { sessionId: LEAKED } })
    tick(20_000)
    expect(seen.at(-1)).toBe(LEAKED)
    tick(20_000)
    expect(seen.at(-1)).toBeNull()
    expect(readChat(seen.at(-1)!)).toMatchObject({ kind: 'own', sessionId: REAL })
  })

  it('is re-armed by each further frame, which is why a test run that kept leaking looked stuck', () => {
    consumeAgentHudBeacons(HANDLE, encodeAgentHudChannelFrame(frame(LEAKED)))
    mount()
    for (let i = 0; i < 4; i += 1) {
      tick(20_000)
      act(() => {
        consumeAgentHudBeacons(HANDLE, encodeAgentHudChannelFrame(`${frame(LEAKED)} used=${i}`))
      })
      expect(seen.at(-1)).toBe(LEAKED)
    }
    tick(40_000)
    expect(seen.at(-1)).toBeNull()
  })

  it('is replaced at once by the real session’s frame, with no waiting', () => {
    consumeAgentHudBeacons(HANDLE, encodeAgentHudChannelFrame(frame(LEAKED)))
    mount()
    act(() => {
      consumeAgentHudBeacons(HANDLE, encodeAgentHudChannelFrame(frame(REAL)))
    })
    expect(seen.at(-1)).toBe(REAL)
    expect(readChat(REAL)).toMatchObject({ kind: 'own', sessionId: REAL })
  })

  it('a warm-start restore of the leaked frame, after a relaunch, is never fresh and holds nothing', async () => {
    const leaked = parseAgentHudBeaconPayload(frame(LEAKED), Date.now())!
    disk.set('codeui:agent-hud-beacons.v2', JSON.stringify({ [HANDLE]: { ...leaked, desktopPrompts: [] } }))
    await hydrateAgentHudBeacons()
    expect(getAgentHudBeacon(HANDLE)?.sessionId).toBe(LEAKED)
    mount()
    tick(10_000)
    expect(seen.at(-1)).toBeNull()
    // Then the real session's first frame replaces it.
    act(() => {
      consumeAgentHudBeacons(HANDLE, encodeAgentHudChannelFrame(frame(REAL)))
    })
    expect(getAgentHudBeacon(HANDLE)?.sessionId).toBe(REAL)
  })
})
