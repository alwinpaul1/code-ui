import { CcrApiError, type CcrFetch, type CcrProfile } from './ccr-session-api'

/** Types, bounds and wording shared by the session-API path's modules
 *  (ccr-session-pipeline.ts says what the path does). */

/** Claude Code lists these sessions 100 at a time (`v1/code/sessions?limit=100`, 2.1.300
 *  @214015705), so two pages hold 200 rows in two round trips, where three pages of 50 held 150 in
 *  three. The rows come newest first: Claude Code stops paging once a page's last row is older
 *  than it needs (`stopWhenOlderThan` on `last_event_at`, same place). */
export const CCR_LIST_PAGE_SIZE = 100
export const CCR_MAX_LIST_PAGES = 2
/** How long a finished session list still serves another tab that asks (ccr-session-lists.ts): tabs
 *  opened together share it. Shorter than the first quick retry (CCR_QUICK_RETRY_MS, 500 ms), so a
 *  retry for a session not listed yet reads a fresh list. */
export const CCR_LIST_SHARE_MS = 400
/** Remote Control sessions compared per group of accounts, most likely first
 *  (ccr-session-match.ts, rankCcrCandidates). Sixteen, connected and newest first, were not enough
 *  on 2026-10-15: two idle work tabs matched none of the 16 compared of 150 listed. They are read in waves,
 *  CCR_MATCH_WAVES new ones each, and a wave whose match holds the tab's newest message ends the
 *  match (ccr-session-match-waves.ts). */
export const CCR_MAX_CANDIDATES = 32
/** New candidates per wave. The first stays under OkHttp's five requests per host (React
 *  Native's fetch on Android), so it costs one round trip; the rest are read only when it misses. */
export const CCR_MATCH_WAVES = [4, 12, 16] as const
/** A candidate's first page, the newest events: small, because a page's size is its cost. On
 *  2026-10-15 sixteen first pages of 100 events took 12.4 s from list to match on the phone
 *  (08:39:40.964 to 08:39:53.356), the match itself found on the first page. An event can carry a
 *  whole tool result, pictures included. */
export const CCR_MATCH_FIRST_PAGE_SIZE = 25
/** Events per later page. Observed live 2026-10-14 (the user's account, 4,000
 *  events): 84% are `system` events, so a small page holds few messages to
 *  match or pictures to find; `limit=100` was accepted. */
export const CCR_EVENT_PAGE_SIZE = 100
/** Pages of one candidate read while matching, its first page included: one more each wave. */
export const CCR_MATCH_PAGES = 3
export const CCR_MAX_EVENT_PAGES = 10

export type CcrStage = 'sign-in' | 'org' | 'sessions' | 'match' | 'model' | 'images'
export type CcrStageReport = { stage: CcrStage; ok: boolean; detail: string }

export type CcrWanted = { toolUseIds: readonly string[]; userMessageIds: readonly string[] }

export type CcrPipelineInput = {
  tabId: string
  /** The relay connection the tab was matched on (`useLastConnectedAt`): a new one re-matches. */
  epoch: number | null
  /** Transcript uuids of the tab's messages. */
  messageIds: readonly string[]
  /** The Claude Code session the tab shows (the hook's `session_id`), when known: a match is kept
   *  for it across restarts, and does not stand for another session of the tab. */
  agentSessionId?: string | null
  /** The Claude config dir the tab's session writes under (`~/.claude`, `~/.claude-work`), from its
   *  transcript path: the account it was last matched under is asked first. */
  configDir?: string | null
  /** The newest transcript time among the tab's messages (newestTranscriptMessageAt): the
   *  sessions whose last event is nearest to it are read first. */
  newestMessageAt?: number | null
  wanted: CcrWanted
}

/** One signed-in account as the path reads it (dictation/anthropic-credential-reader.ts). */
export type CcrAccountEntry = {
  id: string
  label: string
  /** A live access token, or null with `error` saying why. */
  accessToken: string | null
  /** The organization kept for the account, or null when its profile has not been read. */
  organizationUuid: string | null
  error?: string
}

export type CcrAccountsSource = {
  /** Every signed-in account, tokens refreshed account by account; empty when nobody is signed in.
   *  With `only`, just that account (or nothing), and only its token is refreshed. */
  list: (only?: string) => Promise<CcrAccountEntry[]>
  /** Keeps the profile read for an account. Resolves to the account's id afterwards (a uuid). */
  rememberProfile: (id: string, profile: CcrProfile) => Promise<string>
  /** Drops the account's kept organization, so the profile is asked again. */
  forgetOrganization: (id: string) => Promise<void>
}

export type CcrPipelineDeps = {
  fetch: CcrFetch
  /** The phone's Anthropic sign-ins, one per account. */
  accounts: CcrAccountsSource
  /** Where a picture is kept: the cache-file writer the host's pictures use. */
  keep: (key: string, dataUri: string) => string
  maxBytes: number
  log?: (line: string, ok: boolean) => void
}

export type CcrPipelineResult = {
  stages: CcrStageReport[]
  sessionId: string | null
  found: number
  wanted: number
}

/** An id as log lines and the check show it: first and last three characters, and the length. */
export function maskId(id: string): string {
  if (id.length <= 8) {
    return `${id.slice(0, 3)}… (${id.length})`
  }
  return `${id.slice(0, 3)}…${id.slice(-3)} (${id.length})`
}


/** The words a failed request leaves in its stage's line: never a header or a body. */
export function reasonOf(error: unknown): string {
  if (error instanceof CcrApiError) {
    switch (error.reason) {
      case 'unauthorized':
        return `the sign-in was refused (HTTP ${error.status ?? 401}); sign in again in Settings, Anthropic accounts`
      case 'untrusted-device':
        return `this phone is not a trusted device for the organization (HTTP ${error.status ?? 403})`
      case 'forbidden':
        return `forbidden (HTTP ${error.status ?? 403}); the organization may not allow Remote Control, or the sign-in lacks access`
      case 'not-found':
        return `not found (HTTP ${error.status ?? 404})`
      case 'http':
        return `HTTP ${error.status ?? '?'}`
      case 'network':
        return 'network error (no answer from api.anthropic.com)'
      case 'malformed':
        return 'the reply was not the expected shape'
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/** One line per stage: what it found, or why it failed, and the tab, masked. */
export function stageLine(tabId: string, stage: CcrStage, ok: boolean, detail: string): string {
  return `[ccr-images] ${stage}: ${ok ? 'ok' : 'failed'} — ${detail} (tab ${maskId(tabId)})`
}

export function defaultLog(line: string, ok: boolean): void {
  if (ok) {
    console.info(line)
  } else {
    console.warn(line)
  }
}
