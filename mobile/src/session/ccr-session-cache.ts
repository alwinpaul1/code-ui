import type { CcrPipelineInput, CcrWanted } from './ccr-session-shared'

/**
 * What the session-API path keeps between runs, in memory: each tab's matched
 * session (for the relay connection it was matched on), the pictures found,
 * each tab's back-off after a failure, and the chat on screen for the
 * one-tap check.
 */

const mappingByTab = new Map<string, { sessionId: string; epoch: number | null; accountId: string }>()
/** `tool:<toolu id>` → URI, `user:<uuid>` → URIs. Both ids are unique across sessions. */
const toolImages = new Map<string, string>()
const userImages = new Map<string, string[]>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeCcrImages(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function ccrImagesVersion(): number {
  return version
}

export function ccrToolImage(toolUseId: string): string | undefined {
  return toolImages.get(toolUseId)
}

export function ccrUserImages(messageId: string): string[] | undefined {
  return userImages.get(messageId)
}

/** Remembers which account the tab's session was found under, so later reads use that account's token and organization. */
export function setCcrMapping(tabId: string, sessionId: string, epoch: number | null, accountId: string): void {
  mappingByTab.set(tabId, { sessionId, epoch, accountId })
}

/** Keeps found pictures under their ids (a Read's `toolu_…`, a prompt's uuid) and tells the hooks. */
export function storeCcrImages(tool: ReadonlyMap<string, string>, user: ReadonlyMap<string, string[]>): void {
  for (const [id, uri] of tool) {
    toolImages.set(id, uri)
  }
  for (const [id, uris] of user) {
    userImages.set(id, uris)
  }
  if (tool.size + user.size > 0) {
    changed()
  }
}

/** Drops the tab's match, so the next run matches it again (the one-tap check). */
export function forgetCcrMapping(tabId: string): void {
  mappingByTab.delete(tabId)
}

export function ccrSessionForTab(tabId: string, epoch: number | null): string | null {
  const mapped = mappingByTab.get(tabId)
  return mapped && mapped.epoch === epoch ? mapped.sessionId : null
}

/** The account the tab's session was matched under, for the connection it was matched on. */
export function ccrAccountForTab(tabId: string, epoch: number | null): string | null {
  const mapped = mappingByTab.get(tabId)
  return mapped && mapped.epoch === epoch ? mapped.accountId : null
}

// ─── Back-off ─────────────────────────────────────────────────────────────

const BACKOFF_FIRST_MS = 30_000
const BACKOFF_MAX_MS = 10 * 60_000
const backoffByTab = new Map<string, { until: number; tries: number; epoch: number | null }>()

/** Whether the tab may run now: no failure on record, its wait is over, or
 *  the relay has connected anew since (CLAUDE.md, "Nothing stays stale once
 *  the relay connects"). */
export function ccrMayRun(tabId: string, epoch: number | null, now = Date.now()): boolean {
  const backoff = backoffByTab.get(tabId)
  return !backoff || backoff.epoch !== epoch || backoff.until <= now
}

export function recordCcrFailure(tabId: string, epoch: number | null, now: number): void {
  const before = backoffByTab.get(tabId)
  const tries = before && before.epoch === epoch ? before.tries + 1 : 1
  backoffByTab.set(tabId, { until: now + Math.min(BACKOFF_FIRST_MS * 2 ** (tries - 1), BACKOFF_MAX_MS), tries, epoch })
}

export function clearCcrFailure(tabId: string): void {
  backoffByTab.delete(tabId)
}

export function resetCcrCacheForTests(): void {
  mappingByTab.clear()
  toolImages.clear()
  userImages.clear()
  backoffByTab.clear()
  selfTestContext = null
  changed()
}

// ─── Self-test context ────────────────────────────────────────────────────

/** The chat on screen, for the one-tap check (MobileCcrImagesSelfTest). */
export type CcrSelfTestContext = Omit<CcrPipelineInput, 'wanted'> & { wanted: CcrWanted }
let selfTestContext: CcrSelfTestContext | null = null

export function setCcrSelfTestContext(context: CcrSelfTestContext | null): void {
  selfTestContext = context
}

export function ccrSelfTestContext(): CcrSelfTestContext | null {
  return selfTestContext
}

