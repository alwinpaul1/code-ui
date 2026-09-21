import { beforeEach, describe, expect, it, vi } from 'vitest'

const dismissed: string[] = []
const presented: { identifier: string; request: { content: { data?: unknown } } }[] = []

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  deleteNotificationChannelAsync: vi.fn(async () => {}),
  setNotificationChannelAsync: vi.fn(async () => {}),
  scheduleNotificationAsync: vi.fn(
    async (request: { identifier?: string; content: { data?: unknown } }) => {
      const identifier = request.identifier ?? 'generated'
      presented.push({ identifier, request: { content: request.content } })
      return identifier
    }
  ),
  dismissNotificationAsync: vi.fn(async (identifier: string) => {
    dismissed.push(identifier)
  }),
  getAllScheduledNotificationsAsync: vi.fn(async () => []),
  getPresentedNotificationsAsync: vi.fn(async () => presented)
}))
vi.mock('./notification-permissions', () => ({
  ensureNotificationPermissions: vi.fn(async () => true)
}))
vi.mock('../storage/preferences', () => ({
  loadPushNotificationsEnabled: vi.fn(async () => true)
}))

const { showLocalNotification, dismissLocalNotification } = await import(
  './local-notification-scheduling'
)

function event(notificationId: string, body: string) {
  return {
    type: 'notification' as const,
    source: 'agent' as const,
    title: 'Claude',
    body,
    worktreeId: 'wt-a',
    notificationId
  }
}

/**
 * One banner per session means every notification in a session shares an
 * identifier, and the newer one replaces the older in the tray. The dismiss path
 * still held the old notification's state, pointing at that shared identifier —
 * so answering the FIRST prompt at the desk cleared the banner that was by then
 * carrying the SECOND one, and the reader never saw it.
 *
 * Introduced with the one-banner-per-session change; before it, identifiers were
 * unique and a stale dismiss could only ever hit its own banner.
 */
describe('dismissing a notification a newer one has replaced', () => {
  beforeEach(() => {
    dismissed.length = 0
    presented.length = 0
  })

  it('does not clear the banner that is now showing a newer notification', async () => {
    await showLocalNotification(event('n-1', 'Claude needs input'), 'host-a')
    await showLocalNotification(event('n-2', 'Claude finished'), 'host-a')

    // The desktop answers the FIRST prompt; its dismiss arrives late.
    await dismissLocalNotification({ notificationId: 'n-1' }, 'host-a')

    // The banner in the tray is n-2's. Clearing it would hide a message the
    // reader has not seen.
    const sessionBanner = 'codeui:host-a:wt-a'
    expect(dismissed).not.toContain(sessionBanner)
  })

  it('still clears the banner when the dismiss is for the notification on screen', async () => {
    await showLocalNotification(event('n-1', 'Claude needs input'), 'host-a')
    await dismissLocalNotification({ notificationId: 'n-1' }, 'host-a')
    expect(dismissed).toContain('codeui:host-a:wt-a')
  })
})
