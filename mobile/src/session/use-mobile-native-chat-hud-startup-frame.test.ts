import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { StartupFrameRead } from './claude-startup-frame'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))
const fakes = vi.hoisted(() => ({ startupFrame: null as unknown }))
vi.mock('./use-mobile-terminal-hud-observation', () => ({
  useMobileTerminalHudObservation: () => ({
    observation: null,
    refresh: async () => null,
    dialogOptions: null,
    terminalPermission: null,
    permissionDismissed: false,
    queuedMessages: [],
    sentPrompts: [],
    startupFrame: fakes.startupFrame
  })
}))
vi.mock('./use-host-rate-limits', () => ({ useHostAccountsSnapshot: () => null }))

import { peekStartupFramePair, resetStartupFramePairsForTests } from './claude-startup-frame-pair'
import { resetAgentHudBeacons } from './agent-hud-beacon'
import { clearStickyLiveHudForTests } from './use-sticky-live-hud'
import { useMobileNativeChatHud } from './use-mobile-native-chat-hud'

const OPUS: StartupFrameRead = { model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' }
const SONNET: StartupFrameRead = { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'medium' }
const handleRef = { current: 'term-1' as string | null }

describe("the chat HUD files the startup frame the screen showed under the session on screen", () => {
  let renderer: ReactTestRenderer | null = null
  function Harness(p: { sessionId: string | null; agent?: string }) {
    useMobileNativeChatHud({
      client: {} as RpcClient,
      enabled: true,
      handleRef,
      scopeKey: 'scope',
      tabId: 'tab-1',
      sessionId: p.sessionId,
      agent: p.agent ?? 'claude',
      phase: 'idle'
    })
    return null
  }
  const render = (p: { sessionId: string | null; agent?: string }) =>
    act(() => {
      if (renderer) {
        renderer.update(createElement(Harness, p))
      } else {
        renderer = create(createElement(Harness, p))
      }
    })

  beforeEach(() => {
    resetStartupFramePairsForTests()
    resetAgentHudBeacons()
    clearStickyLiveHudForTests()
    fakes.startupFrame = null
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps a frame read before the session id arrived, once it does', () => {
    fakes.startupFrame = OPUS
    render({ sessionId: null })
    expect(peekStartupFramePair('s-1')).toBeNull()
    render({ sessionId: 's-1' })
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  it("does not file the old session's frame under the session a `claude -c` moves the terminal to", () => {
    fakes.startupFrame = OPUS
    render({ sessionId: 's-1' })
    render({ sessionId: 's-2' })
    expect(peekStartupFramePair('s-2')).toBeNull()
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
    // The new process paints its own frame: that one is the new session's.
    fakes.startupFrame = SONNET
    render({ sessionId: 's-2' })
    expect(peekStartupFramePair('s-2')).toMatchObject(SONNET)
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  it('lets a second claude that resumes the same session id replace its pair with the frame it paints', () => {
    fakes.startupFrame = OPUS
    render({ sessionId: 's-1' })
    fakes.startupFrame = SONNET
    render({ sessionId: 's-1' })
    expect(peekStartupFramePair('s-1')).toMatchObject(SONNET)
  })

  it('drops a frame still waiting for a session id when it leaves the screen, so a later id inherits nothing', () => {
    fakes.startupFrame = OPUS
    render({ sessionId: null })
    fakes.startupFrame = null
    render({ sessionId: null })
    render({ sessionId: 's-9' })
    expect(peekStartupFramePair('s-9')).toBeNull()
  })

  // The reviewer's R1: the observation resets on an `enabled` toggle or a reconnect and re-reads the frame
  // still on screen, which is the OLD session's.
  it("does not file the old session's frame, re-read after the observation reset, under the new session", () => {
    fakes.startupFrame = OPUS
    render({ sessionId: 's-1' })
    render({ sessionId: 's-2' })
    fakes.startupFrame = null
    render({ sessionId: 's-2' })
    fakes.startupFrame = { ...OPUS }
    render({ sessionId: 's-2' })
    expect(peekStartupFramePair('s-2')).toBeNull()
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  // The reviewer's R2: the same, after the chat is left and reopened.
  it("does not file the old session's frame under the new session after a remount of the chat", () => {
    fakes.startupFrame = OPUS
    render({ sessionId: 's-1' })
    render({ sessionId: 's-2' })
    act(() => renderer?.unmount())
    renderer = null
    fakes.startupFrame = { ...OPUS }
    render({ sessionId: 's-2' })
    expect(peekStartupFramePair('s-2')).toBeNull()
  })

  it('still files the frame of a tab attached while its frame is on screen (first sight, session known)', () => {
    fakes.startupFrame = OPUS
    render({ sessionId: 's-3' })
    expect(peekStartupFramePair('s-3')).toMatchObject(OPUS)
  })

  it('keeps the pair when later reads show no frame', () => {
    fakes.startupFrame = OPUS
    render({ sessionId: 's-1' })
    fakes.startupFrame = null
    render({ sessionId: 's-1' })
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  it("files nothing for another agent's tab", () => {
    fakes.startupFrame = OPUS
    render({ sessionId: 's-1', agent: 'codex' })
    expect(peekStartupFramePair('s-1')).toBeNull()
  })
})
