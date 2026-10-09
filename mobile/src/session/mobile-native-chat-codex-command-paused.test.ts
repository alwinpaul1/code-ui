// 2026-10-09 ("it shows the send and then after some time when I go again it shows like
// message not send"): a Codex slash command typed key by key, with the app frozen in the
// background while a key was on the wire, came back with its budget spent and said a bare
// "Message not sent". The one line it leaves now says why.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { noteAppForeground, resetAppForegroundClockForTests } from './app-foreground-clock'
import { typeCodexChatCommand } from './mobile-native-chat-codex-command'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { ok } from './use-mobile-native-chat-image-attachments.test-support'

afterEach(() => {
  vi.useRealTimers()
  resetAppForegroundClockForTests()
  resetMobileNativeChatStaleInputForTests()
})

/** A Codex tab that takes every key; `onWrite` runs as each write arrives. */
function codexTab(onWrite: (nth: number) => void): { client: RpcClient; writes: number } {
  const tab = { client: null as unknown as RpcClient, writes: 0 }
  tab.client = {
    getState: () => 'connected',
    notifyForeground: vi.fn(),
    sendRequest: vi.fn(async () => {
      tab.writes += 1
      onWrite(tab.writes)
      return ok('s', { send: { accepted: true } })
    })
  } as unknown as RpcClient
  return tab
}

async function typeCommand(client: RpcClient): Promise<{ outcome: string; errors: string[] }> {
  const errors: string[] = []
  const typing = typeCodexChatCommand({
    client,
    terminal: 'term-1',
    command: '/model',
    deviceToken: null,
    onSendError: (message) => errors.push(message)
  })
  await vi.advanceTimersByTimeAsync(30_000)
  return { outcome: await typing, errors }
}

describe('a Codex command typed while the app leaves the foreground', () => {
  it('says the app was in the background when it froze mid-command', async () => {
    vi.useFakeTimers()
    const tab = codexTab((nth) => {
      if (nth === 2) {
        noteAppForeground(false)
        vi.setSystemTime(Date.now() + 60_000)
        noteAppForeground(true)
      }
    })

    expect(await typeCommand(tab.client)).toEqual({
      outcome: 'rejected',
      errors: ['Message not sent: the app was in the background before it reached your desktop. Send it again']
    })
  })

  it('types the whole command when the app stays in the foreground', async () => {
    vi.useFakeTimers()
    const tab = codexTab(() => {})

    expect(await typeCommand(tab.client)).toEqual({ outcome: 'accepted', errors: [] })
  })
})
