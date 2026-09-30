import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
                : [
                    'Working',
                    '',
                    '  ❯ desktop task',
                    '─────',
                    '❯ Press up to select a queued message, then Enter to edit it'
                  ]
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

it('retains the current approval while activity changes the polling cadence', async () => {
  vi.useFakeTimers()
  const sendRequest = vi
    .fn()
    .mockResolvedValue({ ok: true, result: { terminal: { lines: SCREEN } } })
  const client = { sendRequest } as unknown as RpcClient
  function Harness({ active }: { active: boolean }) {
    observation = useMobileTerminalHudObservation({
      client,
      enabled: true,
      active,
      handleRef,
      handleKey: 'terminal',
      agent: 'codex'
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness, { active: false }))
  })
  const permission = observation.terminalPermission
  expect(permission).not.toBeNull()
  sendRequest.mockReturnValue(new Promise(() => {}))
  await act(async () => renderer.update(createElement(Harness, { active: true })))
  expect(observation.terminalPermission).toBe(permission)
})

it('finds the live Claude queue when Orca extracts its hint into draft', async () => {
  const sendRequest = vi.fn().mockResolvedValue({
    ok: true,
    result: {
      terminal: {
        source: 'screen',
        tail: [
          '✢ Smooshing…',
          '  ❯ desktop alpha',
          '  ❯ desktop beta',
          '──────────────────',
          '❯',
          '──────────────────',
          '  auto mode on'
        ],
        draft: 'Press up to edit queued messages'
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
      agent: 'claude'
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  expect(observation.queuedMessages).toEqual(['desktop alpha', 'desktop beta'])
})

// Device, 2026-09-27 (session 790eafa8): the chat took the "Message from" rows
// its first screen read found for ones it had watched arrive, and drew them
// after its last row, under the lead's answer. The reader now says which read
// is the first since the chat began watching: none before it.
it('hands no peer rows until its first read since it began watching, and none again after it stops', async () => {
  let answer: (value: unknown) => void = () => undefined
  const sendRequest = vi.fn(
    () =>
      new Promise((resolve) => {
        answer = resolve
      })
  )
  const client = { sendRequest } as unknown as RpcClient
  const screen = { ok: true, result: { terminal: { source: 'screen', tail: ['› Message from @general-purpose (ctrl+o to expand)'] } } }
  function Harness({ enabled }: { enabled: boolean }) {
    observation = useMobileTerminalHudObservation({
      client,
      enabled,
      active: true,
      handleRef,
      handleKey: 'terminal',
      agent: 'claude'
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness, { enabled: true }))
  })
  expect(observation.peerNotices).toBeNull()
  await act(async () => answer(screen))
  expect(observation.peerNotices).toEqual([{ sender: 'general-purpose' }])
  await act(async () => renderer.update(createElement(Harness, { enabled: false })))
  expect(observation.peerNotices).toBeNull()
  await act(async () => renderer.update(createElement(Harness, { enabled: true })))
  expect(observation.peerNotices).toBeNull()
  await act(async () => answer(screen))
  expect(observation.peerNotices).toEqual([{ sender: 'general-purpose' }])
})

// 2026-09-30: back from the Files tab, or on a tab switch, the chat handed the
// task report an empty list of completion rows before the screen's first
// read. The screen-completion memory took that for the first run's row
// leaving the screen, met the same row again after a relaunch, counted it as
// the relaunch's own and retired a shell that still ran
// (use-active-tab-screen-completions.test.ts). An unread screen is not a
// screen without rows. Claude Code 2.1.278's rows, as captured with tmux.
const COMPLETIONS_2_1_278 = readFileSync(
  fileURLToPath(new URL('./fixtures/claude-screen-task-completions-2.1.278.txt', import.meta.url)),
  'utf8'
).split('\n')

describe('the completion rows the screen shows', () => {
  it.each([
    ['claude', [{ label: 'Short nap for a capture', status: 'completed' }, { label: 'A failing nap for a capture', status: 'failed' }]],
    ['codex', []]
  ] as const)('hands no %s rows, not an empty screen, until its first read of each terminal and after it stops', async (agent, rows) => {
    let answer: (value: unknown) => void = () => undefined
    const sendRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const client = { sendRequest } as unknown as RpcClient
    const screen = (tail: string[]) => ({ ok: true, result: { terminal: { source: 'screen', tail } } })
    const tabRef = { current: 'terminal-a' }
    function Harness({ enabled, handleKey }: { enabled: boolean; handleKey: string }) {
      observation = useMobileTerminalHudObservation({ client, enabled, active: true, handleRef: tabRef, handleKey, agent })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness, { enabled: true, handleKey: 'terminal-a' }))
    })
    expect(observation.taskCompletions).toBeNull()
    await act(async () => answer(screen(COMPLETIONS_2_1_278)))
    expect(observation.taskCompletions).toEqual(rows)

    // Another tab: unread until its own first read, which here finds none.
    tabRef.current = 'terminal-b'
    await act(async () => renderer.update(createElement(Harness, { enabled: true, handleKey: 'terminal-b' })))
    expect(observation.taskCompletions).toBeNull()
    await act(async () => answer(screen(['❯ '])))
    expect(observation.taskCompletions).toEqual([])

    // Back again: the rows it read there before are not handed over as now.
    tabRef.current = 'terminal-a'
    await act(async () => renderer.update(createElement(Harness, { enabled: true, handleKey: 'terminal-a' })))
    expect(observation.taskCompletions).toBeNull()

    // Stopped (the chat hidden, the link down), and watching again.
    await act(async () => renderer.update(createElement(Harness, { enabled: false, handleKey: 'terminal-a' })))
    expect(observation.taskCompletions).toBeNull()
    await act(async () => renderer.update(createElement(Harness, { enabled: true, handleKey: 'terminal-a' })))
    expect(observation.taskCompletions).toBeNull()
    await act(async () => answer(screen(COMPLETIONS_2_1_278)))
    expect(observation.taskCompletions).toEqual(rows)
  })

  it('keeps the screen unread when its first read fails', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: false, error: { message: 'no such terminal' } })
    const client = { sendRequest } as unknown as RpcClient
    function Harness() {
      observation = useMobileTerminalHudObservation({ client, enabled: true, active: true, handleRef, handleKey: 'terminal', agent: 'claude' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
    })
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(observation.taskCompletions).toBeNull()
  })
})

