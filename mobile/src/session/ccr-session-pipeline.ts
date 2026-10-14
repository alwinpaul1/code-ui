import { fetchCcrProfile, listCcrSessionEvents, listCcrSessions, CcrApiError, type CcrEvent, type CcrSessionRow } from './ccr-session-api'
import { clearCcrFailure, ccrSessionForTab, forgetCcrMapping, recordCcrFailure, resetCcrCacheForTests, setCcrMapping, storeCcrImages } from './ccr-session-cache'
import { emptyCcrExtracted, extractCcrImages, type CcrExtracted } from './ccr-session-images'
import { matchCcrSession } from './ccr-session-match'
import { noteModel } from './ccr-session-model-refresh'
import {
  CCR_EVENT_PAGE_SIZE,
  CCR_LIST_PAGE_SIZE,
  CCR_MATCH_PAGES,
  CCR_MAX_CANDIDATES,
  CCR_MAX_EVENT_PAGES,
  CCR_MAX_LIST_PAGES,
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
  forgetCcrMapping,
  setCcrSelfTestContext,
  subscribeCcrImages,
  type CcrSelfTestContext
} from './ccr-session-cache'
export { refreshCcrModel } from './ccr-session-model-refresh'

/**
 * Pictures for an Orca tab, from the same Claude Code session as the Claude
 * app shows it, read through Anthropic's API with the phone's sign-in.
 *
 * Stages, each leaving one log line that names success or the reason:
 *   sign-in  → the phone's Anthropic sign-in (Voice settings);
 *   org      → the organization it acts for, cached per account;
 *   sessions → the account's Remote Control (`bridge`) sessions, newest first;
 *   match    → the one whose recent events share message uuids with the tab
 *              (ccr-session-match.ts), cached per tab until the relay
 *              reconnects;
 *   images   → the wanted pictures out of that session's events.
 *
 * Bounded: at most MAX_CANDIDATES sessions are looked at, MATCH_PAGES pages
 * of each to match, and MAX_EVENT_PAGES pages of the matched one. Every
 * failure leaves the tab as it was: the chips stay.
 *
 * Ids in log lines are masked (first three and last three characters, and
 * the length); a token never reaches one.
 */

const inFlight = new Map<string, Promise<CcrPipelineResult>>()

export function resetCcrPipelineForTests(): void {
  inFlight.clear()
  resetCcrCacheForTests()
}

