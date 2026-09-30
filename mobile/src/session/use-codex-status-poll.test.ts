import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { isCodexTerminalLocked } from './codex-terminal-lock'
import { useCodexStatusPoll } from './use-codex-status-poll'

const fakes = vi.hoisted(() => ({
  scrape: vi.fn(),
  scraped: false,
  readScreen: vi.fn(),
  typeCommand: vi.fn(),
  sleep: vi.fn(async () => {}),
  sendKey: vi.fn(async () => true)
}))
vi.mock('./codex-visible-models', () => ({
  codexVisibleModelsKey: (host: string, worktree: string) => host + worktree,
  hasScrapedCodexVisibleModels: () => fakes.scraped,
  scrapeCodexVisibleModels: fakes.scrape
}))
vi.mock('./codex-picker-apply', () => ({
  createCodexPickerIo: () => ({ ...fakes, now: () => Date.now() })
}))
// One connection throughout; codex-model-reader-after-reconnect.test.ts covers a new one.
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => 1
}))
const client = {} as RpcClient
const handleRef = { current: 'term' }
const deviceTokenRef = { current: 'device' }
const refreshHud = vi.fn(async () => {})
let renderer: ReactTestRenderer
function Harness({ working = false }: { working?: boolean }) {
  useCodexStatusPoll({
    client,
    enabled: true,
    working,
    hostId: 'h',
    worktreeId: 'w',
    handleRef,
    deviceTokenRef,
    handleKey: 'term',
    refreshHud
  })
  return null
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
describe('Codex model discovery scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    fakes.scraped = false
    fakes.readScreen.mockResolvedValue([
      '› Ask Codex to do anything',
      '  gpt-6-astra medium · ~/Project'
    ])
    fakes.typeCommand.mockResolvedValue(false)
    fakes.scrape.mockImplementation(async () => {
      fakes.scraped = true
      return []
    })
  })
  afterEach(async () => {
    await act(async () => renderer?.unmount())
    vi.useRealTimers()
  })
  // The chat's screen read stands aside while a Codex driver holds the
  // terminal (2026-09-27), so a refresh asked for inside the lock read nothing
  // and a stale notice or a closed draft echo waited for the next poll.
  it("refreshes the chat's screen read once it has let go of the terminal", async () => {
    const lockedAtRefresh: boolean[] = []
    refreshHud.mockImplementation(async () => {
      lockedAtRefresh.push(isCodexTerminalLocked('term'))
    })
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await advance(0)
    expect(lockedAtRefresh).toEqual([false])
  })

  it('starts the first idle model read without the post-turn delay', async () => {
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await advance(0)
    expect(fakes.scrape).toHaveBeenCalledOnce()
  })
  it('retries an interrupted model read without requiring another turn or reopen', async () => {
    fakes.scrape.mockRejectedValueOnce(new Error('connection interrupted'))
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await advance(700)
    await advance(1000)
    expect(fakes.scrape).toHaveBeenCalledTimes(2)
  })
  it('cancels a scheduled retry when the chat unmounts', async () => {
    fakes.scrape.mockResolvedValue(null)
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await advance(0)
    expect(fakes.scrape).toHaveBeenCalledOnce()
    await act(async () => renderer.unmount())
    await advance(5000)
    expect(fakes.scrape).toHaveBeenCalledOnce()
  })
  it('does not type into a working agent', async () => {
    await act(async () => {
      renderer = create(createElement(Harness, { working: true }))
    })
    await advance(5000)
    expect(fakes.scrape).not.toHaveBeenCalled()
    expect(fakes.typeCommand).not.toHaveBeenCalled()
  })
  it('bounds retries when Codex cannot supply the list', async () => {
    fakes.scrape.mockResolvedValue(null)
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    await advance(10000)
    expect(fakes.scrape).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })
})
