// 2026-10-09 ("it shows the send and then after some time when I go again it shows like
// message not send"): a send waiting for the link while the app went to the background
// came back with its budget spent and blamed the desktop ("your desktop came back too late",
// "the connection … did not come back"). Android ran no timer while the app was away, so
// neither the wait nor the link's redial could run: the reason is the app.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { noteAppForeground, resetAppForegroundClockForTests } from './app-foreground-clock'
import { openMobileNativeChatSendBudget } from './mobile-native-chat-send'
import {
  mobileNativeChatSendUnreadyMessage,
  waitForMobileNativeChatSendable,
  type MobileNativeChatSendReadiness
} from './mobile-native-chat-send-readiness'

function link(): { client: RpcClient; up: () => void } {
  let state = 'disconnected'
  const client = {
    getState: () => state,
    notifyForeground: vi.fn(),
    getLastConnectedAt: () => 1
  } as unknown as RpcClient
  return { client, up: () => (state = 'connected') }
}

function said(readiness: MobileNativeChatSendReadiness): string | null {
  return readiness.ready ? null : mobileNativeChatSendUnreadyMessage('Message', readiness)
}

describe('a send that waited for the link while the app was in the background', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAppForegroundClockForTests()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetAppForegroundClockForTests()
  })

  async function waitWhile(during: (desk: ReturnType<typeof link>) => void) {
    const desk = link()
    const deadline = openMobileNativeChatSendBudget()
    const waiting = waitForMobileNativeChatSendable({
      read: () => ({ client: desk.client, sendable: desk.client.getState() === 'connected' }),
      deadline
    })
    await vi.advanceTimersByTimeAsync(300)
    during(desk)
    await vi.advanceTimersByTimeAsync(20_000)
    return waiting
  }

  it('says the app was in the background when the link was back but the budget was gone', async () => {
    const readiness = await waitWhile((desk) => {
      noteAppForeground(false)
      vi.setSystemTime(Date.now() + 60_000)
      noteAppForeground(true)
      desk.up()
    })

    expect(said(readiness)).toBe(
      'Message not sent: the app was in the background before it reached your desktop. Send it again'
    )
  })

  it('says the app was in the background when the link had not come back by then either', async () => {
    const readiness = await waitWhile(() => {
      noteAppForeground(false)
      vi.setSystemTime(Date.now() + 60_000)
      noteAppForeground(true)
    })

    expect(said(readiness)).toBe(
      'Message not sent: the app was in the background before it reached your desktop. Send it again'
    )
  })

  it('still blames the link when the app stayed in the foreground the whole wait', async () => {
    const readiness = await waitWhile(() => {})

    expect(said(readiness)).toBe(
      'Message not sent: the connection to your desktop dropped and did not come back within 11 s'
    )
  })

  it('still blames the link when the app was away only a moment of the wait (review, 2026-10-09)', async () => {
    const readiness = await waitWhile(() => {
      noteAppForeground(false)
      vi.setSystemTime(Date.now() + 1_000)
      noteAppForeground(true)
    })

    expect(said(readiness)).toBe(
      'Message not sent: the connection to your desktop dropped and did not come back within 11 s'
    )
  })

  it('does not count a time away that ended before the send began', async () => {
    noteAppForeground(false)
    noteAppForeground(true)
    vi.setSystemTime(Date.now() + 1_000)
    const readiness = await waitWhile(() => {})

    expect(said(readiness)).toBe(
      'Message not sent: the connection to your desktop dropped and did not come back within 11 s'
    )
  })
})
