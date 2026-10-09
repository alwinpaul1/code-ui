// Review of 34c021948 (2026-10-09), two findings confirmed by test:
//  - the look a send takes on its way back from the background could be minutes after the
//    Enter, so a review notice from LATER desktop activity, drawn under this send's own echo,
//    was read as this send's: the draft went back to the box for a message that went;
//  - "the app was in the background" was said for ANY time away, so a second away while the
//    link stayed down the whole wait blamed the app, not the link.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { noteAppForeground, resetAppForegroundClockForTests } from './app-foreground-clock'
import { AFTER_REVIEW_NOTICE } from './fixtures/claude-composer-2.1.287'
import { MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS } from './mobile-native-chat-send'
import { spentSendBudgetRefusal } from './mobile-native-chat-send-budget-refusal'
import { verifyClaudeSubmit } from './mobile-native-chat-submit-verify'

afterEach(() => {
  vi.useRealTimers()
  resetAppForegroundClockForTests()
})

describe('the look a send takes on its way back from the background', () => {
  it('counts its own echo as sent even with a later review notice on the screen', async () => {
    vi.useFakeTimers()
    const screen = ['❯ hello', ...AFTER_REVIEW_NOTICE]
    const client = {
      sendRequest: vi.fn(async () => ({
        id: 'r',
        ok: true,
        result: { terminal: { source: 'screen', tail: screen, draft: '' } },
        _meta: { runtimeId: 'r' }
      }))
    } as unknown as RpcClient
    const deadline = Date.now() + 15_000
    const verdict = verifyClaudeSubmit({ client, terminal: 't', text: 'hello', seenNonces: new Set(), deadline })
    // The app leaves before the first look and comes back after the send's budget.
    noteAppForeground(false)
    vi.setSystemTime(Date.now() + 60_000)
    noteAppForeground(true)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await verdict).toEqual({ kind: 'sent' })
  })
})

describe('a moment away is not what spent a send', () => {
  it('blames the desktop, not the app, when the app was away for under a write', () => {
    const now = 1_000_000
    const deadline = now + 1_000
    const tapped = deadline - MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS
    noteAppForeground(false, tapped + 3_000)
    noteAppForeground(true, tapped + 4_000)

    expect(spentSendBudgetRefusal('Message', deadline, now)).toBe(
      'Message not sent: your desktop did not answer within 15 s. Send it again'
    )
  })

  it('blames the app when it was away for a write or more', () => {
    const now = 1_000_000
    const deadline = now + 1_000
    const tapped = deadline - MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS
    noteAppForeground(false, tapped + 3_000)
    noteAppForeground(true, tapped + 5_000)

    expect(spentSendBudgetRefusal('Message', deadline, now)).toBe(
      'Message not sent: the app was in the background before it reached your desktop. Send it again'
    )
  })
})
