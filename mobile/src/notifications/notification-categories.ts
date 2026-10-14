import AsyncStorage from '@react-native-async-storage/async-storage'
import { NOTIFICATION_STATUS_ICONS } from './notification-status-icon'

/**
 * The two Code notification toggles of the Claude Android app (tl8.java:1173-1521):
 *
 *   "Code updates"             nvm.CODE                   "Get notified when Code sessions have
 *                                                          updates"
 *   "Code permission requests" nvm.CODE_REQUIRES_ACTION   "Get notified when Code sessions need
 *                                                          your approval to use a tool"
 *
 * Here each maps to a kind of notification the app already tells apart. A session waiting on an
 * approval or an answer is a permission request: its banner carries a permission or a question to
 * answer, or the host called it "needs input" and the banner drew the question icon. Everything
 * else (a session that finished, a terminal bell) is an update. The switch above them, "Agent
 * notifications", still turns all of it off.
 */

export type NotificationCategory = 'updates' | 'permission-requests'

export type NotificationCategoryPreferences = {
  /** Code updates. */
  updates: boolean
  /** Code permission requests. */
  permissionRequests: boolean
}

export const DEFAULT_NOTIFICATION_CATEGORIES: NotificationCategoryPreferences = {
  updates: true,
  permissionRequests: true
}

export const NOTIFICATION_CATEGORIES_STORAGE_KEY = 'orca:notificationCategories'

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

/** Each field on its own: an unknown value reads as on, because a notification that is lost to a
 *  value nobody can read is worse than one the reader meant to silence. */
export function parseNotificationCategories(raw: string | null): NotificationCategoryPreferences {
  let parsed: unknown = null
  try {
    parsed = raw === null ? null : JSON.parse(raw)
  } catch {
    parsed = null
  }
  const record: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {}
  return {
    updates: typeof record.updates === 'boolean' ? record.updates : DEFAULT_NOTIFICATION_CATEGORIES.updates,
    permissionRequests:
      typeof record.permissionRequests === 'boolean'
        ? record.permissionRequests
        : DEFAULT_NOTIFICATION_CATEGORIES.permissionRequests
  }
}

/** What storage holds, or null when it cannot be read. */
async function readStored(): Promise<NotificationCategoryPreferences | null> {
  try {
    return parseNotificationCategories(await AsyncStorage.getItem(NOTIFICATION_CATEGORIES_STORAGE_KEY))
  } catch {
    return null
  }
}

/** For the Settings screen: what storage holds now. Storage that cannot be read reads as both
 *  on. */
export async function loadNotificationCategories(): Promise<NotificationCategoryPreferences> {
  return (await readStored()) ?? DEFAULT_NOTIFICATION_CATEGORIES
}

// The toggles a banner is held to are kept in memory, read once and changed through
// saveNotificationCategories. A banner is raised where nothing has warmed anything (a push
// delivered to a headless runtime), and a storage read that never answers must not hold every
// notification behind it: the delivery path already treats that as a hazard of its own
// (notification-delivery-ordering.test.ts). So the first read is waited for only briefly, and a
// banner that cannot learn the toggles in that time is shown: losing one the reader wanted is the
// worse of the two mistakes, and only a read slower than this on a cold start makes it.
const FIRST_READ_WAIT_MS = 75
let remembered: NotificationCategoryPreferences | null = null
let reading: Promise<NotificationCategoryPreferences | null> | null = null

function remember(): Promise<NotificationCategoryPreferences | null> {
  reading ??= readStored().then((value) => {
    if (value !== null && remembered === null) {
      remembered = value
    }
    reading = null
    return value
  })
  return reading
}

/** Starts the first read, so the first banner finds it done. Called where a host's notifications
 *  start (configureNotificationChannel). */
export function warmNotificationCategories(): void {
  if (remembered === null) {
    void remember()
  }
}

/** The toggles a banner is held to: the remembered ones, else a first read waited for briefly. */
export async function notificationCategoriesForBanner(): Promise<NotificationCategoryPreferences> {
  if (remembered !== null) {
    return remembered
  }
  const read = remember()
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIRST_READ_WAIT_MS)
  })
  try {
    return (await Promise.race([read, waited])) ?? DEFAULT_NOTIFICATION_CATEGORIES
  } finally {
    clearTimeout(timer)
  }
}

let writes: Promise<unknown> = Promise.resolve()

/** Changes some of the toggles. The whole record is written, behind every earlier write, so two
 *  quick changes cannot land out of order; the remembered copy changes at once. */
export function saveNotificationCategories(patch: Partial<NotificationCategoryPreferences>): Promise<void> {
  const known = remembered
  remembered = { ...(remembered ?? DEFAULT_NOTIFICATION_CATEGORIES), ...patch }
  const write = writes.then(async () => {
    // What storage holds; failing that, what the phone last knew; the defaults only when it knew
    // nothing. Storage that cannot be read must not turn a toggle the reader switched off back on.
    const base = (await readStored()) ?? known ?? DEFAULT_NOTIFICATION_CATEGORIES
    const next = { ...base, ...patch }
    remembered = next
    try {
      await AsyncStorage.setItem(NOTIFICATION_CATEGORIES_STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      // Refused: the Settings screen goes back to what storage holds, and so must a banner's copy.
      remembered = null
      throw error
    }
  })
  writes = write.catch(() => undefined)
  return write
}

/** Test-only: the remembered copy outlives a test; this is a process start. */
export function resetNotificationCategoriesForTests(): void {
  remembered = null
  reading = null
  writes = Promise.resolve()
}

/** Whether a banner of this category may be shown. */
export function categoryAllows(
  category: NotificationCategory,
  preferences: NotificationCategoryPreferences
): boolean {
  return category === 'updates' ? preferences.updates : preferences.permissionRequests
}

/** Whether the reader's toggles let this banner through. The Settings screen's own test notification
 *  is not a session and is never held back. */
export function categoryLetsThrough(
  source: string,
  content: CategorisableContent,
  preferences: NotificationCategoryPreferences
): boolean {
  return source === 'test' || categoryAllows(notificationCategoryOf(content), preferences)
}

/** Both toggles off: nothing can be shown, so the lookup that builds a banner is not made. */
export function allCategoriesOff(source: string, preferences: NotificationCategoryPreferences): boolean {
  return source !== 'test' && !preferences.updates && !preferences.permissionRequests
}
