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

/** `configDir`: the Claude config dir the tab's session wrote under when it was matched, or null when
 *  that was not known (or the match was kept by a build that did not record it). */
type CcrMapping = { sessionId: string; epoch: number | null; accountId: string; agentSessionId: string | null; configDir: string | null }

const mappingByTab = new Map<string, CcrMapping>()

/**
 * A match kept across restarts, for one tab's one Claude Code session: `<tab>\0<Claude Code
 * session id>` → the Remote Control session and the account it was found under. Keyed by the
 * Claude session as well as the tab, so a `/clear` or a `--resume` of another session in the same
 * tab never inherits it, and only taken while that account is still signed in. A tab whose Claude
 * session is not known keeps its match in memory only, for the connection, as before.
 */
type KeptCcrMapping = { sessionId: string; accountId: string; configDir?: string | null }
const KEPT_MAPPINGS_KEY = 'codeui:ccr-session-mapping-v1'
const keptMappings = createPersistedMap<KeptCcrMapping>({ storageKey: KEPT_MAPPINGS_KEY, maxEntries: 200 })

function keptKey(tabId: string, agentSessionId: string): string {
  return `${tabId}\0${agentSessionId}`
}

/**
 * Which account a Claude config dir's sessions were last matched under: `~/.claude` (a tab started
 * with `claude`) and `~/.claude-work` (one started with `CLAUDE_CONFIG_DIR=~/.claude-work`) belong
 * to different accounts, and a new tab of either is asked of its own account first. Read from the
 * transcript path Orca reports for the tab, so nothing is set up on the desktop. Learned from a
 * match, overwritten by a later match that says otherwise, dropped when the account signs out.
 */
const CONFIG_DIR_ACCOUNTS_KEY = 'codeui:ccr-config-dir-account-v1'
const configDirAccounts = createPersistedMap<string>({ storageKey: CONFIG_DIR_ACCOUNTS_KEY, maxEntries: 50 })

export function ccrAccountForConfigDir(configDir: string): string | null {
  return configDirAccounts.get(configDir) ?? null
}

export function bindCcrConfigDir(configDir: string, accountId: string): void {
  if (configDirAccounts.get(configDir) !== accountId) {
    configDirAccounts.set(configDir, accountId)
  }
}

function unbindSignedOut(signedOut: string | 'all'): void {
  for (const [configDir, accountId] of configDirAccounts.entries()) {
    if (signedOut === 'all' || accountId === signedOut) {
      configDirAccounts.delete(configDir)
    }
  }
}

