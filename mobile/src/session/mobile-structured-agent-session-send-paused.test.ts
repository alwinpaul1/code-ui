// 2026-10-09 ("it shows the send and then after some time when I go again it shows like
// message not send"): a chat-session send whose budget the app spent in the background said a
// bare "Message not sent". Nothing was sent, and the one line it leaves now says why.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { noteAppForeground, resetAppForegroundClockForTests } from './app-foreground-clock'
import { openMobileNativeChatSendBudget } from './mobile-native-chat-send'
import { sendMobileStructuredAgentSessionMessage } from './mobile-structured-agent-session-send'

afterEach(() => {
  vi.useRealTimers()
  resetAppForegroundClockForTests()
})

async function sendWithBudgetSpent(
  deadline: number
): Promise<{ outcome: string; errors: string[]; requests: number }> {
  const sendRequest = vi.fn()
  const errors: string[] = []
  const outcome = await sendMobileStructuredAgentSessionMessage({
    client: { sendRequest } as unknown as RpcClient,
    sessionId: 's',
    sessionKey: 'k',
    callerIdentity: 'phone',
    expectedRuntimeFence: 1,
    text: 'is everything fixed and done',
    attachments: [],
    deadline,
    onError: (message) => errors.push(message)
  })
  return { outcome, errors, requests: sendRequest.mock.calls.length }
}

describe('a chat-session send whose budget was spent before it went', () => {
  it('says the app was in the background when it was', async () => {
    vi.useFakeTimers()
    const deadline = openMobileNativeChatSendBudget()
    noteAppForeground(false)
    vi.setSystemTime(deadline - 1_000)
    noteAppForeground(true)

    expect(await sendWithBudgetSpent(deadline)).toEqual({
      outcome: 'rejected',
      errors: ['Message not sent: the app was in the background before it reached your desktop. Send it again'],
      requests: 0
    })
  })

  it('says the desktop did not answer when the app stayed in the foreground', async () => {
    expect(await sendWithBudgetSpent(Date.now() + 1_000)).toEqual({
      outcome: 'rejected',
      errors: ['Message not sent: your desktop did not answer within 15 s. Send it again'],
      requests: 0
    })
  })
})
