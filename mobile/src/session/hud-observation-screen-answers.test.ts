import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { hostAnswersScreens } from './host-screen-answers'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

// The HUD poll reads the screen every second a tab is open, so what it hears is
// the cheapest proof that a host can show screens: a send whose own read then
// fails can be refused without the phone having to send once to find out
// (mobile-native-chat-send-unreadable-screen.test.ts). Orca 1.4.218 sets
// `source` on every reply to a screen request.

let renderer: ReactTestRenderer | null = null
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

async function pollOnce(result: unknown) {
  vi.useFakeTimers()
  const client = { sendRequest: vi.fn(async () => ({ ok: true, result })) } as unknown as RpcClient
  const handleRef = { current: 'terminal-a' }
  function Harness() {
    useMobileTerminalHudObservation({
      client,
      enabled: true,
      active: true,
      handleRef,
      handleKey: 'terminal-a',
      agent: 'claude'
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
    await vi.advanceTimersByTimeAsync(10)
  })
  return client
}

describe('a host the HUD poll has read a screen from', () => {
  it('counts as one that answers screens', async () => {
    const client = await pollOnce({ terminal: { source: 'screen', tail: ['❯'] } })
    expect(hostAnswersScreens(client)).toBe(true)
  })

  it('counts too when it says it has no screen to show', async () => {
    const client = await pollOnce({ terminal: { source: 'screen-unavailable', tail: [] } })
    expect(hostAnswersScreens(client)).toBe(true)
  })

  it('does not, when its reply names no source (an older host)', async () => {
    const client = await pollOnce({ terminal: { tail: ['❯'] } })
    expect(hostAnswersScreens(client)).toBe(false)
  })

  it('does not, when its reply is the stream', async () => {
    const client = await pollOnce({ terminal: { source: 'stream', tail: ['❯'] } })
    expect(hostAnswersScreens(client)).toBe(false)
  })
})