/** Reads the kept matches and config-dir accounts into memory (app start, session-caches-hydrate.ts). */
export function hydrateCcrSessionMappings(): Promise<void> {
  return Promise.all([keptMappings.hydrate(), configDirAccounts.hydrate()]).then(() => undefined)
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
export function setCcrMapping(
  tabId: string,
  sessionId: string,
  epoch: number | null,
  accountId: string,
  agentSessionId: string | null = null,
  configDir: string | null = null
): void {
  mappingByTab.set(tabId, { sessionId, epoch, accountId, agentSessionId, configDir })
  if (agentSessionId) {
    keptMappings.set(keptKey(tabId, agentSessionId), { sessionId, accountId, configDir })
  }
}

/** The Anthropic session the tab is matched to, whatever connection or Claude Code session the
 *  match was made on: the workspace list has neither, and asks only whether facts read for a tab
 *  are about the session it is matched to now (ccr-session-facts.ts `ccrSessionFactsForAgent`). A
 *  match dropped for another Claude Code session (`currentMapping`) is gone from here too. */
export function ccrMappedSessionForTab(tabId: string): string | null {
  return mappingByTab.get(tabId)?.sessionId ?? null
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
 * Whether a match was made while the tab's session wrote under another Claude config dir than it
 * does now, so it is not this tab's session any more. A session copied from `~/.claude-work` to
 * `~/.claude` and resumed in the same pane keeps its Claude session id, but takes a new Remote
 * Control session under the other account; the match kept for the id named the old one, and the
 * tab drew the work account's transcript and its "Limit reached" on a personal session (user,
 * 2026-10-15). A match recorded with no config dir (kept by an earlier build) is moved on only by
 * evidence: the tab's config dir is bound to another account than the match's. Nothing is
 * dropped when the tab's config dir is not known.
 */
function movedConfigDir(mapping: Pick<CcrMapping, 'accountId' | 'configDir'>, configDir: string | null | undefined): boolean {
  if (!configDir) {
    return false
  }
  if (mapping.configDir) {
    return mapping.configDir !== configDir
  }
  const bound = configDirAccounts.get(configDir)
  return bound !== undefined && bound !== mapping.accountId
}

/**
 * The tab's match, if it stands: made on this connection, or kept for this very Claude Code
 * session (then adopted for this connection, with no request). A match made for another Claude
 * session of the tab, or under another Claude config dir (`movedConfigDir`), is dropped here: the
 * tab now shows a different conversation, or the same one on another account.
 */
function currentMapping(tabId: string, epoch: number | null, agentSessionId: string | null | undefined, configDir: string | null | undefined): CcrMapping | null {
  const mapped = mappingByTab.get(tabId)
  if (mapped && agentSessionId && mapped.agentSessionId && mapped.agentSessionId !== agentSessionId) {
    mappingByTab.delete(tabId)
  } else if (mapped && movedConfigDir(mapped, configDir)) {
    forgetCcrMapping(tabId, agentSessionId ?? null)
    return null
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
  const adopted: CcrMapping = { sessionId: kept.sessionId, epoch, accountId: kept.accountId, agentSessionId, configDir: kept.configDir ?? null }
  if (movedConfigDir(adopted, configDir)) {
    keptMappings.delete(keptKey(tabId, agentSessionId))
    return null
  }
  mappingByTab.set(tabId, adopted)
  return adopted
}

/** `agentSessionId`: the Claude Code session the tab shows now, when known. `configDir`: the Claude
 *  config dir it writes under now, when known; a match made under another one does not stand. */
export function ccrSessionForTab(tabId: string, epoch: number | null, agentSessionId?: string | null, configDir?: string | null): string | null {
  return currentMapping(tabId, epoch, agentSessionId, configDir)?.sessionId ?? null
}

/** The account the tab's session was matched under, while that match stands (ccrSessionForTab). */
export function ccrAccountForTab(tabId: string, epoch: number | null, agentSessionId?: string | null, configDir?: string | null): string | null {
  return currentMapping(tabId, epoch, agentSessionId, configDir)?.accountId ?? null
}

/** Where a Claude tab's message may be posted (ccr-send.ts), or why it may not. */
export type CcrSendTarget =
  | { kind: 'target'; sessionId: string; accountId: string }
  | { kind: 'refused'; reason: 'profile-unknown' | 'unmatched' | 'other-account' | 'unsettled' }

/**
 * The tab's send target: the Remote Control session it is matched to, under the account its own
 * Claude config dir belongs to, and nothing else (the user, 2026-10-15: "it must work for that
 * claude session and that profile of that session exactly"). A session copied between profiles
 * exists in both accounts (`~/.claude` and `~/.claude-work` each publish their own `cse_…`), so
 * reading a match is not enough to post into it:
 *  - the tab's config dir must be known (`profile-unknown` otherwise: there is no telling which
 *    copy is this tab's);
 *  - the match must stand for it (`unmatched`: none, or dropped by `currentMapping` because the
 *    tab moved to another config dir or another Claude session);
 *  - the config dir must not be bound to another account than the match's (`other-account`);
 *  - and the match must have been made under this very config dir, or the dir be bound to its
 *    account (`unsettled`: a match kept by an older build with no config dir, not yet confirmed).
 */
export function ccrSendTargetForTab(tabId: string, epoch: number | null, agentSessionId: string | null | undefined, configDir: string | null | undefined): CcrSendTarget {
  if (!configDir) {
    return { kind: 'refused', reason: 'profile-unknown' }
  }
  const mapping = currentMapping(tabId, epoch, agentSessionId, configDir)
  if (!mapping) {
    return { kind: 'refused', reason: 'unmatched' }
  }
  const bound = configDirAccounts.get(configDir)
  if (bound !== undefined && bound !== mapping.accountId) {
    return { kind: 'refused', reason: 'other-account' }
  }
  if (mapping.configDir !== configDir && bound !== mapping.accountId) {
    return { kind: 'refused', reason: 'unsettled' }
  }
  return { kind: 'target', sessionId: mapping.sessionId, accountId: mapping.accountId }
}

// ─── Back-off ─────────────────────────────────────────────────────────────

const BACKOFF_FIRST_MS = 30_000
const BACKOFF_MAX_MS = 10 * 60_000
/** A tab whose session is not found yet tries again after these waits before the long back-off:
 *  a session just started may be listed, or carry the tab's first messages, a moment later. */
export const CCR_QUICK_RETRY_MS: readonly number[] = [500, 1_000, 2_000, 4_000]
const backoffByTab = new Map<string, { until: number; tries: number; epoch: number | null }>()

/** Whether the tab may run now: no failure on record, its wait is over, or
 *  the relay has connected anew since (CLAUDE.md, "Nothing stays stale once
 *  the relay connects"). */
export function ccrMayRun(tabId: string, epoch: number | null, now = Date.now()): boolean {
  const backoff = backoffByTab.get(tabId)
  return !backoff || backoff.epoch !== epoch || backoff.until <= now
}

/** `quick`: the session was not found (rather than a sign-in or the API refusing), so the first
 *  CCR_QUICK_RETRY_MS waits apply before the back-off doubles from BACKOFF_FIRST_MS. */
export function recordCcrFailure(tabId: string, epoch: number | null, now: number, quick = false): void {
  const before = backoffByTab.get(tabId)
  const tries = before && before.epoch === epoch ? before.tries + 1 : 1
  const quickWait = quick ? CCR_QUICK_RETRY_MS[tries - 1] : undefined
  const slowTries = quick ? tries - CCR_QUICK_RETRY_MS.length : tries
  const wait = quickWait ?? Math.min(BACKOFF_FIRST_MS * 2 ** (slowTries - 1), BACKOFF_MAX_MS)
  backoffByTab.set(tabId, { until: now + wait, tries, epoch })
}

/** When the tab may try again, if it is waiting: the hook times its quick retries by this. */
export function ccrRetryAt(tabId: string, epoch: number | null): number | null {
  const backoff = backoffByTab.get(tabId)
  return backoff && backoff.epoch === epoch ? backoff.until : null
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

export function triggerCcrRematch(reason: 'accounts' | 'foreground', signedOut?: string | 'all'): void {
  if (signedOut) {
    unbindSignedOut(signedOut)
  }
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

subscribeAnthropicAccountsChanged((change) => triggerCcrRematch('accounts', change.signedOut))

/** A cold start: memory goes, what was written to storage stays (the debounced write is let land). */
export async function restartCcrCacheForTests(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700))
  mappingByTab.clear()
  backoffByTab.clear()
  keptMappings.reset()
  configDirAccounts.reset()
}

export function resetCcrCacheForTests(): void {
  keptMappings.reset()
  configDirAccounts.reset()
  void AsyncStorage.removeItem(KEPT_MAPPINGS_KEY)
  void AsyncStorage.removeItem(CONFIG_DIR_ACCOUNTS_KEY)
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

