import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { busyScreen } from './fixtures/claude-busy-lead-tasks-2.1.296'
import { parseTerminalHudObservation } from './mobile-terminal-hud-parse'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

// The footer's zero must not outlive the footer (review of the tasks-claude branch,
// 2026-10-11). The hook keeps its last observation when a screen yields none, and a
// dialog over the footer yields none; the idle footer's "0 shells" then stood as a LIVE
// reading under the dialog and retired a shell launched just before it, once its 10 s
// grace passed. Under a dialog the count is unknown: the held reading (with its time,
// mobile-background-task-footer.ts) is what speaks for it, and it caps only shells
// launched before it was taken.

const reply = (lines: string[]) => ({ ok: true, result: { terminal: { source: 'screen', lines } } })

let renderer: ReactTestRenderer | null = null
let hud: ReturnType<typeof useMobileTerminalHudObservation>
const handleRef = { current: 'terminal' }

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

async function mount(sendRequest: ReturnType<typeof vi.fn>) {
  vi.useFakeTimers()
  const client = { sendRequest } as unknown as RpcClient
  function Harness() {
    hud = useMobileTerminalHudObservation({ client, enabled: true, active: false, handleRef, handleKey: 'terminal', agent: 'claude' })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
}

async function nextPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
}

describe("Claude's footer shell count while a dialog covers the footer", () => {
  it('drops the count instead of keeping the idle footer zero as a live reading', async () => {
    const dialog = busyScreen('screen-dialog-two-shells-one-agent.txt', { dropBlank: true })
    expect(parseTerminalHudObservation(dialog)).toBeNull()
    const sendRequest = vi.fn().mockResolvedValue(reply(busyScreen('screen-footer-no-count.txt', { dropBlank: true })))
    await mount(sendRequest)
    expect(hud.observation?.runningShellCount).toBe(0)

    sendRequest.mockResolvedValue(reply(dialog))
    await nextPoll()
    expect(hud.observation?.runningShellCount).toBeUndefined()

    sendRequest.mockResolvedValue(reply(busyScreen('screen-footer-one-shell.txt', { dropBlank: true })))
    await nextPoll()
    expect(hud.observation?.runningShellCount).toBe(1)
  })

  it('keeps the last count through a read that failed: that says nothing about the screen', async () => {
    const sendRequest = vi.fn().mockResolvedValue(reply(busyScreen('screen-footer-one-shell.txt', { dropBlank: true })))
    await mount(sendRequest)
    expect(hud.observation?.runningShellCount).toBe(1)
    sendRequest.mockRejectedValue(new Error('relay down'))
    await nextPoll()
    expect(hud.observation?.runningShellCount).toBe(1)
  })
})
