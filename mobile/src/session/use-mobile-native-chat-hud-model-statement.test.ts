import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))
vi.mock('./use-host-rate-limits', () => ({ useHostAccountsSnapshot: () => null }))

import { resetAgentHudBeacons } from './agent-hud-beacon'
import type { ClaudeScreenModelStatement } from './claude-screen-model-statement'
import { resetStartupFramePairsForTests } from './claude-startup-frame-pair'
import { WIDE_TOAST_SONNET } from './fixtures/claude-model-toast-2.1.294'
import { WIDE_SPINNER_XHIGH } from './fixtures/claude-spinner-effort-2.1.294'
import { WORKING_0158 } from './fixtures/codex-composer-screens'
import { useMobileNativeChatHud } from './use-mobile-native-chat-hud'
import { clearStickyLiveHudForTests } from './use-sticky-live-hud'

// Driven through the REAL screen poll with Claude Code 2.1.294 captures
// (fixtures/claude-spinner-effort-2.1.294.ts, claude-model-toast-2.1.294.ts) and a Codex 0.158 one.
const handleRef = { current: 'term-1' as string | null }

describe("the screen poll's model statement", () => {
  let renderer: ReactTestRenderer | null = null
  let sendRequest: ReturnType<typeof vi.fn>
  let client: RpcClient
  let latest: ClaudeScreenModelStatement | null | undefined
  function Harness({ agent }: { agent: string }) {
    latest = useMobileNativeChatHud({ client, enabled: true, handleRef, scopeKey: 'scope', tabId: 'tab-1', sessionId: 's-1', agent, phase: 'working' })
      .modelStatement
    return null
  }
  const render = async (agent: string) => {
    await act(async () => {
      renderer = create(createElement(Harness, { agent }))
    })
  }
  const screen = (lines: readonly string[]) =>
    sendRequest.mockResolvedValue({ ok: true, result: { terminal: { lines, source: 'screen' } } })

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

  it("hands a Claude tab's spinner effort and toast to the pills", async () => {
    screen(WIDE_SPINNER_XHIGH)
    await render('claude')
    expect(latest).toEqual({ composer: true, spinner: true, effort: 'xhigh', toast: null })
    screen(WIDE_TOAST_SONNET)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(latest).toMatchObject({ spinner: false, toast: { model: 'claude-sonnet-5-5' } })
  })

  it('reads nothing of the kind on a Codex tab, even off a screen that would state it', async () => {
    screen(WORKING_0158)
    await render('codex')
    expect(latest).toBeNull()
    screen(WIDE_TOAST_SONNET)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(latest).toBeNull()
  })

  it('states nothing when the screen read fails', async () => {
    sendRequest.mockRejectedValue(new Error('relay closed'))
    await render('claude')
    expect(latest).toBeNull()
  })
})
