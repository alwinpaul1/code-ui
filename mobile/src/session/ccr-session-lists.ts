import { listCcrSessions, type CcrFetch, type CcrSessionRow } from './ccr-session-api'
import { onCcrAccountsChanged } from './ccr-session-cache'
import { CCR_LIST_PAGE_SIZE, CCR_LIST_SHARE_MS, CCR_MAX_LIST_PAGES } from './ccr-session-shared'

/**
 * One account's Remote Control session list, shared by every tab that asks for it while it is in
 * flight or within CCR_LIST_SHARE_MS on the same connection: three tabs opened together, or a match and the model
 * re-read right after it, cost one list per account, not one per tab. A request in flight is
 * shared too. A failed list is not kept, so the next caller asks again; a sign-in, a sign-out or
 * a new connection starts from a fresh list.
 */

export type CcrAccountList = { rows: CcrSessionRow[]; malformed: number }

type Held = { at: number; fetch: CcrFetch; list: Promise<CcrAccountList>; settled: boolean }

const shared = new Map<string, Held>()

export function listAccountSessionsShared(
  fetchImpl: CcrFetch,
  auth: { accountId: string; token: string; organizationUuid: string },
  epoch: number | null,
  /** How old a finished list may be and still be used. The model re-read passes 0: it is the
   *  timed check that the row changed, so it shares only a list still in flight. */
  maxAgeMs = CCR_LIST_SHARE_MS,
  now = Date.now()
): Promise<CcrAccountList> {
  const key = `${auth.accountId}\0${auth.organizationUuid}\0${epoch ?? ''}`
  const held = shared.get(key)
  if (held && held.fetch === fetchImpl && (!held.settled || now - held.at < maxAgeMs)) {
    return held.list
  }
  const list = readAll(fetchImpl, auth)
  const entry: Held = { at: now, fetch: fetchImpl, list, settled: false }
  shared.set(key, entry)
  list.then(
    () => {
      entry.settled = true
    },
    () => {
      if (shared.get(key) === entry) {
        shared.delete(key)
      }
    }
  )
  return list
}

async function readAll(fetchImpl: CcrFetch, auth: { token: string; organizationUuid: string }): Promise<CcrAccountList> {
  const rows: CcrSessionRow[] = []
  let malformed = 0
  let cursor: string | null = null
  for (let page = 0; page < CCR_MAX_LIST_PAGES; page += 1) {
    const result = await listCcrSessions(fetchImpl, auth, { cursor, limit: CCR_LIST_PAGE_SIZE })
    rows.push(...result.sessions)
    malformed += result.malformedRows
    if (!result.nextCursor || result.nextCursor === cursor) {
      break
    }
    cursor = result.nextCursor
  }
  return { rows, malformed }
}

/**
 * One session's row, for the model re-read: the list read page by page only until the row is on
 * one. The rows come newest first, so a session the tab is using is on the first page, and the
 * re-read costs one round trip, not CCR_MAX_LIST_PAGES of them before the pill can change. A whole
 * list already in flight for the account is shared instead. Null when no page read holds it.
 */
export async function findAccountSessionRow(
  fetchImpl: CcrFetch,
  auth: { accountId: string; token: string; organizationUuid: string },
  epoch: number | null,
  sessionId: string
): Promise<CcrSessionRow | null> {
  const held = shared.get(`${auth.accountId}\0${auth.organizationUuid}\0${epoch ?? ''}`)
  if (held && held.fetch === fetchImpl && !held.settled) {
    return (await held.list).rows.find((row) => row.id === sessionId) ?? null
  }
  let cursor: string | null = null
  for (let page = 0; page < CCR_MAX_LIST_PAGES; page += 1) {
    const result = await listCcrSessions(fetchImpl, auth, { cursor, limit: CCR_LIST_PAGE_SIZE })
    const row = result.sessions.find((candidate) => candidate.id === sessionId)
    if (row) {
      return row
    }
    if (!result.nextCursor || result.nextCursor === cursor) {
      return null
    }
    cursor = result.nextCursor
  }
  return null
}

export function forgetSharedCcrLists(): void {
  shared.clear()
}

onCcrAccountsChanged(forgetSharedCcrLists)
