import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { repostBannerWithReplyVerdict, replyVerdictLine } from './question-reply-verdict'

vi.mock('expo-notifications', () => ({
  scheduleNotificationAsync: vi.fn(async () => 'scheduled-2'),
  dismissNotificationAsync: vi.fn(async () => undefined),
  getPresentedNotificationsAsync: vi.fn(async () => [
    { request: { identifier: 'codeui:host-1:wt-1' } }
  ])
}))
vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 }
}))

const BANNER = {
  notification: {
    date: 1,
    request: {
      identifier: 'codeui:host-1:wt-1',
      content: {
        title: 'Cleanup · NexOS / main',
        body: 'Which of these should I delete?\n1 Tier 1 caches · 2 Unreal Engine\nPick any that apply',
        data: { hostId: 'host-1', worktreeId: 'wt-1', questionKey: 'q', picks: {} },
        categoryIdentifier: 'codeui-permission-question:answer=reply(x):Answer'
      }
    }
  }
}

/**
 * After a reply typed into the shade, Android shows the text with a spinner
 * until the app updates or dismisses the notification. A reply that was sent
 * is cleared by the desktop's own dismiss when the agent moves on; one that
 * was NOT sent would spin for good, and the user would never learn why. So
 * the banner is posted again under its own identifier — the way the
 * single-banner scheduler replaces a session's banner — with the verdict on
 * its first line and everything else, buttons included, as it was.
 *
 * Not verified on a device (the reviewer flagged the spinner from the
 * platform's documented behaviour); what a refused reply looks like on the
 * S23 is the thing to check.
 */
describe('re-posting a banner after a reply that was not sent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(Platform, { OS: 'android', Version: 34 })
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([
      { request: { identifier: 'codeui:host-1:wt-1' } }
    ] as never)
  })

  it('replaces the banner under the same identifier with the verdict on top', async () => {
    await repostBannerWithReplyVerdict(BANNER, 'refused')
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('codeui:host-1:wt-1')
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'codeui:host-1:wt-1',
      content: {
        title: 'Cleanup · NexOS / main',
        body:
          `${replyVerdictLine('refused')}\n` +
          'Which of these should I delete?\n1 Tier 1 caches · 2 Unreal Engine\nPick any that apply',
        data: { hostId: 'host-1', worktreeId: 'wt-1', questionKey: 'q', picks: {} },
        categoryIdentifier: 'codeui-permission-question:answer=reply(x):Answer'
      },
      trigger: { channelId: 'orca-desktop' }
    })
  })

  it('says something different for each way a reply can fail', () => {
    const lines = (['refused', 'stale', 'failed', 'offline', 'unroutable'] as const).map(
      replyVerdictLine
    )
    expect(new Set(lines).size).toBe(4)
    expect(replyVerdictLine('refused')).toMatch(/2 or 1,3/)
    expect(replyVerdictLine('stale')).toMatch(/moved on/i)
    expect(replyVerdictLine('offline')).toBe(replyVerdictLine('unroutable'))
  })

  // A second refusal replaces the first verdict rather than stacking on it.
  it('does not stack verdicts on repeated refusals', async () => {
    await repostBannerWithReplyVerdict(BANNER, 'refused')
    const reposted = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]![0]!
    const again = {
      notification: {
        ...BANNER.notification,
        request: { ...BANNER.notification.request, content: reposted.content }
      }
    }
    await repostBannerWithReplyVerdict(again, 'stale')
    const second = vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[1]![0]!
    expect(second.content.body).toBe(
      `${replyVerdictLine('stale')}\n` +
        'Which of these should I delete?\n1 Tier 1 caches · 2 Unreal Engine\nPick any that apply'
    )
  })

  /**
   * The reply field can be open while the desktop's dismiss lands (the agent
   * was answered at the desk); the reply then submits, ends 'stale', and a
   * re-post would bring back a banner the desktop had just cleared, with
   * nothing to clear it again (review follow-up F9). A banner the OS is no
   * longer showing is left gone.
   */
  it('does not bring back a banner the OS is no longer showing', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockResolvedValue([] as never)
    await repostBannerWithReplyVerdict(BANNER, 'stale')
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled()
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled()
  })

  it('re-posts when the OS cannot say what it is showing', async () => {
    vi.mocked(Notifications.getPresentedNotificationsAsync).mockRejectedValue(new Error('no'))
    await repostBannerWithReplyVerdict(BANNER, 'refused')
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the OS refuses either call', async () => {
    vi.mocked(Notifications.dismissNotificationAsync).mockRejectedValueOnce(new Error('gone'))
    vi.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('no'))
    await expect(repostBannerWithReplyVerdict(BANNER, 'failed')).resolves.toBeUndefined()
  })
})
