import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

// The chat's queue box, handed over with whether the read behind it could see
// the box at all. Before a watch's first read lands (a reconnect, another
// tab), the observation handed an empty box as if it had read one, and the
// queue-box witness took every message it had listed for taken (review of the
// per-entry echo rewrite, 2026-09-30).

function captured(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8')
    .split('\n')
    .filter((row) => !row.startsWith('# '))
}
/** Claude Code 2.1.278 idle, tmux: the composer is up and nothing is queued. */
const IDLE = captured('claude-screen-task-completions-2.1.278.txt')
/** Claude Code 2.1.283's Bash permission prompt over the composer. */
const PERMISSION = captured('claude-screen-subagent-bash-permission-2.1.283.txt')
/** The 2.1.263 capture's queue, with the hint Orca publishes as the draft. */
const QUEUED = ['✻ Working…', '', '  ❯ bravo short second', '────────', '❯', '────────']
const HINT = 'Press up to edit queued messages'

let renderer: ReactTestRenderer | null = null
let observation: ReturnType<typeof useMobileTerminalHudObservation>
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})
/** The next once-a-second poll while the agent works. */
const nextPoll = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })

function harness() {
  vi.useFakeTimers()
  let answer: (value: unknown) => void = () => undefined
  const sendRequest = vi.fn(
    () =>
      new Promise((resolve) => {
        answer = resolve
      })
  )
  const client = { sendRequest } as unknown as RpcClient
  const handleRef = { current: 'terminal-a' }
  function Harness({ enabled, handleKey }: { enabled: boolean; handleKey: string }) {
    observation = useMobileTerminalHudObservation({ client, enabled, active: true, handleRef, handleKey, agent: 'claude' })
    return null
  }
  const render = async (enabled: boolean, handleKey = 'terminal-a') => {
    handleRef.current = handleKey
    await act(async () => {
      const element = createElement(Harness, { enabled, handleKey })
      if (renderer) {
        renderer.update(element)
      } else {
        renderer = create(element)
      }
    })
  }
  const land = async (tail: string[], draft?: string) => {
    await act(async () => answer({ ok: true, result: { terminal: { source: 'screen', tail, draft } } }))
  }
  return { render, land, answer: (value: unknown) => act(async () => answer(value)) }
}

describe('the queue box the chat is handed', () => {
  it('is unread, not empty, until a watch’s first read lands, after a reconnect and on another tab', async () => {
    const { render, land } = harness()
    await render(true)
    expect(observation.queueReadable).toBe(false)
    await land(QUEUED, HINT)
    expect(observation).toMatchObject({ queuedMessages: ['bravo short second'], queueReadable: true })
    // The link drops, and comes back: nothing is read until the next read.
    await render(false)
    expect(observation).toMatchObject({ queuedMessages: [], queueReadable: false })
    await render(true)
    expect(observation).toMatchObject({ queuedMessages: [], queueReadable: false })
    await land(QUEUED, HINT)
    expect(observation).toMatchObject({ queuedMessages: ['bravo short second'], queueReadable: true })
    // Another tab: unread until its own first read, which finds an idle box.
    await render(true, 'terminal-b')
    expect(observation).toMatchObject({ queuedMessages: [], queueReadable: false })
    await land(IDLE)
    expect(observation).toMatchObject({ queuedMessages: [], queueReadable: true })
  })

  it('is unread while a permission prompt covers the composer, and read again once it is gone', async () => {
    const { render, land } = harness()
    await render(true)
    await land(QUEUED, HINT)
    await nextPoll()
    await land(PERMISSION)
    expect(observation).toMatchObject({ queuedMessages: [], queueReadable: false })
    await nextPoll()
    await land(IDLE)
    expect(observation).toMatchObject({ queuedMessages: [], queueReadable: true })
  })

  // The failure path: a read that fails says nothing, and leaves the last one.
  it('keeps the last read box when a read fails', async () => {
    const { render, land, answer } = harness()
    await render(true)
    await land(QUEUED, HINT)
    await nextPoll()
    await answer({ ok: false, error: { message: 'timed out' } })
    expect(observation).toMatchObject({ queuedMessages: ['bravo short second'], queueReadable: true })
  })
})
