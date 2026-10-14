import { listCcrSessions, type CcrSessionRow } from './ccr-session-api'
import { ccrAccountForTab, ccrSessionForTab } from './ccr-session-cache'
import { ccrModelOfRow, forgetCcrModel, recordCcrModel } from './ccr-session-model'
import {
  CCR_LIST_PAGE_SIZE,
  CCR_MAX_LIST_PAGES,
  defaultLog,
  maskId,
  reasonOf,
  stageLine,
  type CcrPipelineDeps,
  type CcrStage,
  type CcrStageReport
} from './ccr-session-shared'

/** Keeps the matched row's reported model and effort for the pill (ccr-session-model.ts). */
export function noteModel(tabId: string, epoch: number | null, row: CcrSessionRow, report: (stage: CcrStage, ok: boolean, detail: string) => void): void {
  const read = ccrModelOfRow(row)
  if ('skip' in read) {
    forgetCcrModel(tabId)
    report(
      'model',
      false,
      read.skip === 'no-model'
        ? 'the session reports no model (external_metadata.model absent); the pill keeps the beacon/transcript'
        : `the session reports a model id this phone cannot name (${row.model ?? ''}); the pill keeps the beacon/transcript`
    )
    return
  }
  recordCcrModel(tabId, { sessionId: row.id, epoch, model: read.model, effort: read.effort, fetchedAt: Date.now() })
  report('model', true, `model ${read.model}, effort ${read.effort ?? 'not reported'}`)
}

/**
 * Re-reads the matched session's row for its model and effort: the first
 * pages of the session list (the row's shape is the list's, eyu.java), never
 * a guess at another endpoint's. Does nothing for a tab not matched on this
 * connection. Failures leave one line and drop the reading, so the pill falls
 * back to today's sources.
 */
export async function refreshCcrModel(tabId: string, epoch: number | null, deps: CcrPipelineDeps): Promise<CcrStageReport | null> {
  const sessionId = ccrSessionForTab(tabId, epoch)
  if (!sessionId) {
    return null
  }
  const log = deps.log ?? defaultLog
  let result: CcrStageReport | null = null
  const report = (stage: CcrStage, ok: boolean, detail: string) => {
    result = { stage, ok, detail }
    log(stageLine(tabId, stage, ok, detail), ok)
  }
  try {
    // The account the tab matched under answers: its token and its organization, not another's.
    const accountId = ccrAccountForTab(tabId, epoch)
    const accounts = await deps.accounts.list()
    const account = accounts.find((entry) => entry.id === accountId)
    const token = account?.accessToken ?? null
    const org = account?.organizationUuid ?? null
    if (!token || !org) {
      forgetCcrModel(tabId)
      report(
        'model',
        false,
        !account
          ? accounts.length === 0
            ? 'not signed in to Anthropic on this phone'
            : 'the account this tab matched under is no longer signed in'
          : !token
            ? `${account.label}: ${account.error ?? 'no usable token'}`
            : 'no organization cached'
      )
      return result
    }
    let cursor: string | null = null
    for (let page = 0; page < CCR_MAX_LIST_PAGES; page += 1) {
      const listed = await listCcrSessions(deps.fetch, { token, organizationUuid: org }, { cursor, limit: CCR_LIST_PAGE_SIZE })
      const row = listed.sessions.find((candidate) => candidate.id === sessionId)
      if (row) {
        noteModel(tabId, epoch, row, report)
        return result
      }
      if (!listed.nextCursor || listed.nextCursor === cursor) {
        break
      }
      cursor = listed.nextCursor
    }
    forgetCcrModel(tabId)
    report('model', false, `session ${maskId(sessionId)} is no longer in the account's list`)
  } catch (error) {
    forgetCcrModel(tabId)
    report('model', false, reasonOf(error))
  }
  return result
}

