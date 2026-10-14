import * as Notifications from 'expo-notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SESSION_REPLY_FAILURE_LINES,
  replyFailureLine,
  type SessionReplyFailure
} from './session-reply-failure'
import {
  commentVerdictLine,
  repostBannerWithReplyVerdict,
  repostBannerWithVerdictLine,
  replyVerdictLine
} from './question-reply-verdict'

vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-2'),
  dismissNotificationAsync: vi.fn(async () => undefined),
  getPresentedNotificationsAsync: vi.fn(async () => [{ request: { identifier: 'codeui:host-1:wt-1' } }])
}))
vi.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  Platform: { OS: 'android', Version: 34 }
}))

const BANNER = {
  notification: {
    request: {
      identifier: 'codeui:host-1:wt-1',
      content: {
        title: 'repo / main · Claude finished',
        body: 'Added the retry budget.',
        data: { hostId: 'host-1', worktreeId: 'wt-1' } as Record<string, unknown>,
        categoryIdentifier: 'codeui-permission-session-reply=reply(Reply to Claude):Reply'
      }
    }
  }
}

// The Claude Android app's four failure lines for a reply from the shade
// (`tz8.java`: Generic, NeedsReauth, DeviceLocked, Refused; strings.xml
// notification_reply_send_failed*, notification_reply_send_refused, 1.261009.20). Typographic
// apostrophes and the em dash are the app's own.
describe('the four lines a failed reply can say', () => {
  it('are the Claude app’s words, character for character', () => {
    expect(SESSION_REPLY_FAILURE_LINES).toEqual({
      generic: 'Couldn’t send. Tap to open.',
      'needs-reauth': 'Couldn’t send — Claude needs to check it’s you. Tap to open, then send again.',
      'device-locked': 'Couldn’t send while your device was locked. Unlock, then send again.',
      refused: 'You can’t send new messages here.'
    })
  })

  it.each(Object.keys(SESSION_REPLY_FAILURE_LINES) as SessionReplyFailure[])('says %s with its own line', (failure) => {
    expect(replyFailureLine(failure)).toBe(SESSION_REPLY_FAILURE_LINES[failure])
  })
})

describe('what a Deny with comment that was not sent says', () => {
  it.each(['refused', 'failed', 'offline', 'unroutable'] as const)(
    'says Couldn’t send. Tap to open. for %s',
    (outcome) => {
      expect(commentVerdictLine(outcome)).toBe('Couldn’t send. Tap to open.')
    }
  )

  it('says the agent has moved on when the prompt is gone', () => {
    expect(commentVerdictLine('stale')).toBe('Comment not sent — the agent has moved on')
  })

  it('does not tell a comment to "use a number like 2 or 1,3", which is for a question’s answer', () => {
    expect(commentVerdictLine('refused')).not.toMatch(/number/)
  })

  it('keeps a question’s lines as they were', () => {
    expect(replyVerdictLine('refused')).toMatch(/use a number like 2 or 1,3/)
    expect(replyVerdictLine('stale')).toBe('Reply not sent — the agent has moved on')
  })
})

describe('posting the banner again with a failure line on top', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('puts the line first and keeps the words and the buttons of the banner', async () => {
    await repostBannerWithVerdictLine(BANNER, SESSION_REPLY_FAILURE_LINES.generic)
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'codeui:host-1:wt-1',
        content: expect.objectContaining({
          title: 'repo / main · Claude finished',
          body: 'Couldn’t send. Tap to open.\nAdded the retry budget.',
          categoryIdentifier: 'codeui-permission-session-reply=reply(Reply to Claude):Reply'
        })
      })
    )
  })

  it('replaces an earlier line instead of stacking a second above it', async () => {
    const first = SESSION_REPLY_FAILURE_LINES.generic
    const again = {
      notification: {
        request: {
          ...BANNER.notification.request,
          content: {
            ...BANNER.notification.request.content,
            body: `${first}\n${BANNER.notification.request.content.body}`,
            data: { ...BANNER.notification.request.content.data, replyVerdict: first }
          }
        }
      }
    }
    await repostBannerWithVerdictLine(again, SESSION_REPLY_FAILURE_LINES['device-locked'])
    const posted = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0] as {
      content: { body: string }
    }
    expect(posted.content.body).toBe('Couldn’t send while your device was locked. Unlock, then send again.\nAdded the retry budget.')
  })

  it('marks the banner with the line, so the native view draws its warning', async () => {
    await repostBannerWithVerdictLine(BANNER, SESSION_REPLY_FAILURE_LINES.refused)
    const posted = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0] as {
      content: { data: Record<string, unknown> }
    }
    expect(posted.content.data.replyVerdict).toBe('You can’t send new messages here.')
  })

  it('posts a comment’s failure through the same road, with its own words', async () => {
    await repostBannerWithReplyVerdict(BANNER, 'failed', 'comment')
    const posted = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0] as {
      content: { body: string }
    }
    expect(posted.content.body.startsWith('Couldn’t send. Tap to open.\n')).toBe(true)
  })

  it('posts nothing for a banner the system no longer shows', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValueOnce([])
    await repostBannerWithVerdictLine(BANNER, SESSION_REPLY_FAILURE_LINES.generic)
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
  })
})
