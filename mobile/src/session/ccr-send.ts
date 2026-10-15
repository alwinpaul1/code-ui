import { CCR_API_BASE_URL, CcrApiError, ccrSessionHeaders, getCcrSession, isCcrSessionId, postCcrJson, type CcrEvent } from './ccr-session-api'
import { CcrSignedOutError } from './ccr-link-history'
import type { CcrLinkDeps } from './ccr-session-link-types'

/** One `file_attachments` entry (`SessionFileAttachment`, `u7v`): what ccr-file-upload.ts returns. */
export type CcrFileAttachment = { file_uuid: string; file_name: string; is_image: boolean }

/**
 * Sending a Claude tab's message the way the Claude Android app 1.261009.20 does: through
 * Anthropic's sessions API into the tab's Remote Control session, not by typing into the desktop
 * terminal (the user, 2026-10-15: "send messages from anthropic api for that session transcript
 * like remote control not from terminal").
 *
 * Every behaviour below is the app's, read from its jadx output (class names are R8 pointers of
 * that build):
 *  - the request (`com.anthropic.claude.sessions.store.a`, `y2v`): POST
 *    `v1/code/sessions/{cse_id}/events`, body `{session_id, events: [{payload}]}`; a `session_…`
 *    id is written as `cse_…` in the path and the body; the user payload is
 *    `{type: "user", uuid, message: {role: "user", content: "<plain string>"}}`, with `priority`
 *    only on a steering (`"next"`) or post-later (`"later"`) send. A 2xx is the whole ack; the
 *    reply holds `results[{event_id, sequence_num, duplicate}]` (live, 2026-10-15 probe P1: 200,
 *    `event_id` equal to the posted uuid). There is no idempotency header: the uuid is the key.
 *  - the uuid is minted before anything is sent (`UUID.randomUUID()` in `rs8.F4`), and the echo
 *    on the stream (`client_event`, `payload.uuid`) clears the pending row by uuid, never by text
 *    (`qhu`, `o9a`).
 *  - the offline refusal (`rs8.G4` and the send lambda, rs8.java:4482 and :6103):
 *    `p230.j(session)` is true when the session is a bridge session (`azu.n`: no
 *    `environment_id`, no `self_hosted_runner_pool_id`, no `agent_id`) and its
 *    `connection_status` is `DISCONNECTED` (`ur9.y`); the app then shows
 *    `ccr_remote_control_offline_error` and sends nothing. `UNKNOWN`, `UNSPECIFIED` and an
 *    absent status are not refused.
 *
 * Nothing here logs or returns a token. A failure carries the stage, the HTTP status and a reason
 * word (ccr-session-api.ts `CcrApiError`).
 */

/** The app's `ccr_remote_control_offline_error`, word for word. */
export const CCR_REMOTE_CONTROL_OFFLINE = 'Remote control session is offline. Reconnect or run /remote-control to start a new session.'

export type CcrSendPriority = 'next' | 'later'

/** The app writes a `session_…` id as `cse_…` in the path and the body. */
export function ccrCseId(sessionId: string): string {
  return sessionId.startsWith('session_') ? `cse_${sessionId.slice('session_'.length)}` : sessionId
}

/** A v4 uuid in its dashed form: the server keys the event by it (`event_id` echoes it). */
export function newCcrEventUuid(random: () => number = Math.random): string {
  const native = globalThis.crypto?.randomUUID
  if (typeof native === 'function' && random === Math.random) {
    return native.call(globalThis.crypto)
  }
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/** The POST body for one user message, as `sessions.store.a` builds it. Attachments ride as
 *  `file_attachments` beside the plain-string text (`hu.java:627`: `new erw(uuid, text,
 *  attachments, …)`), only the ones that finished uploading, and the field is left out when there
 *  are none. */
export function buildCcrUserEventBody(args: { sessionId: string; uuid: string; text: string; priority?: CcrSendPriority; fileAttachments?: readonly CcrFileAttachment[] }): {
  session_id: string
  events: { payload: Record<string, unknown> }[]
} {
  const payload: Record<string, unknown> = { type: 'user', uuid: args.uuid, message: { role: 'user', content: args.text } }
  if (args.fileAttachments && args.fileAttachments.length > 0) {
    payload.file_attachments = args.fileAttachments.map((file) => ({ file_uuid: file.file_uuid, file_name: file.file_name, is_image: file.is_image }))
  }
  if (args.priority) {
    payload.priority = args.priority
  }
  return { session_id: ccrCseId(args.sessionId), events: [{ payload }] }
}

/** Whether the app would refuse a send for this connection status (`p230.j`). */
export function ccrSessionOffline(connectionStatus: string | null | undefined): boolean {
  return typeof connectionStatus === 'string' && connectionStatus.toLowerCase() === 'disconnected'
}

/** Whether the stream (or a history page) has carried the event posted under `uuid`. */
export function ccrEchoSeen(events: readonly CcrEvent[], uuid: string): boolean {
  return events.some((event) => event.payload.uuid === uuid)
}

/** The account's own sign-in, read again once after a 401 (as readCcrHistoryPage does). */
export async function withAccountAuth<T>(deps: Pick<CcrLinkDeps, 'auth'>, accountId: string, run: (auth: { token: string; organizationUuid: string }) => Promise<T>): Promise<T> {
  for (const fresh of [false, true]) {
    const auth = await deps.auth(accountId, fresh).catch(() => null)
    if (!auth) {
      throw new CcrSignedOutError()
    }
    try {
      return await run(auth)
    } catch (error) {
      if (fresh || !(error instanceof CcrApiError) || error.reason !== 'unauthorized') {
        throw error
      }
    }
  }
  throw new CcrSignedOutError()
}

/** Posts one events batch into `sessionId` with `accountId`'s own sign-in. Resolves on a 2xx. */
export async function postCcrSessionEvents(deps: Pick<CcrLinkDeps, 'auth' | 'fetch'>, accountId: string, sessionId: string, body: { session_id: string; events: readonly unknown[] }): Promise<void> {
  const id = ccrCseId(sessionId)
  if (!isCcrSessionId(id)) {
    throw new CcrApiError('events', 'malformed')
  }
  await withAccountAuth(deps, accountId, (auth) =>
    postCcrJson(deps.fetch, 'events', `${CCR_API_BASE_URL}/v1/code/sessions/${encodeURIComponent(id)}/events`, ccrSessionHeaders(auth.token, auth.organizationUuid), body)
  )
}

/** The session row's `connection_status`, read with `accountId`'s own sign-in (`GET v1/code/sessions/{id}`). */
export async function readCcrConnectionStatus(deps: Pick<CcrLinkDeps, 'auth' | 'fetch'>, accountId: string, sessionId: string): Promise<string | null> {
  const row = await withAccountAuth(deps, accountId, (auth) => getCcrSession(deps.fetch, auth, ccrCseId(sessionId)))
  return row.connectionStatus
}