/** Runs once per tab at a time; a second call while one runs shares it. */
export function runCcrImagePipeline(input: CcrPipelineInput, deps: CcrPipelineDeps): Promise<CcrPipelineResult> {
  const running = inFlight.get(input.tabId)
  if (running) {
    return running
  }
  const run = runOnce(input, deps).finally(() => {
    inFlight.delete(input.tabId)
  })
  inFlight.set(input.tabId, run)
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
  const fail = (stage: CcrStage, detail: string): CcrPipelineResult => {
    report(stage, false, detail)
    recordCcrFailure(input.tabId, input.epoch, Date.now())
    return { stages, sessionId: null, found: 0, wanted: wantedCount }
  }

  // sign-in
  let token: string | null
  try {
    token = await deps.readToken()
  } catch (error) {
    return fail('sign-in', `the sign-in could not be read: ${reasonOf(error)}`)
  }
  if (!token) {
    return fail('sign-in', 'not signed in to Anthropic on this phone (Voice settings → Sign in)')
  }
  report('sign-in', true, 'signed in')

  // org
  let organizationUuid: string
  try {
    const cached = await deps.org.read()
    if (cached) {
      organizationUuid = cached.organizationUuid
      report('org', true, `organization ${maskId(organizationUuid)} (cached)`)
    } else {
      const profile = await fetchCcrProfile(deps.fetch, token)
      await deps.org.write(profile).catch(() => undefined)
      organizationUuid = profile.organizationUuid
      report('org', true, `organization ${maskId(organizationUuid)} (from /api/oauth/profile)`)
    }
  } catch (error) {
    return fail('org', reasonOf(error))
  }
  const auth = { token, organizationUuid }

  const wanted = {
    toolUseIds: new Set(input.wanted.toolUseIds),
    userMessageIds: new Set(input.wanted.userMessageIds)
  }
  const extracted: CcrExtracted = emptyCcrExtracted()
  let sessionId = ccrSessionForTab(input.tabId, input.epoch)
  let cursor: string | null = null
  let pagesRead = 0

  if (sessionId) {
    report('sessions', true, 'skipped: the tab is already matched on this connection')
    report('match', true, `session ${maskId(sessionId)} (cached for this tab)`)
  } else {
    // sessions
    let candidates: CcrSessionRow[]
    try {
      const rows: CcrSessionRow[] = []
      let listCursor: string | null = null
      let malformed = 0
      for (let page = 0; page < CCR_MAX_LIST_PAGES; page += 1) {
        const listed = await listCcrSessions(deps.fetch, auth, { cursor: listCursor, limit: CCR_LIST_PAGE_SIZE })
        rows.push(...listed.sessions)
        malformed += listed.malformedRows
        if (!listed.nextCursor || listed.nextCursor === listCursor) {
          break
        }
        listCursor = listed.nextCursor
      }
      candidates = rows
        .filter((row) => row.environmentKind === 'bridge' && row.status !== 'archived')
        .sort((a, b) => b.activeAt - a.activeAt)
        .slice(0, CCR_MAX_CANDIDATES)
      if (candidates.length === 0) {
        return fail(
          'sessions',
          `no Remote Control session on this account (${rows.length} session${rows.length === 1 ? '' : 's'} listed${malformed ? `, ${malformed} unreadable` : ''}); Claude Code publishes a session only with Remote Control on`
        )
      }
      report('sessions', true, `${candidates.length} Remote Control session${candidates.length === 1 ? '' : 's'} to compare (${rows.length} listed)`)
    } catch (error) {
      if (error instanceof CcrApiError && (error.reason === 'unauthorized' || error.reason === 'forbidden')) {
        // The org may be stale for this sign-in: ask the profile again next time.
        await deps.org.clear().catch(() => undefined)
      }
      return fail('sessions', reasonOf(error))
    }

    // match
    const tabIds = new Set(input.messageIds)
    if (tabIds.size === 0) {
      return fail('match', 'the tab has no transcript messages to compare yet')
    }
    const pages = new Map<string, { events: CcrEvent[]; uuids: Set<string>; cursor: string | null }>()
    try {
      for (let round = 0; round < CCR_MATCH_PAGES; round += 1) {
        for (const candidate of candidates) {
          const held = pages.get(candidate.id)
          if (round > 0 && !held?.cursor) {
            continue
          }
          const page = await listCcrSessionEvents(deps.fetch, auth, candidate.id, { cursor: held?.cursor ?? null, limit: CCR_EVENT_PAGE_SIZE })
          const uuids = held?.uuids ?? new Set<string>()
          for (const event of page.events) {
            const uuid = event.payload.uuid
            if (typeof uuid === 'string') {
              uuids.add(uuid)
            }
          }
          pages.set(candidate.id, { events: [...(held?.events ?? []), ...page.events], uuids, cursor: page.nextCursor })
        }
        const match = matchCcrSession(tabIds, candidates.map((candidate) => ({ sessionId: candidate.id, uuids: pages.get(candidate.id)?.uuids ?? new Set() })))
        if (match.kind === 'ambiguous') {
          return fail('match', `${match.sessionIds.length} sessions share messages with this tab (${match.sessionIds.map(maskId).join(', ')}); not guessing`)
        }
        if (match.kind === 'matched') {
          sessionId = match.sessionId
          const held = pages.get(sessionId)!
          extractCcrImages(held.events, wanted, deps.maxBytes, extracted)
          cursor = held.cursor
          pagesRead = round + 1
          setCcrMapping(input.tabId, sessionId, input.epoch)
          report('match', true, `session ${maskId(sessionId)} shares ${match.overlap} message${match.overlap === 1 ? '' : 's'} with this tab`)
          const row = candidates.find((candidate) => candidate.id === sessionId)
          if (row) {
            noteModel(input.tabId, input.epoch, row, report)
          }
          break
        }
      }
    } catch (error) {
      return fail('match', reasonOf(error))
    }
    if (!sessionId) {
      return fail(
        'match',
        `none of ${candidates.length} Remote Control session${candidates.length === 1 ? '' : 's'} shares a message with this tab in its latest ${CCR_MATCH_PAGES * CCR_EVENT_PAGE_SIZE} events`
      )
    }
  }

  // images
  const missing = () =>
    [...wanted.toolUseIds].some((id) => !extracted.byToolUseId.has(id)) ||
    [...wanted.userMessageIds].some((id) => !extracted.byUserMessageId.has(id))
  try {
    while (missing() && pagesRead < CCR_MAX_EVENT_PAGES && (pagesRead === 0 || cursor)) {
      const page = await listCcrSessionEvents(deps.fetch, auth, sessionId, { cursor, limit: CCR_EVENT_PAGE_SIZE })
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
      forgetCcrMapping(input.tabId)
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

