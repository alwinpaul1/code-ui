import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { LOGO_FRAME, SCROLLED_PAST } from './fixtures/claude-startup-frame-2.1.290-modelled'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

// MODELLED screens (fixtures/claude-startup-frame-2.1.290-modelled.ts).
const handleRef = { current: 'terminal' }
let renderer: ReactTestRenderer | null = null
let seen: ReturnType<typeof useMobileTerminalHudObservation> | null = null
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

async function mount(agent: string, lines: string[]) {
  const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { terminal: { lines, source: 'screen' } } })
  // One client for every render: a new object each time restarts the poll's effect.
  const client = { sendRequest } as unknown as RpcClient
  function Harness() {
    seen = useMobileTerminalHudObservation({ client, enabled: true, active: true, handleRef, handleKey: 'terminal', agent })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  return { sendRequest }
}

describe("the screen poll reads a Claude tab's startup frame", () => {
  it('states the model and effort the frame on screen shows', async () => {
    vi.useFakeTimers()
    await mount('claude', LOGO_FRAME)
    expect(seen?.startupFrame).toEqual({ model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' })
  })

  it('holds it when a later read has scrolled past the frame', async () => {
    vi.useFakeTimers()
    const { sendRequest } = await mount('claude', LOGO_FRAME)
    sendRequest.mockResolvedValue({ ok: true, result: { terminal: { lines: SCROLLED_PAST, source: 'screen' } } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(seen?.startupFrame).toEqual({ model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' })
  })

  it('reads nothing for a screen with no frame', async () => {
    vi.useFakeTimers()
    await mount('claude', SCROLLED_PAST)
    expect(seen?.startupFrame).toBeNull()
  })

  it('reads nothing for a Codex tab, whose startup box is not this frame', async () => {
    vi.useFakeTimers()
    await mount('codex', LOGO_FRAME)
    expect(seen?.startupFrame).toBeNull()
  })
})
