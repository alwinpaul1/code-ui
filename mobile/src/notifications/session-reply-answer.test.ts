import * as Notifications from 'expo-notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionReplyIo, SessionReplyOutcome } from './session-reply-response'

vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: vi.fn(async () => 'scheduled'),
  dismissNotificationAsync: vi.fn(async () => undefined),
  getPresentedNotificationsAsync: vi.fn(async () => [{ request: { identifier: 'codeui:host-1:wt-1' } }])
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android', Version: 34 } }))
vi.mock('./session-reply-response', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-reply-response')>()
  return { ...actual, replyToSessionFromNotification: vi.fn() }
})

import { answerSessionReplyFromResponse } from './session-reply-answer'
import { replyToSessionFromNotification } from './session-reply-response'

const RESPONSE = {
  actionIdentifier: 'session-reply',
  userText: 'thanks, one more thing',
  notification: {
    request: {
      identifier: 'codeui:host-1:wt-1',
      content: {
        title: 'repo / main · Claude finished',
        body: 'Added the retry budget.',
        data: { hostId: 'host-1', worktreeId: 'wt-1', paneKey: 'tab-1:leaf-1' } as Record<string, unknown>,
        categoryIdentifier: 'codeui-permission-session-reply=reply(Reply to Claude):Reply'
      }
    }
  }
}
const IO = {} as SessionReplyIo

function outcome(next: SessionReplyOutcome) {
  vi.mocked(replyToSessionFromNotification).mockResolvedValueOnce(next)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// What happens to the banner once a reply typed into it is settled. Android shows the typed words
// with a spinner until the app updates or dismisses the notification (question-reply-verdict.ts):
// a reply that went to the outbox is done with, and one that did not says why, in the Claude app's
// own lines (session-reply-failure.ts), with the banner's buttons as they were.
describe('the banner after a reply from the shade', () => {
  it('goes away once the words are in the outbox', async () => {
    outcome({ kind: 'queued' })
    expect(await answerSessionReplyFromResponse(RESPONSE, IO)).toEqual({ kind: 'queued' })
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('codeui:host-1:wt-1')
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it.each([
    ['generic', 'Couldn’t send. Tap to open.'],
    ['needs-reauth', 'Couldn’t send — Claude needs to check it’s you. Tap to open, then send again.'],
    ['device-locked', 'Couldn’t send while your device was locked. Unlock, then send again.'],
    ['refused', 'You can’t send new messages here.']
  ] as const)('says %s in Claude’s own words, on top of the banner', async (failure, line) => {
    outcome({ kind: 'failed', failure, kept: true })
    await answerSessionReplyFromResponse(RESPONSE, IO)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('codeui:host-1:wt-1')
    const posted = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0] as unknown as {
      identifier: string
      content: { body: string; categoryIdentifier?: string; data: Record<string, unknown> }
    }
    expect(posted.identifier).toBe('codeui:host-1:wt-1')
    expect(posted.content.body).toBe(`${line}\nAdded the retry budget.`)
    // The words are kept for the chat (kept: true), so the Reply field goes: a second reply typed into
    // the banner would be a second copy of the message (session-reply-banner-after.test.ts).
    expect(posted.content.categoryIdentifier).toBeUndefined()
    expect(posted.content.data.replyVerdict).toBe(line)
  })

  it('does nothing for a tap that was not a reply', async () => {
    outcome({ kind: 'not-a-reply' })
    expect(await answerSessionReplyFromResponse(RESPONSE, IO)).toEqual({ kind: 'not-a-reply' })
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled()
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('hands the typed words and the banner’s data to the reply, and nothing else of the banner', async () => {
    outcome({ kind: 'queued' })
    await answerSessionReplyFromResponse(RESPONSE, IO)
    expect(replyToSessionFromNotification).toHaveBeenCalledWith({
      userText: 'thanks, one more thing',
      data: RESPONSE.notification.request.content.data,
      io: IO
    })
  })

  it('never throws, and shows the plain line, when the reply itself throws', async () => {
    vi.mocked(replyToSessionFromNotification).mockRejectedValueOnce(new Error('boom'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await answerSessionReplyFromResponse(RESPONSE, IO)
    warn.mockRestore()
    expect(result).toEqual({ kind: 'failed', failure: 'generic', kept: false })
    const posted = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0] as unknown as {
      content: { body: string }
    }
    expect(posted.content.body.startsWith('Couldn’t send. Tap to open.')).toBe(true)
  })
})
