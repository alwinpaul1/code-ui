// A send must not type when the host says it cannot show the screen, nor when a
// read fails on a host that has shown us its screen on this connection.
//
// Before: every failed read failed OPEN, because refusing sends to a host that
// cannot be read was judged the worse bug. That was right for an OLDER host
// (Orca 1.4.178-rc.2 has no `screen: true` handling and sends no `source`), and
// wrong for a current one: Orca 1.4.218 answers a screen request with
// `source: 'screen'` or `'screen-unavailable'` (readRenderedScreen: zero rows, no
// ptyId), so "unavailable" and a timeout on such a host are a failure NOW. A
// shell the agent exited to is exactly what a failed read hides
// (mobile-native-chat-send-without-composer.test.ts, reported 2026-10-02).
//
// Reply shapes: `source: 'screen'` is what every live read of Orca 1.4.218 on
// this machine returned (six tabs, 2026-10-02). `'screen-unavailable'` was NOT
// captured live; its shape is read from the 1.4.218 app.asar (`IOa` and
// `readRenderedScreen`), which sets nothing else on it. Claude Code 2.1.287
// screens from fixtures/claude-composer-2.1.287.ts and the exited-to-shell
// capture.

import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { EMPTY_COMPOSER } from './fixtures/claude-composer-2.1.287'
import {
  claudeExitedToShell,
  SHELL_PROMPTS
} from './fixtures/claude-exited-to-shell-2.1.287'
import {
  readSendUnderDialogRefusal,
  SEND_SCREEN_UNAVAILABLE_REFUSAL,
  SEND_SCREEN_UNREADABLE_REFUSAL,
  SEND_WITHOUT_COMPOSER_REFUSAL
} from './mobile-native-chat-dialog-guard'

const reply = (lines: string[], source: string | null = 'screen'): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { lines, ...(source === null ? {} : { source }) } },
  _meta: { runtimeId: 'r' }
})
/** What Orca 1.4.218 sends when it has no rows: no `lines`' content, its `tail` empty. */
const unavailable = (): RpcResponse => ({
  id: 'r',
  ok: true,
  result: { terminal: { handle: 'h', status: 'running', tail: [], source: 'screen-unavailable' } },
  _meta: { runtimeId: 'r' }
})
const rejected = (): RpcResponse => ({
  id: 'r',
  ok: false,
  error: { code: 'terminal_not_found', message: 'no' },
  _meta: { runtimeId: 'r' }
})

type Step = RpcResponse | Error
/** A client that answers its steps in order, the last one forever; `connectedAt` is the
 *  stamp a reconnect would move. */
function scripted(steps: Step[]) {
  let connectedAt = 1
  let at = 0
  const client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => connectedAt,
    sendRequest: vi.fn(async () => {
      const step = steps[Math.min(at, steps.length - 1)]!
      at += 1
      if (step instanceof Error) {
        throw step
      }
      return step
    })
  }
  return {
    client,
    reconnect: () => {
      connectedAt += 1
    },
    next: (more: Step[]) => {
      steps.splice(0, steps.length, ...more)
      at = 0
    }
  }
}

const look = (
  client: unknown,
  agent: string | null = 'claude',
  requireComposer = true
): Promise<string | null> =>
  readSendUnderDialogRefusal({
    client: client as RpcClient,
    terminal: 'term',
    agent,
    requireComposer
  } as Parameters<typeof readSendUnderDialogRefusal>[0])

describe('a send to a host that says it has no screen to show', () => {
  it('is refused, with its own words, and nothing is typed', async () => {
    const host = scripted([unavailable()])
    expect(await look(host.client)).toBe(SEND_SCREEN_UNAVAILABLE_REFUSAL)
    expect(SEND_SCREEN_UNAVAILABLE_REFUSAL).toBe(
      "The desktop has no screen to show for this terminal yet, so the message was not typed."
    )
  })

  it('reads once more first, and goes when the second read shows the box', async () => {
    const host = scripted([unavailable(), reply(EMPTY_COMPOSER)])
    expect(await look(host.client)).toBeNull()
    expect(host.client.sendRequest).toHaveBeenCalledTimes(2)
  })

  it('is refused for a shell on the second read, not for the first one', async () => {
    const host = scripted([unavailable(), reply(claudeExitedToShell(SHELL_PROMPTS.zsh))])
    expect(await look(host.client)).toBe(SEND_WITHOUT_COMPOSER_REFUSAL)
  })

  it('is left alone by a write that does not type words (no composer wanted)', async () => {
    const host = scripted([unavailable()])
    expect(await look(host.client, 'claude', false)).toBeNull()
  })

  it('is left alone for an agent whose composer the phone cannot locate', async () => {
    const host = scripted([unavailable()])
    expect(await look(host.client, 'openclaude')).toBeNull()
    expect(await look(host.client, null)).toBeNull()
  })
})

describe('a send when the screen read fails', () => {
  it.each([
    ['times out', new Error('timed out')],
    ['is rejected', rejected()],
    ['answers with no terminal object', { id: 'r', ok: true, result: {}, _meta: { runtimeId: 'r' } } as RpcResponse]
  ])('is refused when the read %s on a host that showed its screen earlier', async (_n, failure) => {
    const host = scripted([reply(EMPTY_COMPOSER)])
    expect(await look(host.client)).toBeNull()
    host.next([failure])
    expect(await look(host.client)).toBe(SEND_SCREEN_UNREADABLE_REFUSAL)
    expect(host.client.sendRequest).toHaveBeenCalledTimes(3) // one good read, then one try and one retry
  })

  it('goes when the retry of a timed-out read answers with the box', async () => {
    const host = scripted([reply(EMPTY_COMPOSER)])
    await look(host.client)
    host.next([new Error('timed out'), reply(EMPTY_COMPOSER)])
    expect(await look(host.client)).toBeNull()
  })

  it('goes on the first send of a connection, which no read has answered yet', async () => {
    const host = scripted([new Error('timed out')])
    expect(await look(host.client)).toBeNull()
  })

  it('goes to a host that has only ever sent a stream tail, with no `source` (an older Orca)', async () => {
    const host = scripted([reply(claudeExitedToShell(SHELL_PROMPTS.zsh), null)])
    expect(await look(host.client)).toBeNull()
    host.next([new Error('timed out')])
    expect(await look(host.client)).toBeNull()
  })

  it('forgets the host when the connection is a new one', async () => {
    const host = scripted([reply(EMPTY_COMPOSER)])
    await look(host.client)
    host.reconnect()
    host.next([new Error('timed out')])
    expect(await look(host.client)).toBeNull()
  })

  it('is left alone by a write that does not type words (no composer wanted)', async () => {
    const host = scripted([reply(EMPTY_COMPOSER)])
    await look(host.client)
    host.next([new Error('timed out')])
    expect(await look(host.client, 'claude', false)).toBeNull()
  })

  it('names what failed, and what to do', () => {
    expect(SEND_SCREEN_UNREADABLE_REFUSAL).toBe(
      "Couldn't read the desktop screen, so the message was not typed. Send again."
    )
  })
})
