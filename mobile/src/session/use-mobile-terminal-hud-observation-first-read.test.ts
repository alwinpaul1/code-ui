import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

// Reported 2026-10-09: the composer's model pill and effort came up slowly
// after opening a Claude chat. When the chat's first screen read failed (the
// relay still settling) or came back from the stream fallback instead of the
// live screen, nothing read the screen again until the idle poll, five seconds
// later. One quick retry now follows a first read that did not land; a host
// that stays down still costs one extra read, then the normal cadence.

// Claude Code 2.1.277's status area, verbatim (`orca terminal read --screen`,
// 2026-09-19; the same rows use-mobile-terminal-hud-observation-changes.test.ts reads).
const CLAUDE_STATUS_2_1_277 = [
  '────────────────────────────────────────────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────────────────────────────────────────────',
  '  [Opus 5 (1M context) xhigh | Max 20x] ██░░░░ 28% (275k/1.0M)',
  '  Usage ░░░░░░ 7% (resets 1:20 AM) | Weekly ██░░░░ 38% (resets Wed 7:00 PM)',
  '  ─────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×19 | ✓ Skill ×1'
]

const screen = (lines: string[]) => ({ ok: true, result: { terminal: { source: 'screen', lines } } })
const fallback = (lines: string[]) => ({ ok: true, result: { terminal: { source: 'stream', lines } } })

let renderer: ReactTestRenderer | null = null
let hud: ReturnType<typeof useMobileTerminalHudObservation>
const handleRef = { current: 'terminal' }

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

/** An idle Claude tab (one poll every 5 s) over `sendRequest`. */
async function mount(sendRequest: ReturnType<typeof vi.fn>): Promise<void> {
  vi.useFakeTimers()
  const client = { sendRequest } as unknown as RpcClient
  function Harness(): null {
    hud = useMobileTerminalHudObservation({
      client,
      enabled: true,
      active: false,
      handleRef,
      handleKey: 'terminal',
      agent: 'claude'
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("a Claude chat's first screen read", () => {
  it('reads the screen again after one second when the first read fails, not after the idle poll', async () => {
    const sendRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request timed out: terminal.read'))
      .mockResolvedValue(screen(CLAUDE_STATUS_2_1_277))
    await mount(sendRequest)
    expect(hud.observation).toBeNull()

    await advance(1_000)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(hud.observation).toMatchObject({ modelId: expect.stringMatching(/opus/i), effort: 'xhigh' })
  })

  it('reads again after one second when the host refuses the first read', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'unavailable', message: 'relay not ready' } })
      .mockResolvedValue(screen(CLAUDE_STATUS_2_1_277))
    await mount(sendRequest)
    await advance(1_000)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(hud.observation?.effort).toBe('xhigh')
  })

  it('reads again after one second when the first answer is the stream fallback, not the live screen', async () => {
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce(fallback(CLAUDE_STATUS_2_1_277))
      .mockResolvedValue(screen(CLAUDE_STATUS_2_1_277))
    await mount(sendRequest)
    expect(hud.observation).toBeNull()
    await advance(1_000)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(hud.observation?.effort).toBe('xhigh')
  })

  it('retries once only while the host stays down, then keeps the five-second cadence', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('Request timed out: terminal.read'))
    await mount(sendRequest)
    expect(sendRequest).toHaveBeenCalledTimes(1)
    await advance(1_000)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    // No retry of the retry: the next read is the idle poll's.
    await advance(3_999)
    expect(sendRequest).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(sendRequest).toHaveBeenCalledTimes(3)
    await advance(10_000)
    expect(sendRequest).toHaveBeenCalledTimes(5)
  })

  it('does not read again early after a first read that landed, even on a screen with nothing to parse', async () => {
    const sendRequest = vi.fn().mockResolvedValue(screen([]))
    await mount(sendRequest)
    await advance(4_999)
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('does not retry once the chat has stopped watching the terminal', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('Request timed out: terminal.read'))
    await mount(sendRequest)
    await act(async () => renderer?.unmount())
    renderer = null
    await advance(10_000)
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
})
