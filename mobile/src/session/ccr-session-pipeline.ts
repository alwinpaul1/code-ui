import { listCcrSessionEvents, CcrApiError, type CcrSessionRow } from './ccr-session-api'
import { recordCcrMatchOutcome } from './ccr-match-outcome'
import { bindCcrConfigDir, clearCcrFailure, ccrAccountForConfigDir, ccrAccountForTab, ccrSessionForTab, forgetCcrMapping, recordCcrFailure, resetCcrCacheForTests, setCcrMapping, storeCcrImages } from './ccr-session-cache'
import { forgetSharedCcrLists, listAccountSessionsShared } from './ccr-session-lists'
import { accountPrefix, resolveCcrAuths, type CcrAuth } from './ccr-session-accounts'
import { emptyCcrExtracted, extractCcrImages, type CcrExtracted } from './ccr-session-images'
import { rankCcrCandidates } from './ccr-session-match'
import { matchCcrSessionInWaves } from './ccr-session-match-waves'
import { noteModel } from './ccr-session-model-refresh'
import {
  CCR_EVENT_PAGE_SIZE,
  CCR_MATCH_FIRST_PAGE_SIZE,
  CCR_MATCH_PAGES,
  CCR_MAX_CANDIDATES,
  CCR_MAX_EVENT_PAGES,
  defaultLog,
  maskId,
  reasonOf,
  stageLine,
  type CcrPipelineDeps,
  type CcrPipelineInput,
  type CcrPipelineResult,
  type CcrStage,
  type CcrStageReport
} from './ccr-session-shared'

export * from './ccr-session-shared'
export {
  ccrImagesVersion,
  ccrMayRun,
  ccrSelfTestContext,
  ccrSessionForTab,
  ccrToolImage,
  ccrUserImages,
  ccrTriggerVersion,
  CCR_QUICK_RETRY_MS,
  ccrRetryAt,
  clearCcrFailure,
  forgetCcrMapping,
  hydrateCcrSessionMappings,
  restartCcrCacheForTests,
  setCcrSelfTestContext,
  subscribeCcrImages,
  subscribeCcrTriggers,
  triggerCcrRematch,
  type CcrSelfTestContext
} from './ccr-session-cache'
export { refreshCcrModel } from './ccr-session-model-refresh'

/**
 * Pictures for an Orca tab, from the same Claude Code session as the Claude
 * app shows it, read through Anthropic's API with the phone's sign-in.
 *
 * Stages, each leaving one log line that names success or the reason:
 *   sign-in  → the phone's Anthropic sign-ins (Settings, Anthropic accounts), one per account;
 *   org      → the organization each acts for, kept per account;
 *   sessions → every account's Remote Control (`bridge`) sessions, all accounts
 *              asked at once, each list shared by the tabs asking together
 *              (ccr-session-lists.ts), most likely first: the sessions whose last
 *              event is nearest the tab's newest message (ccr-session-match.ts);
 *   match    → the one whose newest events share message uuids with the tab
 *              (ccr-session-match.ts), read in waves (CCR_MATCH_WAVES): a few
 *              candidates' small first pages at once, more only on a miss;
 *              cached per tab for the connection, and across restarts for the
 *              tab's Claude Code session (ccr-session-cache.ts);
 *   images   → the wanted pictures out of that session's events.
 *
 * Bounded: at most CCR_MAX_CANDIDATES sessions per group of accounts are looked at,
 * CCR_MATCH_PAGES pages of each to match, and CCR_MAX_EVENT_PAGES pages of the matched one. Every
 * failure leaves the tab as it was: the chips stay.
 *
 * Ids in log lines are masked (first three and last three characters, and
 * the length); a token never reaches one.
 */

const inFlight = new Map<string, { run: Promise<CcrPipelineResult>; wanted: ReadonlySet<string> }>()

export function resetCcrPipelineForTests(): void {
  inFlight.clear()
  forgetSharedCcrLists()
  resetCcrCacheForTests()
}

