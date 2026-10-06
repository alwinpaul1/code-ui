import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))
vi.mock('./use-host-rate-limits', () => ({ useHostAccountsSnapshot: () => null }))

import { resetAgentHudBeacons } from './agent-hud-beacon'
import { peekStartupFramePair, resetStartupFramePairsForTests } from './claude-startup-frame-pair'
import { LOGO_FRAME, SCROLLED_PAST } from './fixtures/claude-startup-frame-2.1.290-modelled'
import { useMobileNativeChatHud } from './use-mobile-native-chat-hud'
import { clearStickyLiveHudForTests } from './use-sticky-live-hud'

// Driven through the REAL screen observation, not a faked null: the frame is on screen when the tab
// knows no session, scrolls off, and only then does the session id arrive. MODELLED screens.
const handleRef = { current: 'term-1' as string | null }

describe('a frame that waited for its session id and left the screen first', () => {
  let renderer: ReactTestRenderer | null = null
  let sendRequest: ReturnType<typeof vi.fn>
  let client: RpcClient
  function Harness({ sessionId }: { sessionId: string | null }) {
    useMobileNativeChatHud({ client, enabled: true, handleRef, scopeKey: 'scope', tabId: 'tab-1', sessionId, agent: 'claude', phase: 'idle' })
    return null
  }
  const render = async (sessionId: string | null) => {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, { sessionId }))
      } else {
        renderer = create(createElement(Harness, { sessionId }))
      }
    })
  }
  const screen = (lines: string[]) => sendRequest.mockResolvedValue({ ok: true, result: { terminal: { lines, source: 'screen' } } })

  beforeEach(() => {
    vi.useFakeTimers()
    resetStartupFramePairsForTests()
    resetAgentHudBeacons()
    clearStickyLiveHudForTests()
    sendRequest = vi.fn()
    client = { sendRequest } as unknown as RpcClient
  })
  afterEach(async () => {
    await act(async () => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('files nothing under the id that arrives after the frame has scrolled off', async () => {
    screen(LOGO_FRAME)
    await render(null)
    screen(SCROLLED_PAST)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    await render('s-late')
    expect(peekStartupFramePair('s-late')).toBeNull()
  })

  it('files the frame under the id that arrives while it is still on screen', async () => {
    screen(LOGO_FRAME)
    await render(null)
    await render('s-prompt')
    expect(peekStartupFramePair('s-prompt')).toMatchObject({ model: 'claude-opus-5', effort: 'xhigh' })
  })
})
