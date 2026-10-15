import { CCR_API_BASE_URL, ccrSessionHeaders, type CcrFetch } from './ccr-session-api'
import type { CcrSendTarget } from './ccr-session-cache'
import { retitleCcrSessionFacts } from './ccr-session-facts'
import { defaultLog, type CcrAccountsSource, type CcrPipelineDeps } from './ccr-session-shared'
import { ccrCseId } from './ccr-send'

/**
 * Writes to a Claude Code session's own record on Anthropic, as the Claude Android app
 * 1.261013.20 makes them (jadx):
 *
 *  - Rename: `PUT v1/code/sessions/{id}` with UpdateSessionParams `{title, add_tags, remove_tags}`
 *    (ssv.java:183 builds `ozl.m(3, …)`, and method 3 is PUT in `kre.z`; uw00.java). The rename
 *    sheet's call (`drv.M0`, from wlx.java and o730.java) sets only `title`; the app writes a
 *    `session_…` id as `cse_…` (`no30.u`). The parity audit and the request said PATCH; the
 *    decompile says PUT, so that is what is sent and what probe P16 tries first.
 *  - Mark read: `POST v1/code/sessions/{cse_id}/mark_read` with MarkSessionReadRequest
 *    `{event_id}` (drv.java:3099, bqk/zpk.java), when a session is opened.
 *
 * Neither has been sent with the phone's per-account OAuth token, so both are behind
 * CCR_SESSION_WRITES, OFF until probe P16 (scratchpad/probe/p16-session-writes.cjs) shows them
 * accepted. While it is off, Rename keeps renaming the Orca workspace, the header keeps the worktree
 * name (use-ccr-session-header.ts), and nothing is marked read.
 *
 * Not built at all, because nothing proves the token may call them and nothing in Code UI needs
 * them yet: the list's live feed (`GET v1/code/sessions/watch`), Archive and Unarchive
 * (`POST …/archive`, `…/unarchive`) and Delete (`DELETE v1/code/sessions/{id}`).
 *
 * Nothing here logs a token. A failure leaves one line with the stage and the HTTP status.
 */
export const CCR_SESSION_WRITES = false

export type CcrSessionWriteDeps = {
  fetch: CcrFetch
  accounts: CcrAccountsSource
  log: (line: string) => void
}

export type CcrWriteRequest = { method: 'PUT' | 'POST'; path: string; body: Record<string, unknown> }

export function buildCcrRenameRequest(sessionId: string, title: string): CcrWriteRequest {
  return { method: 'PUT', path: `/v1/code/sessions/${encodeURIComponent(ccrCseId(sessionId))}`, body: { title: title.trim() } }
}

export function buildCcrMarkReadRequest(sessionId: string, eventId: string | null): CcrWriteRequest {
  return { method: 'POST', path: `/v1/code/sessions/${encodeURIComponent(ccrCseId(sessionId))}/mark_read`, body: eventId ? { event_id: eventId } : {} }
}

/** Sends one write with the target account's sign-in. Never throws: a failure is a line and false. */
async function sendCcrWrite(deps: CcrSessionWriteDeps, accountId: string, stage: string, request: CcrWriteRequest): Promise<boolean> {
  try {
    const account = (await deps.accounts.list(accountId)).find((entry) => entry.id === accountId)
    if (!account?.accessToken || !account.organizationUuid) {
      deps.log(`[ccr-write] ${stage} not sent: ${!account ? 'the account is no longer signed in' : !account.accessToken ? (account.error ?? 'no usable token') : 'no organization cached'}`)
      return false
    }
    const response = await deps.fetch(`${CCR_API_BASE_URL}${request.path}`, {
      method: request.method,
      headers: { ...ccrSessionHeaders(account.accessToken, account.organizationUuid), 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body)
    })
    if (!response.ok) {
      deps.log(`[ccr-write] ${stage} refused: HTTP ${response.status}`)
      return false
    }
    return true
  } catch (error) {
    deps.log(`[ccr-write] ${stage} failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

export type CcrRenameOutcome = 'renamed' | 'refused' | 'failed'

/** Renames the tab's own session. An empty name, or a tab with no target of its own, is refused
 *  without a request. A rename that landed retitles the header at once. */
export async function renameCcrSession(deps: CcrSessionWriteDeps, target: CcrSendTarget, title: string): Promise<CcrRenameOutcome> {
  const name = title.trim()
  if (name === '' || target.kind !== 'target') {
    return 'refused'
  }
  if (!(await sendCcrWrite(deps, target.accountId, 'rename', buildCcrRenameRequest(target.sessionId, name)))) {
    return 'failed'
  }
  retitleCcrSessionFacts(target.sessionId, name)
  return 'renamed'
}

/** Marks the tab's own session read up to `eventId` (the newest event the phone holds, or none). */
export async function markCcrSessionRead(deps: CcrSessionWriteDeps, target: CcrSendTarget, eventId: string | null): Promise<boolean> {
  if (target.kind !== 'target') {
    return false
  }
  return sendCcrWrite(deps, target.accountId, 'mark_read', buildCcrMarkReadRequest(target.sessionId, eventId))
}

/** The header menu's rename of the tab's session, with the app's own sign-ins (loaded on use). */
export async function renameCcrSessionFromHeader(
  session: { resolveTarget: () => CcrSendTarget },
  title: string,
  loadDeps: () => Promise<CcrPipelineDeps>
): Promise<CcrRenameOutcome> {
  try {
    const deps = await loadDeps()
    const log = deps.log ?? defaultLog
    return await renameCcrSession({ fetch: deps.fetch, accounts: deps.accounts, log: (line) => log(line, false) }, session.resolveTarget(), title)
  } catch (error) {
    console.warn(`[ccr-write] rename failed: ${error instanceof Error ? error.message : String(error)}`)
    return 'failed'
  }
}
