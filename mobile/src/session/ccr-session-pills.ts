import { ccrAccountForTab, ccrSessionForTab } from './ccr-session-cache'
import { listAccountSessionsShared } from './ccr-session-lists'
import { fetchCcrBranchPr, type CcrBranchPr } from './ccr-session-branch-status'
import { defaultLog, maskId, reasonOf, type CcrPipelineDeps } from './ccr-session-shared'

/**
 * The pull request of the tab's Remote Control session, as Anthropic reports it
 * (ccr-session-branch-status.ts), kept per tab for the session pills.
 *
 * Read at the moments the model reading is (ccr-session-model-refresh.ts; the hook is
 * use-ccr-session-pills.ts): the account's session list is the one every tab shares, and the one
 * branch-status request per tab goes out beside the model's, never behind it. A reading of the
 * session the tab showed before, or from before the relay last connected, is not this one's. A
 * reading older than CCR_PILLS_FRESH_MS is not used: a PR that merged an hour ago while the phone
 * could not ask must not stay "Open". Nothing here means today's pills (Orca's), never an empty row.
 */

export const CCR_PILLS_FRESH_MS = 10 * 60_000
export const CCR_PILLS_REFRESH_MS = 60_000

export type CcrPillsReading = {
  sessionId: string
  epoch: number | null
  /** Null: the session has no pull request (a real answer, kept so the pills do not guess one). */
  pr: CcrBranchPr | null
  fetchedAt: number
}

const readings = new Map<string, CcrPillsReading>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

export function recordCcrPills(tabId: string, reading: CcrPillsReading): void {
  readings.set(tabId, reading)
  changed()
}

export function forgetCcrPills(tabId: string): void {
  if (readings.delete(tabId)) {
    changed()
  }
}

export function resetCcrPillsForTests(): void {
  readings.clear()
  changed()
}

export function subscribeCcrPills(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function ccrPillsVersion(): number {
  return version
}

/** The tab's reading when it is fresh and from this connection. */
export function ccrPillsForTab(tabId: string, epoch: number | null, now = Date.now()): CcrPillsReading | null {
  const reading = readings.get(tabId)
  if (!reading || reading.epoch !== epoch || now - reading.fetchedAt > CCR_PILLS_FRESH_MS) {
    return null
  }
  return reading
}

/**
 * Re-reads the pull request of the tab's matched session. Does nothing for a tab not matched on
 * this connection (that match is the pipeline's to make). The account the tab matched under
 * answers, with its own token and organization. A failure leaves one line and keeps the last
 * reading until it goes stale; a signed-out account or a session no longer listed drops it.
 */
export async function refreshCcrPills(tabId: string, epoch: number | null, deps: CcrPipelineDeps, agentSessionId: string | null = null): Promise<void> {
  const sessionId = ccrSessionForTab(tabId, epoch, agentSessionId)
  if (!sessionId) {
    return
  }
  const log = deps.log ?? defaultLog
  const say = (ok: boolean, detail: string) => log(`[ccr-pills] ${ok ? 'ok' : 'failed'} — ${detail} (tab ${maskId(tabId)})`, ok)
  try {
    const accountId = ccrAccountForTab(tabId, epoch, agentSessionId)
    const accounts = accountId ? await deps.accounts.list(accountId) : []
    const account = accounts.find((entry) => entry.id === accountId)
    if (!account || !account.accessToken || !account.organizationUuid) {
      forgetCcrPills(tabId)
      say(false, !account ? 'the account this tab matched under is no longer signed in' : 'no usable token or organization for the matched account')
      return
    }
    const auth = { token: account.accessToken, organizationUuid: account.organizationUuid }
    const listed = await listAccountSessionsShared(deps.fetch, { accountId: account.id, ...auth }, epoch)
    const row = listed.rows.find((candidate) => candidate.id === sessionId)
    if (!row) {
      forgetCcrPills(tabId)
      say(false, `session ${maskId(sessionId)} is not in the account's list`)
      return
    }
    const pr = await fetchCcrBranchPr(deps.fetch, auth, { sessionId, pairs: row.branches ?? [] })
    recordCcrPills(tabId, { sessionId, epoch, pr, fetchedAt: Date.now() })
    say(true, pr ? `PR #${pr.number} ${pr.state}, CI ${pr.ci ?? 'not shown'}` : 'the session has no pull request')
  } catch (error) {
    say(false, reasonOf(error))
  }
}
