// How long the send's look at the screen keeps trying before it refuses.
//
// 1. A slow relay. A host that has shown a screen and whose read then fails over ~2 s used to
//    be refused at once, where the write behind it waits for a reconnect within its 15 s
//    budget (mobile-native-chat-send-readiness.ts). A read that fails because the link is down
//    or re-dialing now waits for the link inside the same budget, less what the writes behind
//    it need, and reads again. It refuses only when the budget runs out, or the host answers
//    and cannot show the screen.
// 2. `screen-unavailable`. Orca 1.4.218 answers it when it has no rows to show: its provider
//    snapshot read serializes for up to 750 ms, then backs off for 1 s (`providerVisibleRetryAtByPtyId`),
//    and a terminal still drawing mid-turn can read as zero rows. The old 200 ms single retry fell
//    inside that window, so a live terminal could be refused. The retry now spans ~1.5 s.
// Both read from the 1.4.218 bundle; no live `screen-unavailable` reply was captured.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import {
  readSendUnderDialogRefusal,
  SEND_SCREEN_UNAVAILABLE_REFUSAL,
  SEND_SCREEN_UNREADABLE_REFUSAL
} from './mobile-native-chat-dialog-guard'

const screen = (lines: string[]): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { lines, source: 'screen' } },
  _meta: { runtimeId: 'r' }
})
const unavailable = (): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { tail: [], source: 'screen-unavailable' } },
  _meta: { runtimeId: 'r' }
})
const rejected = (): RpcResponse => ({
  id: 'r',
  ok: false,
  error: { code: 'terminal_not_found', message: 'no' },
  _meta: { runtimeId: 'r' }
})

/** A client whose answers come from `answer(elapsedMs)` and whose link state from `link(elapsedMs)`. */
function timed(
  answer: (elapsed: number) => RpcResponse | Error,
  link: (elapsed: number) => string = () => 'connected'
) {
  const origin = Date.now()
  const reads: number[] = []
  const client = {
    getState: () => link(Date.now() - origin),
    getLastConnectedAt: () => 1,
    notifyForeground: vi.fn(),
    sendRequest: vi.fn(async () => {
      const elapsed = Date.now() - origin
      reads.push(elapsed)
      if (link(elapsed) !== 'connected') {
        throw new Error('Connection closed')
      }
      const result = answer(elapsed)
      if (result instanceof Error) {
        throw result
      }
      return result
    })
  }
  return { client, reads, elapsed: () => Date.now() - origin }
}

const ask = async (client: unknown, budgetMs: number | undefined = 15_000) => {
  const deadline = budgetMs === undefined ? undefined : Date.now() + budgetMs
  const running = readSendUnderDialogRefusal({
    client: client as RpcClient,
    terminal: 'term',
    agent: 'claude',
    requireComposer: true,
    ...(deadline === undefined ? {} : { deadline })
  } as Parameters<typeof readSendUnderDialogRefusal>[0])
  await vi.runAllTimersAsync()
  return running
}

/** A host that has shown a screen on this connection. */
async function shownScreen(client: unknown): Promise<void> {
  expect(await ask(client)).toBeNull()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a read that fails because the link is down or re-dialing', () => {
  it('waits for the reconnect inside the send budget, then reads again and goes', async () => {
    // Up for the first send, down from 100 ms to 6 s, then back.
    const host = timed(() => screen(EMPTY_COMPOSER), (elapsed) => (elapsed > 100 && elapsed < 6_000 ? 'reconnecting' : 'connected'))
    await shownScreen(host.client)
    vi.setSystemTime(Date.now() + 200)

    const outcome = await ask(host.client)

    expect(outcome).toBeNull()
  })

  it('does not refuse on the first two failed reads of a slow relay', async () => {
    // Each read times out (~2 s) twice, the third answers.
    let timeouts = 0
    let slow = false
    const host = timed(() => {
      if (!slow) {
        return screen(EMPTY_COMPOSER)
      }
      timeouts += 1
      return timeouts <= 3 ? new Error('Request timed out') : screen(EMPTY_COMPOSER)
    })
    await shownScreen(host.client)
    slow = true

    expect(await ask(host.client)).toBeNull()
    expect(timeouts).toBeGreaterThanOrEqual(4)
  })

  it('refuses only once the budget, less the writes behind it, has run out', async () => {
    let linkUp = true
    const host = timed(() => screen(EMPTY_COMPOSER), () => (linkUp ? 'connected' : 'disconnected'))
    await shownScreen(host.client)
    linkUp = false

    const startedAt = Date.now()
    const outcome = await ask(host.client, 15_000)

    expect(outcome).toBe(SEND_SCREEN_UNREADABLE_REFUSAL)
    const waited = Date.now() - startedAt
    expect(waited).toBeGreaterThanOrEqual(10_000)
    expect(waited).toBeLessThanOrEqual(11_700)
  })

  it('still fails open on a host that never showed a screen, with no wait', async () => {
    const host = timed(() => new Error('Request timed out'))
    const startedAt = Date.now()
    expect(await ask(host.client)).toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(500)
  })

  it('has no budget to wait in when the send has almost none left: it refuses at once', async () => {
    const host = timed(() => screen(EMPTY_COMPOSER))
    await shownScreen(host.client)
    host.client.sendRequest.mockImplementation(async () => {
      throw new Error('Request timed out')
    })
    const startedAt = Date.now()
    expect(await ask(host.client, 3_000)).toBe(SEND_SCREEN_UNREADABLE_REFUSAL)
    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})

describe('a host that answers but has no screen to show right now', () => {
  it('is read again for about a second and a half before it is refused', async () => {
    const host = timed(() => unavailable())
    const outcome = await ask(host.client)

    expect(outcome).toBe(SEND_SCREEN_UNAVAILABLE_REFUSAL)
    const span = host.reads.at(-1)! - host.reads[0]!
    expect(span).toBeGreaterThanOrEqual(1_500)
    expect(span).toBeLessThanOrEqual(2_100)
    expect(host.reads.length).toBeGreaterThanOrEqual(4)
  })

  it.each([
    ['in the 1 s back-off after a failed snapshot', 1_000],
    ['after the 750 ms serialize window', 800],
    ['at the end of the span', 1_400]
  ])('goes when the screen comes back %s', async (_name, backAt) => {
    const host = timed((elapsed) => (elapsed < backAt ? unavailable() : screen(EMPTY_COMPOSER)))
    expect(await ask(host.client)).toBeNull()
  })

  it('reads a rejection the same way, on a host that has shown a screen', async () => {
    const host = timed(() => screen(EMPTY_COMPOSER))
    await shownScreen(host.client)
    host.client.sendRequest.mockImplementation(async () => rejected())
    const reads = host.client.sendRequest.mock.calls.length

    expect(await ask(host.client)).toBe(SEND_SCREEN_UNREADABLE_REFUSAL)
    expect(host.client.sendRequest.mock.calls.length - reads).toBeGreaterThanOrEqual(4)
  })

  it('is not read for longer than the budget allows', async () => {
    const host = timed(() => unavailable())
    const startedAt = Date.now()
    expect(await ask(host.client, 4_200)).toBe(SEND_SCREEN_UNAVAILABLE_REFUSAL)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(host.reads.length).toBeLessThanOrEqual(3)
  })
})
