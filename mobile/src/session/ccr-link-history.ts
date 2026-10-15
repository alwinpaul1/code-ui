import { listCcrSessionEvents, type CcrEventPage } from './ccr-session-api'
import type { CcrLinkDeps } from './ccr-session-link-types'
import { CCR_MAX_EVENT_PAGES } from './ccr-session-shared'

/** A session link's history pages (ccr-session-link.ts): one page, and a walk back through them. */

export const CCR_SIGNED_OUT_LINE = 'This account is signed out on this phone. Sign in to it again in Anthropic accounts.'

/** The account has no sign-in on the phone any more. */
export class CcrSignedOutError extends Error {
  constructor() {
    super('signed out')
  }
}

/** One page, newest first from `cursor`, read with the account's own sign-in. */
export async function readCcrHistoryPage(deps: CcrLinkDeps, accountId: string, sessionId: string, cursor: string | null, limit: number): Promise<CcrEventPage> {
  const auth = await deps.auth(accountId, false).catch(() => null)
  if (!auth) {
    throw new CcrSignedOutError()
  }
  return listCcrSessionEvents(deps.fetch, auth, sessionId, { cursor, limit })
}

/** Pages back from `cursor` until `stop(page)` or the history's start: that last page. Null when
 *  CCR_MAX_EVENT_PAGES were read first. A failed page throws. */
export async function walkCcrHistory(read: (cursor: string | null) => Promise<CcrEventPage>, cursor: string | null, stop: (page: CcrEventPage) => boolean): Promise<CcrEventPage | null> {
  for (let count = 0; count < CCR_MAX_EVENT_PAGES; count++) {
    const page = await read(cursor)
    if (stop(page) || !page.nextCursor) {
      return page
    }
    cursor = page.nextCursor
  }
  return null
}
