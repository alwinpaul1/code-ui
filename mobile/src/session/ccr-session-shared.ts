import { CcrApiError, type CcrFetch } from './ccr-session-api'

/** Types, bounds and wording shared by the session-API path's modules
 *  (ccr-session-pipeline.ts says what the path does). */

export const CCR_LIST_PAGE_SIZE = 50
export const CCR_MAX_LIST_PAGES = 3
export const CCR_MAX_CANDIDATES = 4
/** Events per page. Observed live 2026-10-14 (the user's account, 4,000
 *  events): 84% are `system` events, so a small page holds few messages to
 *  match or pictures to find; `limit=100` was accepted. */
export const CCR_EVENT_PAGE_SIZE = 100
export const CCR_MATCH_PAGES = 2
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
  wanted: CcrWanted
}

export type CcrOrgStore = {
  read: () => Promise<{ accountUuid: string; organizationUuid: string } | null>
  write: (organization: { accountUuid: string; organizationUuid: string }) => Promise<void>
  clear: () => Promise<void>
}

export type CcrPipelineDeps = {
  fetch: CcrFetch
  /** A live access token of the phone's sign-in, or null when not signed in. */
  readToken: () => Promise<string | null>
  org: CcrOrgStore
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
        return `the sign-in was refused (HTTP ${error.status ?? 401}); sign in again in Voice settings`
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
