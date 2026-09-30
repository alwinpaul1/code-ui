import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { useCodexStatusPoll } from './use-codex-status-poll'

// The Codex model reader scrapes Codex's own /model picker for the list the
// sheet shows. It tried three times, a second apart, and then waited for a
// turn to end or the tab to change. When those three tries fell while the
// host was unreachable, nothing tried again once it connected, and the sheet
// said "Reading models from the agent" until a turn ended (review,
// 2026-09-30). The repo rule: nothing stays stale once the relay connects.

let lastConnectedAt: number | null = 1
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => lastConnectedAt
}))

// The picker scrape itself is Codex's; this pins when the reader runs.
const visible = vi.hoisted(() => ({ scraped: false, scrape: vi.fn() }))
vi.mock('./codex-visible-models', () => ({
  codexVisibleModelsKey: (host: string, worktree: string) => `${host}/${worktree}`,
  hasScrapedCodexVisibleModels: () => visible.scraped,
  scrapeCodexVisibleModels: visible.scrape
}))

// Codex 0.153.4 idle at its prompt (codex-picker-screen.test.ts).
const IDLE = ['• ok', '› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project']
let hostUp = false
const sendRequest = vi.fn(async (method: string): Promise<RpcResponse> => {
  if (!hostUp) {
    return { id: method, ok: false, error: { code: 'not_connected', message: 'host unreachable' } }
  }
  if (method === 'terminal.read') {
    return { id: method, ok: true, result: { terminal: { tail: IDLE, source: 'screen' } } }
  }
  return { id: method, ok: true, result: {} }
})
const client = { sendRequest } as unknown as RpcClient

function reads(): number {
  return sendRequest.mock.calls.filter(([method]) => method === 'terminal.read').length
}
function sends(): number {
  return sendRequest.mock.calls.filter(([method]) => method === 'terminal.send').length
}

let renderer: ReactTestRenderer | undefined
function Harness({ working }: { working: boolean }): null {
  useCodexStatusPoll({
    client,
    enabled: true,
    working,
    hostId: 'h',
    worktreeId: 'w',
    handleRef: { current: 'term' },
    deviceTokenRef: { current: null },
    handleKey: 'term',
    refreshHud: async () => undefined
  })
  return null
}

async function render(working = false): Promise<void> {
  await act(async () => {
    if (renderer) {
      renderer.update(createElement(Harness, { working }))
    } else {
      renderer = create(createElement(Harness, { working }))
    }
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  sendRequest.mockClear()
  visible.scrape.mockReset()
  visible.scrape.mockImplementation(async () => {
    visible.scraped = true
    return [{ slug: 'gpt-5.6-sol', description: '', isDefault: true, isCurrent: true }]
  })
  visible.scraped = false
  lastConnectedAt = 1
  hostUp = false
})

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
})

describe('the Codex model reader after the host comes back', () => {
  it('reads the models again when the host connects, after its three tries failed', async () => {
    await render()
    await advance(10_000)
    expect(reads()).toBe(3)
    expect(visible.scrape).not.toHaveBeenCalled()

    hostUp = true
    lastConnectedAt = 2
    await render()
    await advance(0)
    expect(reads()).toBeGreaterThan(3)
    expect(visible.scrape).toHaveBeenCalledOnce()
  })

  it('tries three times on the new connection, then stops until the next one', async () => {
    await render()
    await advance(10_000)
    lastConnectedAt = 2
    await render()
    await advance(10_000)
    expect(reads()).toBe(6)
    // Renders on the same connection start nothing.
    await render()
    await advance(10_000)
    expect(reads()).toBe(6)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not read again on a new connection once the models are known', async () => {
    hostUp = true
    await render()
    await advance(0)
    expect(visible.scrape).toHaveBeenCalledOnce()
    const before = reads()
    lastConnectedAt = 2
    await render()
    await advance(10_000)
    expect(reads()).toBe(before)
  })

  it('never reads or types into Codex while a turn runs, connection or not', async () => {
    await render(true)
    hostUp = true
    lastConnectedAt = 2
    await render(true)
    await advance(10_000)
    expect(reads()).toBe(0)
    expect(sends()).toBe(0)
    expect(visible.scrape).not.toHaveBeenCalled()
  })

  it('waits for a first connection when the tab opened before any', async () => {
    lastConnectedAt = null
    await render()
    await advance(10_000)
    expect(reads()).toBe(3)
    hostUp = true
    lastConnectedAt = 1
    await render()
    await advance(0)
    expect(visible.scrape).toHaveBeenCalledOnce()
  })
})
