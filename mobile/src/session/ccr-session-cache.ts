import AsyncStorage from '@react-native-async-storage/async-storage'
import { subscribeAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import type { CcrPipelineInput, CcrWanted } from './ccr-session-shared'
import { createPersistedMap } from './session-cache-persistence'

/**
 * What the session-API path keeps between runs: each tab's matched session
 * (for the relay connection it was matched on, and across restarts for the
 * Claude Code session it was matched for), the pictures found,
 * each tab's back-off after a failure, and the chat on screen for the
 * one-tap check.
 */

type CcrMapping = { sessionId: string; epoch: number | null; accountId: string; agentSessionId: string | null }

const mappingByTab = new Map<string, CcrMapping>()

/**
 * A match kept across restarts, for one tab's one Claude Code session: `<tab>\0<Claude Code
 * session id>` → the Remote Control session and the account it was found under. Keyed by the
 * Claude session as well as the tab, so a `/clear` or a `--resume` of another session in the same
 * tab never inherits it, and only taken while that account is still signed in. A tab whose Claude
 * session is not known keeps its match in memory only, for the connection, as before.
 */
type KeptCcrMapping = { sessionId: string; accountId: string }
const KEPT_MAPPINGS_KEY = 'codeui:ccr-session-mapping-v1'
const keptMappings = createPersistedMap<KeptCcrMapping>({ storageKey: KEPT_MAPPINGS_KEY, maxEntries: 200 })

function keptKey(tabId: string, agentSessionId: string): string {
  return `${tabId}\0${agentSessionId}`
}

/** Reads the kept matches into memory (app start, session-caches-hydrate.ts). */
export function hydrateCcrSessionMappings(): Promise<void> {
  return keptMappings.hydrate()
}

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

/** Remembers which account the tab's session was found under, so later reads use that account's
 *  token and organization; with the tab's Claude Code session id, kept across restarts too. */
export function setCcrMapping(tabId: string, sessionId: string, epoch: number | null, accountId: string, agentSessionId: string | null = null): void {
  mappingByTab.set(tabId, { sessionId, epoch, accountId, agentSessionId })
  if (agentSessionId) {
    keptMappings.set(keptKey(tabId, agentSessionId), { sessionId, accountId })
  }
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

/** Drops the tab's match, kept copy included, so the next run matches it again (the one-tap
 *  check, a session gone from the list, an account gone). */
export function forgetCcrMapping(tabId: string, agentSessionId: string | null = null): void {
  const mapped = mappingByTab.get(tabId)
  mappingByTab.delete(tabId)
  for (const id of new Set([mapped?.agentSessionId, agentSessionId])) {
    if (id) {
      keptMappings.delete(keptKey(tabId, id))
    }
  }
}

/**
 * The tab's match, if it stands: made on this connection, or kept for this very Claude Code
 * session (then adopted for this connection, with no request). A match made for another Claude
 * session of the tab is dropped here: the tab now shows a different conversation.
 */
function currentMapping(tabId: string, epoch: number | null, agentSessionId: string | null | undefined): CcrMapping | null {
  const mapped = mappingByTab.get(tabId)
  if (mapped && agentSessionId && mapped.agentSessionId && mapped.agentSessionId !== agentSessionId) {
    mappingByTab.delete(tabId)
  } else if (mapped && (mapped.epoch === epoch || (agentSessionId && mapped.agentSessionId === agentSessionId))) {
    if (mapped.epoch !== epoch) {
      mapped.epoch = epoch
    }
    return mapped
  }
  if (!agentSessionId) {
    return null
  }
  const kept = keptMappings.get(keptKey(tabId, agentSessionId))
  if (!kept) {
    return null
  }
  const adopted: CcrMapping = { sessionId: kept.sessionId, epoch, accountId: kept.accountId, agentSessionId }
  mappingByTab.set(tabId, adopted)
  return adopted
}

/** `agentSessionId`: the Claude Code session the tab shows now, when known. */
export function ccrSessionForTab(tabId: string, epoch: number | null, agentSessionId?: string | null): string | null {
  return currentMapping(tabId, epoch, agentSessionId)?.sessionId ?? null
}

/** The account the tab's session was matched under, while that match stands (ccrSessionForTab). */
export function ccrAccountForTab(tabId: string, epoch: number | null, agentSessionId?: string | null): string | null {
  return currentMapping(tabId, epoch, agentSessionId)?.accountId ?? null
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

// ─── Triggers ─────────────────────────────────────────────────────────────

/**
 * Events after which every open tab is matched again at once, waiting out no back-off: a sign-in,
 * a sign-out or a merge of accounts (anthropic-accounts-events.ts), and the app coming back to the
 * foreground. Each bumps one version the hooks key their run on: one run per event, never one per
 * render. Opening a tab and a change of its Claude session are the hooks' own keys.
 */
const triggerListeners = new Set<() => void>()
let triggerVersion = 0
const accountChangeListeners = new Set<() => void>()

export function subscribeCcrTriggers(listener: () => void): () => void {
  triggerListeners.add(listener)
  return () => {
    triggerListeners.delete(listener)
  }
}

export function ccrTriggerVersion(): number {
  return triggerVersion
}

/** For the pipeline: drop what was read under the old set of accounts (the shared session lists). */
export function onCcrAccountsChanged(listener: () => void): () => void {
  accountChangeListeners.add(listener)
  return () => {
    accountChangeListeners.delete(listener)
  }
}

export function triggerCcrRematch(reason: 'accounts' | 'foreground'): void {
  backoffByTab.clear()
  if (reason === 'accounts') {
    for (const listener of accountChangeListeners) {
      listener()
    }
  }
  triggerVersion += 1
  for (const listener of triggerListeners) {
    listener()
  }
}

subscribeAnthropicAccountsChanged(() => triggerCcrRematch('accounts'))

/** A cold start: memory goes, what was written to storage stays (the debounced write is let land). */
export async function restartCcrCacheForTests(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700))
  mappingByTab.clear()
  backoffByTab.clear()
  keptMappings.reset()
}

export function resetCcrCacheForTests(): void {
  keptMappings.reset()
  void AsyncStorage.removeItem(KEPT_MAPPINGS_KEY)
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

