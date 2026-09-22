import type { HostStackRouteTarget } from '../navigation/host-stack-navigation'
import { mobileSessionRouteTarget } from '../session/mobile-session-route'
import type { HostCredentialStatus } from '../transport/types'

export type DesktopNotificationSource = 'agent-task-complete' | 'terminal-bell' | 'test'

export type DesktopNotificationEvent = {
  source: DesktopNotificationSource
  worktreeId?: string
  notificationId?: string
}

export type LocalNotificationData = {
  source: DesktopNotificationSource
  hostId: string
  worktreeId?: string
  notificationId?: string
  /** Picture the Android shade draws as the large icon. Absent when the
   *  project has no image icon the phone has seen. */
  projectIcon?: string
}

export type NotificationNavigationOptions = {
  knownHostIds?: ReadonlySet<string>
  credentialStatusByHostId?: ReadonlyMap<string, HostCredentialStatus>
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function buildLocalNotificationData(
  event: DesktopNotificationEvent,
  hostId: string
): LocalNotificationData {
  const data: LocalNotificationData = {
    source: event.source,
    hostId
  }
  if (event.worktreeId) {
    data.worktreeId = event.worktreeId
  }
  if (event.notificationId) {
    data.notificationId = event.notificationId
  }
  return data
}

/** Where a tap should land. `sessionTarget` is null for a host-only notification, whose
 *  `/h/<id>` push is shallow enough to need no host-stack coordination. */
export type NotificationNavigationTarget = Readonly<{
  hostId: string
  sessionTarget: HostStackRouteTarget | null
  credentialRecovery?: 'retry' | 're-pair'
}>

export function notificationCredentialRecoveryRoute(
  target: NotificationNavigationTarget
): '/' | '/pair-scan' | null {
  if (target.credentialRecovery === 're-pair') {
    return '/pair-scan'
  }
  return target.credentialRecovery === 'retry' ? '/' : null
}

/** The shape of a tap this needs: the OS's request identifier and posting
 *  time, and the desktop's notification id when the banner carried one. */
export type NotificationTapResponse = {
  notification: {
    date: number
    request: { identifier: string; content: { data?: unknown } }
  }
}

/**
 * What identifies one tap for the dedup in the root layout.
 *
 * The dedup exists for one thing: at cold start the same response arrives
 * twice, once from `getLastNotificationResponse` and once from the listener.
 * Since 2026-09-15 every banner for a session is posted under ONE request
 * identifier (`codeui:<host>:<worktree>`), so a key on the identifier alone
 * turned the dedup into "one navigation per session for the app's life": the
 * first body tap opened the session, and every later tap on that session's
 * banner — a new question, a new completion — was swallowed (2026-09-18).
 *
 * The desktop's notification id changes with every posting and is already in
 * the data; the OS's posting time is the fallback for a banner without one.
 * Both stay equal for the two deliveries of one response.
 */
export function notificationTapKey(response: NotificationTapResponse): string {
  const { request, date } = response.notification
  const data = request.content.data
  const notificationId =
    data != null && typeof data === 'object'
      ? readNonEmptyString(Reflect.get(Object(data), 'notificationId'))
      : null
  return `${request.identifier}@${notificationId ?? `t${date}`}`
}

export function getNotificationNavigationTarget(
  data: unknown,
  options: NotificationNavigationOptions = {}
): NotificationNavigationTarget | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>
  const hostId = readNonEmptyString(record.hostId)
  if (!hostId) {
    return null
  }
  if (options.knownHostIds && !options.knownHostIds.has(hostId)) {
    return null
  }

  const worktreeId = readNonEmptyString(record.worktreeId)
  const credentialStatus = options.credentialStatusByHostId?.get(hostId)
  return {
    hostId,
    sessionTarget: worktreeId ? mobileSessionRouteTarget({ hostId, worktreeId }) : null,
    ...(credentialStatus === 'missing'
      ? { credentialRecovery: 're-pair' as const }
      : credentialStatus === 'temporarily-unavailable'
        ? { credentialRecovery: 'retry' as const }
        : {})
  }
}