/**
 * Runs once per tab at a time. A call that wants nothing the run in flight
 * does not shares it; a call that wants more waits for it and then runs with
 * its own list, on the match the first run made. Shared blindly, the model
 * hook's match-only run swallowed the pictures' request (review of
 * 2026-10-14).
 */
export function runCcrImagePipeline(input: CcrPipelineInput, deps: CcrPipelineDeps): Promise<CcrPipelineResult> {
  const ids = [...input.wanted.toolUseIds, ...input.wanted.userMessageIds]
  const running = inFlight.get(input.tabId)
  if (running) {
    return ids.every((id) => running.wanted.has(id)) ? running.run : running.run.then(() => runCcrImagePipeline(input, deps))
  }
  // Each run's outcome is kept for the chat, which says why a tab has no session (ccr-match-outcome.ts).
  const run = runOnce(input, deps).then((result) => {
    recordCcrMatchOutcome(input.tabId, input.epoch, result)
    return result
  }).finally(() => {
    inFlight.delete(input.tabId)
  })
  inFlight.set(input.tabId, { run, wanted: new Set(ids) })
  return run
}

async function runOnce(input: CcrPipelineInput, deps: CcrPipelineDeps): Promise<CcrPipelineResult> {
  const stages: CcrStageReport[] = []
  const wantedCount = input.wanted.toolUseIds.length + input.wanted.userMessageIds.length
  const log = deps.log ?? defaultLog
  const report = (stage: CcrStage, ok: boolean, detail: string) => {
    stages.push({ stage, ok, detail })
    log(stageLine(input.tabId, stage, ok, detail), ok)
  }
  /** `notFoundYet`: nothing failed, the tab's session is just not there yet (a session just started
   *  may be listed, or carry the tab's messages, a moment later): the quick retries come first. A
   *  refusal, an unreadable session or an ambiguous match waits the usual back-off. */
  const fail = (stage: CcrStage, detail: string, notFoundYet = false): CcrPipelineResult => {
    report(stage, false, detail)
    recordCcrFailure(input.tabId, input.epoch, Date.now(), notFoundYet)
    return { stages, sessionId: null, found: 0, wanted: wantedCount }
  }

  // sign-in and org, every account at once (ccr-session-accounts.ts)
  const resolved = await resolveCcrAuths(deps, report)
  const reportFailures = (failures: readonly { stage: CcrStage; detail: string }[]) => {
    for (const failure of failures) {
      report(failure.stage, false, failure.detail)
    }
  }
  if (resolved.auths.length === 0) {
    // The last failure goes through fail(), which also starts the tab's back-off.
    reportFailures(resolved.failures.slice(0, -1))
    const last = resolved.failures[resolved.failures.length - 1]!
    return fail(last.stage, last.detail)
  }
  reportFailures(resolved.failures)
  const auths = resolved.auths
  const accountCount = auths.length + resolved.failures.filter((failure) => failure.accountId !== null).length

  const wanted = {
    toolUseIds: new Set(input.wanted.toolUseIds),
    userMessageIds: new Set(input.wanted.userMessageIds)
  }
  const extracted: CcrExtracted = emptyCcrExtracted()
  const agentSessionId = input.agentSessionId ?? null
  let sessionId = ccrSessionForTab(input.tabId, input.epoch, agentSessionId, input.configDir)
  let auth: CcrAuth | undefined
  if (sessionId) {
    // The account the tab matched under is read again; if it is gone (signed out, or its token no
    // longer works) the tab is matched afresh across the accounts that remain.
    auth = auths.find((candidate) => candidate.accountId === ccrAccountForTab(input.tabId, input.epoch, agentSessionId, input.configDir))
    if (!auth) {
      forgetCcrMapping(input.tabId, agentSessionId)
      sessionId = null
    }
  }
  let cursor: string | null = null
  let pagesRead = 0

  if (sessionId && auth) {
    report('sessions', true, 'skipped: the tab is already matched on this connection')
    report('match', true, `session ${maskId(sessionId)} (cached for this tab)`)
  } else {
    /**
     * Matches the tab among one group of accounts. `final` is the last group asked: a group before it
     * that holds no session of the tab says so and lets the next be asked, instead of failing. A group
     * before it whose best session holds only an OLDER message of the tab says `older` and keeps
     * nothing: another account's session may hold the newer ones (a conversation copied between
     * profiles and resumed, 2026-10-15), so every account is then judged together.
     */
    const settle = (outcome: Extract<Awaited<ReturnType<typeof matchCcrSessionInWaves>>, { kind: 'matched' }>) => {
      const matched = outcome.candidate
      sessionId = matched.row.id
      auth = matched.auth
      extractCcrImages(outcome.pages.events, wanted, deps.maxBytes, extracted)
      cursor = outcome.pages.cursor
      pagesRead = outcome.pages.read
      setCcrMapping(input.tabId, sessionId, input.epoch, auth.accountId, agentSessionId, input.configDir ?? null)
      // The tab's config dir is this account's from now on: its next tabs ask it first.
      if (input.configDir) {
        bindCcrConfigDir(input.configDir, auth.accountId)
      }
      report('match', true, `${accountCount > 1 ? `${auth.label}: ` : ''}session ${maskId(sessionId)} shares ${outcome.overlap} message${outcome.overlap === 1 ? '' : 's'} with this tab`)
      noteModel(input.tabId, input.epoch, matched.row, report)
    }
    /** The bound account's match on an older message, held while every account is judged: it stands
     *  when no account holds a newer shared message (a tie on the copied history included, review
     *  2026-10-15), so a tab whose newest message reached no session yet still settles. */
    const held: { settleBound?: () => void } = {}
    const matchAmong = async (
      group: readonly CcrAuth[],
      final: boolean,
      rejudge = false
    ): Promise<{ kind: 'matched' } | { kind: 'none' } | { kind: 'older' } | { kind: 'failed'; result: CcrPipelineResult }> => {
      // sessions: every account's list, all at once, so a work account's session is found beside the
      // default's in one round trip
      const listedRows: { row: CcrSessionRow; auth: CcrAuth }[] = []
      /** A session listed by two accounts (two sign-ins in one organization) is one candidate, read
       *  with the first account that listed it; counted twice it was "2 sessions share messages" with
       *  the same id twice, and never matched. */
      const seen = new Set<string>()
      const listFailures: string[] = []
      let listed = 0
      let malformed = 0
      const answers = await Promise.allSettled(group.map((account) => listAccountSessionsShared(deps.fetch, account, input.epoch)))
      for (const [index, answer] of answers.entries()) {
        const account = group[index]!
        if (answer.status === 'rejected') {
          const error: unknown = answer.reason
          if (error instanceof CcrApiError && (error.reason === 'unauthorized' || error.reason === 'forbidden')) {
            // The org may be stale for this sign-in: ask the profile again next time.
            await deps.accounts.forgetOrganization(account.accountId).catch(() => undefined)
          }
          listFailures.push(`${accountPrefix(account.label, accountCount)}${reasonOf(error)}`)
          continue
        }
        const { rows } = answer.value
        listed += rows.length
        malformed += answer.value.malformed
        for (const row of rows) {
          if (row.environmentKind === 'bridge' && row.status !== 'archived' && !seen.has(row.id)) {
            seen.add(row.id)
            listedRows.push({ row, auth: account })
          }
        }
      }
      // The most likely first (ccr-session-match.ts): the waves below read them in this order.
      const candidates = rankCcrCandidates(listedRows, input.newestMessageAt ?? null).slice(0, CCR_MAX_CANDIDATES)
      if (candidates.length === 0) {
        if (listFailures.length > 0) {
          if (!final) {
            reportFailures(listFailures.map((detail) => ({ stage: 'sessions', detail })))
            return { kind: 'none' }
          }
          reportFailures(listFailures.slice(0, -1).map((detail) => ({ stage: 'sessions', detail })))
          return { kind: 'failed', result: fail('sessions', listFailures[listFailures.length - 1]!) }
        }
        const detail = `no Remote Control session on ${group.length === 1 ? 'this account' : `these ${group.length} accounts`} (${listed} session${listed === 1 ? '' : 's'} listed${malformed ? `, ${malformed} unreadable` : ''}); Claude Code publishes a session only with Remote Control on`
        return final ? { kind: 'failed', result: fail('sessions', detail, true) } : { kind: 'none' }
      }
      reportFailures(listFailures.map((detail) => ({ stage: 'sessions', detail })))
      report('sessions', true, `${candidates.length} Remote Control session${candidates.length === 1 ? '' : 's'} to compare (${listed} listed)`)

      // match
      if (input.messageIds.length === 0) {
        return { kind: 'failed', result: fail('match', 'the tab has no transcript messages to compare yet', true) }
      }
      const outcome = await matchCcrSessionInWaves(deps.fetch, candidates, input.messageIds)
      if (rejudge && outcome.kind !== 'matched') {
        report('match', true, `no account holds a newer message of this tab (${outcome.kind}); keeping the first account's session`)
        return { kind: 'none' }
      }
      if (outcome.kind === 'unreadable') {
        const reasons = outcome.candidates.map((candidate, index) => `${accountPrefix(candidate.auth.label, accountCount)}${reasonOf(outcome.reasons[index])}`)
        if (candidates.length === 1) {
          return { kind: 'failed', result: fail('match', reasons[0]!) }
        }
        // A session whose events could not be read may be the one that shares the tab's messages,
        // or a second one that does: picking among the rest is a guess the cache would then keep.
        // Each reason is logged, and nothing is matched or cached until every candidate reads.
        reportFailures(reasons.map((detail) => ({ stage: 'match', detail })))
        const of = outcome.compared
        return { kind: 'failed', result: fail('match', `${reasons.length} of ${of} Remote Control session${of === 1 ? '' : 's'} could not be read, so any of them may be this tab's; not guessing`) }
      }
      if (outcome.kind === 'ambiguous') {
        return { kind: 'failed', result: fail('match', `${outcome.sessionIds.length} sessions share messages with this tab (${outcome.sessionIds.map(maskId).join(', ')}); not guessing`) }
      }
      const newestId = input.messageIds.at(-1)
      if (outcome.kind === 'matched' && !final && !rejudge && newestId !== undefined && !outcome.pages.uuids.has(newestId)) {
        report('match', true, `${accountCount > 1 ? `${group[0]!.label}: ` : ''}session ${maskId(outcome.candidate.row.id)} holds only older messages of this tab; asking every account`)
        held.settleBound = () => settle(outcome)
        return { kind: 'older' }
      }
      if (outcome.kind === 'matched') {
        settle(outcome)
      }
      if (!sessionId || !auth) {
        const detail = `none of ${candidates.length} Remote Control session${candidates.length === 1 ? '' : 's'} shares a message with this tab in ${candidates.length === 1 ? 'its' : 'their'} newest ${CCR_MATCH_FIRST_PAGE_SIZE} to ${CCR_MATCH_FIRST_PAGE_SIZE + (CCR_MATCH_PAGES - 1) * CCR_EVENT_PAGE_SIZE} events`
        if (!final) {
          report('match', true, `${accountCount > 1 ? `${group[0]!.label}: ` : ''}${detail}; asking the other accounts`)
          return { kind: 'none' }
        }
        return { kind: 'failed', result: fail('match', detail, true) }
      }
      return { kind: 'matched' }
    }

    // The account this tab's Claude config dir was last matched under is asked first, alone: a new
    // tab of `claude` (personal) or of a CLAUDE_CONFIG_DIR profile (work) then matches in one
    // account's round trip. A hint for speed, never proof: the tab still binds only on its own
    // match, and the other accounts are asked when the bound one does not hold the session.
    const boundId = input.configDir ? ccrAccountForConfigDir(input.configDir) : null
    const bound = boundId ? auths.find((candidate) => candidate.accountId === boundId) : undefined
    const groups = bound && auths.length > 1 ? [[bound], auths.filter((candidate) => candidate !== bound)] : [auths]
    if (bound && auths.length > 1) {
      report('sessions', true, `asking ${bound.label} first (this tab's Claude config dir matched under it before)`)
    }
    for (const [index, group] of groups.entries()) {
      const outcome = await matchAmong(group, index === groups.length - 1)
      if (outcome.kind === 'failed') {
        return outcome.result
      }
      if (outcome.kind === 'matched') {
        break
      }
      if (outcome.kind === 'older') {
        // The newest shared message decides across every account (ccr-session-match.ts).
        const all = await matchAmong(auths, false, true)
        if (all.kind === 'failed') {
          return all.result
        }
        if (all.kind !== 'matched') {
          held.settleBound?.()
        }
        break
      }
    }
    if (!sessionId || !auth) {
      // Unreachable: the last group either matches or fails. Kept so the stages below read a match.
      return fail('match', 'no account matched this tab')
    }
  }

  // images
  const missing = () =>
    [...wanted.toolUseIds].some((id) => !extracted.byToolUseId.has(id)) ||
    [...wanted.userMessageIds].some((id) => !extracted.byUserMessageId.has(id))
  try {
    while (missing() && pagesRead < CCR_MAX_EVENT_PAGES && (pagesRead === 0 || cursor)) {
      const page = await listCcrSessionEvents(deps.fetch, auth!, sessionId, { cursor, limit: CCR_EVENT_PAGE_SIZE })
      extractCcrImages(page.events, wanted, deps.maxBytes, extracted)
      pagesRead += 1
      if (!page.nextCursor || page.nextCursor === cursor) {
        cursor = null
        break
      }
      cursor = page.nextCursor
    }
  } catch (error) {
    if (error instanceof CcrApiError && error.reason === 'not-found') {
      forgetCcrMapping(input.tabId, agentSessionId)
    }
    keepFound(extracted, deps)
    return fail('images', `${reasonOf(error)} after ${pagesRead} page${pagesRead === 1 ? '' : 's'}`)
  }
  const found = keepFound(extracted, deps)
  const notFound = wantedCount - found
  const reasons = [...extracted.skipped.values()]
  const why = reasons.length > 0 ? `; ${countWords(reasons)}` : ''
  const unseen = notFound - reasons.length
  const detail = `${found} of ${wantedCount} picture${wantedCount === 1 ? '' : 's'} found in ${pagesRead} page${pagesRead === 1 ? '' : 's'} of events${why}${unseen > 0 ? `; ${unseen} not in the pages read` : ''}`
  if (found === 0 && wantedCount > 0) {
    return { ...fail('images', detail), sessionId }
  }
  report('images', true, detail)
  clearCcrFailure(input.tabId)
  return { stages, sessionId, found, wanted: wantedCount }
}

function countWords(reasons: string[]): string {
  const counts = new Map<string, number>()
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts].map(([reason, count]) => `${count} ${reason}`).join(', ')
}

/** Writes each found picture to its cache file and makes it visible. */
function keepFound(extracted: CcrExtracted, deps: CcrPipelineDeps): number {
  const tool = new Map([...extracted.byToolUseId].map(([id, uri]) => [id, deps.keep(`ccr\0tool\0${id}`, uri)] as const))
  const user = new Map(
    [...extracted.byUserMessageId].map(([id, uris]) => [id, uris.map((uri, index) => (uri ? deps.keep(`ccr\0user\0${id}\0${index}`, uri) : ''))] as const)
  )
  storeCcrImages(tool, user)
  return tool.size + user.size
}

