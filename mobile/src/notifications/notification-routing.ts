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
  /** The terminal pane (`<tabId>:<leafId>`) that raised it, so a tap opens that
   *  tab and not whichever one the workspace last had active. */
  paneKey?: string
  /** The structured agent session that raised it, for the same reason. */
  agentSessionId?: string
}

export type NotificationNavigationOptions = {
  knownHostIds?: ReadonlySet<string>
  credentialStatusByHostId?: ReadonlyMap<string, HostCredentialStatus>
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** One URI-encoded part of a desktop notification id, or null when it does not decode. */
function decodedIdPart(part: string | undefined): string | null {
  if (!part) {
    return null
  }
  try {
    return readNonEmptyString(decodeURIComponent(part))
  } catch {
    return null
  }
}

/** Which tab of the workspace raised a notification, read from the id the
 *  desktop gave it. The desktop sends no pane field (checked against Orca
 *  1.4.224's `dispatchMobileNotification`), but both of its agent lanes put the
 *  subject in the id, each part URI-encoded so a split on `:` is exact:
 *  - terminal: `agent:<worktreeId>:<paneKey>:<stateStartedAt>`
 *    (`buildAgentNotificationId`, src/shared/agent-notification-id.ts)
 *  - structured session: `agent-attention:<scope>:<sessionId>:…`
 *  An id naming a different workspace from the event's names no tab here: the
 *  tab would be looked for in the wrong workspace. */
export function notificationTabSubject(
  notificationId: string | null | undefined,
  worktreeId: string | null | undefined
): { paneKey: string } | { agentSessionId: string } | null {
  if (!notificationId) {
    return null
  }
  const parts = notificationId.split(':')
  if (parts[0] === 'agent' && parts.length === 4) {
    if (!worktreeId || decodedIdPart(parts[1]) !== worktreeId) {
      return null
    }
    const paneKey = decodedIdPart(parts[2])
    return paneKey ? { paneKey } : null
  }
  if (parts[0] === 'agent-attention' && parts.length >= 4) {
    const agentSessionId = decodedIdPart(parts[2])
    return agentSessionId ? { agentSessionId } : null
  }
  return null
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
  const subject = notificationTabSubject(event.notificationId, event.worktreeId)
  if (subject) {
    Object.assign(data, subject)
  }
  return data
}

/** The tab a tapped banner names: its stored field, else what its id says — a
 *  banner posted before the field existed is still in the tray after an update. */
function tappedTabSubject(
  record: Record<string, unknown>,
  worktreeId: string
): { paneKey: string } | { agentSessionId: string } | null {
  const paneKey = readNonEmptyString(record.paneKey)
  if (paneKey) {
    return { paneKey }
  }
  const agentSessionId = readNonEmptyString(record.agentSessionId)
  if (agentSessionId) {
    return { agentSessionId }
  }
  return notificationTabSubject(readNonEmptyString(record.notificationId), worktreeId)
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
    sessionTarget: worktreeId
      ? mobileSessionRouteTarget({ hostId, worktreeId, ...tappedTabSubject(record, worktreeId) })
      : null,
    ...(credentialStatus === 'missing'
      ? { credentialRecovery: 're-pair' as const }
      : credentialStatus === 'temporarily-unavailable'
        ? { credentialRecovery: 'retry' as const }
        : {})
  }
}
