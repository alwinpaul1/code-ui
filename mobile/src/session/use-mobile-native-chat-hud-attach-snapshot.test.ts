import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))
// The screen shows no frame in any of these: the banner has scrolled off it.
vi.mock('./use-mobile-terminal-hud-observation', () => ({
  useMobileTerminalHudObservation: () => ({
    observation: null,
    refresh: async () => null,
    dialogOptions: null,
    terminalPermission: null,
    permissionDismissed: false,
    queuedMessages: [],
    sentPrompts: [],
    startupFrame: null
  })
}))
vi.mock('./use-host-rate-limits', () => ({ useHostAccountsSnapshot: () => null }))
const scans = vi.hoisted(() => ({ count: 0 }))
vi.mock('./claude-startup-frame-snapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./claude-startup-frame-snapshot')>()
  return {
    ...actual,
    startupFrameFromAttachSnapshot: (serialized: string) => {
      scans.count += 1
      return actual.startupFrameFromAttachSnapshot(serialized)
    }
  }
})

import { peekStartupFramePair, rememberStartupFramePair, resetStartupFramePairsForTests } from './claude-startup-frame-pair'
import { noteAttachSnapshot, resetAttachSnapshotsForTests } from './claude-startup-frame-snapshot'
import { resetAgentHudBeacons } from './agent-hud-beacon'
import { clearStickyLiveHudForTests } from './use-sticky-live-hud'
import { useMobileNativeChatHud } from './use-mobile-native-chat-hud'

// REAL snapshots (claude-startup-frame-snapshot.test.ts says how they were captured:
// Claude Code 2.1.294 through Orca 1.4.222's own headless emulator and serializer).
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8')
const SCROLLED_OFF = fixture('claude-attach-snapshot-2.1.294-scrolled-off.ansi')
const SECOND_CLAUDE = fixture('claude-attach-snapshot-2.1.294-second-claude.ansi')
const NO_BANNER = SCROLLED_OFF.split('\r\n').slice(-40).join('\r\n')
const OPUS_HIGH = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'high' }
const SONNET = { model: 'claude-sonnet-5-5', label: 'Sonnet 5.5', effort: null }

const HANDLE = 'term-1'
const handleRef = { current: HANDLE as string | null }
const snapshot = (serialized: string, extra: Record<string, unknown> = {}) =>
  act(() => noteAttachSnapshot(HANDLE, { type: 'scrollback', serialized, cols: 140, rows: 40, ...extra }))

describe('the chat HUD files the startup frame of an attach snapshot under the session on screen', () => {
  let renderer: ReactTestRenderer | null = null
  function Harness(p: { sessionId: string | null; agent?: string | null }) {
    useMobileNativeChatHud({
      client: {} as RpcClient,
      enabled: true,
      handleRef,
      scopeKey: 'scope',
      tabId: 'tab-1',
      sessionId: p.sessionId,
      agent: p.agent === undefined ? 'claude' : p.agent,
      phase: 'idle'
    })
    return null
  }
  const render = (p: { sessionId: string | null; agent?: string | null }) =>
    act(() => {
      if (renderer) {
        renderer.update(createElement(Harness, p))
      } else {
        renderer = create(createElement(Harness, p))
      }
    })

  beforeEach(() => {
    resetStartupFramePairsForTests()
    resetAttachSnapshotsForTests()
    resetAgentHudBeacons()
    clearStickyLiveHudForTests()
    scans.count = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('reads the effort from a banner that has scrolled off the screen but is in the attach snapshot', () => {
    render({ sessionId: 's-1' })
    snapshot(SCROLLED_OFF)
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS_HIGH)
  })

  it('files a snapshot that arrived before the chat mounted', () => {
    snapshot(SCROLLED_OFF)
    render({ sessionId: 's-1' })
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS_HIGH)
  })

  it('files the newest of two banners (a second claude in the same terminal)', () => {
    render({ sessionId: 's-2' })
    snapshot(SECOND_CLAUDE)
    expect(peekStartupFramePair('s-2')).toMatchObject(SONNET)
  })

  it('waits for the session id before filing, and files under the one that arrives', () => {
    render({ sessionId: null })
    snapshot(SCROLLED_OFF)
    expect(scans.count).toBe(0)
    render({ sessionId: 's-1' })
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS_HIGH)
  })

  it('leaves a stored pair alone when the snapshot has no banner', () => {
    rememberStartupFramePair('s-1', OPUS_HIGH)
    render({ sessionId: 's-1' })
    snapshot(NO_BANNER)
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS_HIGH)
  })

  it('files nothing for an empty snapshot', () => {
    render({ sessionId: 's-1' })
    snapshot('')
    expect(peekStartupFramePair('s-1')).toBeNull()
  })

  it('does not scan the snapshot of a terminal that is not Claude', () => {
    render({ sessionId: 's-1', agent: 'codex' })
    snapshot(SCROLLED_OFF)
    render({ sessionId: 's-1', agent: null })
    expect(scans.count).toBe(0)
    expect(peekStartupFramePair('s-1')).toBeNull()
  })

  it('does not scan a snapshot taken on the alternate screen, where the normal rows run into the fullscreen ones', () => {
    render({ sessionId: 's-1' })
    snapshot(SCROLLED_OFF, { alternateScreen: true })
    expect(scans.count).toBe(0)
    expect(peekStartupFramePair('s-1')).toBeNull()
  })

  it('scans a snapshot once, not on every render', () => {
    render({ sessionId: 's-1' })
    snapshot(SCROLLED_OFF)
    render({ sessionId: 's-1' })
    render({ sessionId: 's-1' })
    expect(scans.count).toBe(1)
  })

  it("does not file the old session's banner under the session a `/clear` or `claude -c` moves the terminal to, when a reconnect resends it", () => {
    render({ sessionId: 's-1' })
    snapshot(SCROLLED_OFF)
    render({ sessionId: 's-2' })
    snapshot(SCROLLED_OFF)
    expect(peekStartupFramePair('s-2')).toBeNull()
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS_HIGH)
  })
})
