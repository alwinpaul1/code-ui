import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

const SCREEN = [
  'Would you like to run the following command?',
  '  $ pnpm test',
  '› 1. Yes, proceed (y)',
  '  2. No, and tell Codex what to do differently (esc)',
  'Press enter to confirm or esc to cancel'
]
let renderer: ReactTestRenderer
let observation: ReturnType<typeof useMobileTerminalHudObservation>
const handleRef = { current: 'terminal' }
afterEach(async () => {
  await act(async () => renderer?.unmount())
  vi.useRealTimers()
})
describe('terminal approval observation', () => {
  it.each(['claude', 'codex'])(
    'refreshes an active %s queue within one second and clears consumed entries',
    async (agent) => {
      vi.useFakeTimers()
      const sendRequest = vi.fn().mockResolvedValue({
        ok: true,
        result: {
          terminal: {
            lines:
              agent === 'codex'
                ? [
                    '• Queued follow-up inputs',
                    '  ↳ desktop task',
                    '    alt + ↑ edit last queued message'
                  ]
                : ['Working', '', '❯ desktop task', '─────', '❯ Press up to edit queued messages']
          }
        }
      })
      const client = { sendRequest } as unknown as RpcClient
      function Harness() {
        observation = useMobileTerminalHudObservation({
          client,
          enabled: true,
          active: true,
          handleRef,
          handleKey: 'terminal',
          agent
        })
        return null
      }
      await act(async () => {
        renderer = create(createElement(Harness))
      })
      expect(observation.queuedMessages).toEqual(['desktop task'])
      sendRequest.mockResolvedValue({
        ok: true,
        result: { terminal: { lines: ['Running desktop task'] } }
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(observation.queuedMessages).toEqual([])
      expect(sendRequest).toHaveBeenCalledTimes(2)
    }
  )
  it('shows a Codex screen-only approval and removes it when the dialog closes', async () => {
    vi.useFakeTimers()
    const sendRequest = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { terminal: { lines: SCREEN } } })
    const client = { sendRequest } as unknown as RpcClient
    function Harness() {
      observation = useMobileTerminalHudObservation({
        client,
        enabled: true,
        handleRef,
        handleKey: 'terminal',
        agent: 'codex'
      })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    expect(observation.terminalPermission?.options[0]).toEqual({ label: 'Allow once', send: 'y' })
    sendRequest.mockResolvedValue({ ok: true, result: { terminal: { lines: ['Running tests'] } } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(observation.terminalPermission).toBeNull()
  })
})
