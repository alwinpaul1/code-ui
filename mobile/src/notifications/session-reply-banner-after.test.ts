import * as Notifications from 'expo-notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionReplyIo, SessionReplyOutcome } from './session-reply-response'

vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: vi.fn(async () => 'scheduled'),
  dismissNotificationAsync: vi.fn(async () => undefined),
  getPresentedNotificationsAsync: vi.fn(async () => [])
}))
vi.mock('react-native', () => ({ AppState: { currentState: 'background' }, Platform: { OS: 'android', Version: 34 } }))
vi.mock('./session-reply-response', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-reply-response')>()
  return { ...actual, replyToSessionFromNotification: vi.fn() }
})

import { answerSessionReplyFromResponse } from './session-reply-answer'
import { replyToSessionFromNotification } from './session-reply-response'

const IDENTIFIER = 'codeui:host-1:wt-1'
const REPLY_CATEGORY = 'codeui-permission-session-reply=reply(Reply to Claude):Reply'

function response(data: Record<string, unknown> = {}) {
  return {
    actionIdentifier: 'session-reply',
    userText: 'thanks, one more thing',
    notification: {
      request: {
        identifier: IDENTIFIER,
        content: {
          title: 'repo / main · Claude finished',
          body: 'Added the retry budget.',
          data: { hostId: 'host-1', worktreeId: 'wt-1', paneKey: 'tab-1:leaf-1', notificationId: 'n-1', ...data },
          categoryIdentifier: REPLY_CATEGORY
        }
      }
    }
  }
}
const IO = {} as SessionReplyIo

function outcome(next: SessionReplyOutcome) {
  vi.mocked(replyToSessionFromNotification).mockResolvedValueOnce(next)
}
function presented(...banners: { identifier: string; notificationId?: string }[]) {
  vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue(
    banners.map(({ identifier, notificationId }) => ({
      request: { identifier, content: { data: notificationId === undefined ? {} : { notificationId } } }
    })) as never
  )
}
const posted = () =>
  vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0] as unknown as {
    content: { categoryIdentifier?: string; body: string }
  }

beforeEach(() => {
  vi.clearAllMocks()
  presented({ identifier: IDENTIFIER, notificationId: 'n-1' })
})

// A reply whose words went to the outbox for the chat (no link, or the tab runs no session yet) is
// not retried from the banner: the chat sends it when it is opened, and a second Reply typed into
// the same banner would be a second copy of the message (reviewer, 2026-10-14: the drainer sends
// the second and the chat's recovery then sends the first, which is already in the transcript).
describe('the banner after a reply whose words were kept for the chat', () => {
  it.each(['generic', 'needs-reauth', 'device-locked'] as const)(
    'has no Reply field left to type a second copy into, after %s',
    async (failure) => {
      outcome({ kind: 'failed', failure, kept: true })
      await answerSessionReplyFromResponse(response(), IO)
      expect(posted().content.categoryIdentifier).toBeUndefined()
    }
  )

  it('still says why, on top of the banner’s own words', async () => {
    outcome({ kind: 'failed', failure: 'generic', kept: true })
    await answerSessionReplyFromResponse(response(), IO)
    expect(posted().content.body).toBe('Couldn’t send. Tap to open.\nAdded the retry budget.')
  })

  it('keeps the Reply field when the words were not kept, so they can be typed again', async () => {
    outcome({ kind: 'failed', failure: 'generic', kept: false })
    await answerSessionReplyFromResponse(response(), IO)
    expect(posted().content.categoryIdentifier).toBe(REPLY_CATEGORY)
  })

  it('drops the Reply field when the session cannot take messages at all', async () => {
    outcome({ kind: 'failed', failure: 'refused', kept: false })
    await answerSessionReplyFromResponse(response(), IO)
    expect(posted().content.categoryIdentifier).toBeUndefined()
  })
})

// Settling a reply takes a few round trips, and every banner on a worktree shares one identifier
// (`codeui:<host>:<worktree>`). A newer banner that took the identifier meanwhile (a permission to
// approve from another tab, a push) is not the one that was answered, and must be left alone.
describe('a newer banner that took the identifier while the reply was being settled', () => {
  it('is not dismissed when the reply reached the outbox', async () => {
    presented({ identifier: IDENTIFIER, notificationId: 'n-2' })
    outcome({ kind: 'queued' })
    await answerSessionReplyFromResponse(response(), IO)
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled()
  })

  it('is not replaced by the old banner with a failure line on it', async () => {
    presented({ identifier: IDENTIFIER, notificationId: 'n-2' })
    outcome({ kind: 'failed', failure: 'generic', kept: true })
    await answerSessionReplyFromResponse(response(), IO)
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled()
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('does not stop the answered banner being dismissed when it is still the one showing', async () => {
    outcome({ kind: 'queued' })
    await answerSessionReplyFromResponse(response(), IO)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(IDENTIFIER)
  })

  it('dismisses when the system cannot say which banner is showing', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockRejectedValue(new Error('no list'))
    outcome({ kind: 'queued' })
    await answerSessionReplyFromResponse(response(), IO)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(IDENTIFIER)
  })

  it('dismisses when the answered banner carries no notification id to tell it by', async () => {
    presented({ identifier: IDENTIFIER, notificationId: 'n-2' })
    outcome({ kind: 'queued' })
    const noId = response({ notificationId: undefined })
    await answerSessionReplyFromResponse(noId, IO)
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(IDENTIFIER)
  })
})
