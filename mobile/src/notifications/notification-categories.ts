import { NOTIFICATION_STATUS_ICONS } from './notification-status-icon'

/**
 * The two kinds of Code notification, named after the Claude Android app's (tl8.java:1173-1521):
 * "Code updates" (nvm.CODE) and "Code permission requests" (nvm.CODE_REQUIRES_ACTION). A session
 * waiting on an approval or an answer is a permission request: its banner carries a permission or
 * a question to answer, or the host called it "needs input" and the banner drew the question icon.
 * Everything else (a session that finished, a terminal bell) is an update.
 *
 * The app's two toggles for them were on this phone's Notifications screen until 2026-10-16, when
 * the user asked for Code notifications to be always on. Both kinds are always shown now; "Agent
 * notifications" is the one switch. What older builds stored under `orca:notificationCategories`
 * is no longer read.
 */

export type NotificationCategory = 'updates' | 'permission-requests'

/** What the content a banner is built from says about it. */
export type CategorisableContent = { data?: Record<string, unknown> | null }

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

export function notificationCategoryOf(content: CategorisableContent): NotificationCategory {
  const data = content.data ?? {}
  if (
    isNonEmptyString(data.permissionKey) ||
    isNonEmptyString(data.questionKey) ||
    data.statusIcon === NOTIFICATION_STATUS_ICONS.question
  ) {
    return 'permission-requests'
  }
  return 'updates'
}
