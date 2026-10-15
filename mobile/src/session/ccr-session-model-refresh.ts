import type { CcrSessionRow } from './ccr-session-api'
import { ccrAccountForTab, ccrSessionForTab, forgetCcrMapping } from './ccr-session-cache'
import { listAccountSessionsShared } from './ccr-session-lists'
import { ccrModelOfRow, forgetCcrModel, recordCcrModel } from './ccr-session-model'
import {
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
 * a guess at another endpoint's, shared with every other tab of the account
 * (ccr-session-lists.ts). Does nothing for a tab not matched on this
 * connection or for its Claude Code session (`agentSessionId`, a match kept
 * across restarts). A matched session no longer listed drops the match, kept
 * copy included. Failures leave one line and drop the reading, so the pill
 * falls back to today's sources.
 */
export async function refreshCcrModel(tabId: string, epoch: number | null, deps: CcrPipelineDeps, agentSessionId: string | null = null): Promise<CcrStageReport | null> {
  const sessionId = ccrSessionForTab(tabId, epoch, agentSessionId)
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
    const accountId = ccrAccountForTab(tabId, epoch, agentSessionId)
    // Only that account is read, so a re-read refreshes no other account's token.
    const accounts = accountId ? await deps.accounts.list(accountId) : []
    const account = accounts.find((entry) => entry.id === accountId)
    const token = account?.accessToken ?? null
    const org = account?.organizationUuid ?? null
    if (!account || !token || !org) {
      forgetCcrModel(tabId)
      if (!account) {
        // Signed out: the match cannot be read with it again. Dropped, the tab's next run matches
        // it afresh across the accounts still signed in, instead of re-reading a dead one forever.
        forgetCcrMapping(tabId, agentSessionId)
      }
      report(
        'model',
        false,
        !account
          ? 'the account this tab matched under is no longer signed in'
          : !token
            ? `${account.label}: ${account.error ?? 'no usable token'}`
            : 'no organization cached'
      )
      return result
    }
    const listed = await listAccountSessionsShared(deps.fetch, { accountId: account.id, token, organizationUuid: org }, epoch, 0)
    const row = listed.rows.find((candidate) => candidate.id === sessionId)
    if (row) {
      noteModel(tabId, epoch, row, report)
      return result
    }
    forgetCcrModel(tabId)
    forgetCcrMapping(tabId, agentSessionId)
    report('model', false, `session ${maskId(sessionId)} is no longer in the account's list; the tab is matched again`)
  } catch (error) {
    forgetCcrModel(tabId)
    report('model', false, reasonOf(error))
  }
  return result
}

