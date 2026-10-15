import { fetchCcrAccountUsage, listCcrSessionEvents, type CcrEvent, type CcrSessionRow, type CcrUsageWindow } from './ccr-session-api'
import { ccrAccountForConfigDir, ccrAccountForTab, ccrSessionForTab } from './ccr-session-cache'
import { CCR_EVENT_PAGE_SIZE, defaultLog, maskId, reasonOf, type CcrPipelineDeps } from './ccr-session-shared'

/**
 * What Anthropic says about the TAB'S OWN session and account, for the context ring and the usage
 * rows (user, 2026-10-15: "if I'm on my work account, the context ring must show that account's
 * usage and that exact session's context usage").
 *
 *  - Context of THIS session, from the session's own statement: its row's
 *    `external_metadata.context_usage` `{used_tokens, max_tokens}`, which Claude Code writes each turn
 *    (2.1.300 `ct()`: the latest response's input + cache creation + cache read, and the window it
 *    works to) and the Claude app's ring reads (afu.java, iju.java:29). Both numbers are the agent's,
 *    so the ring gets its denominator the way the app's does. The row arrives with the model re-read
 *    (`noteModel`, ccr-session-model-refresh.ts).
 *    Without it (a CLI too old to write it; live 2026-10-15 the `result` event's `modelUsage` is `{}`,
 *    so no window is stated there): the newest MAIN-chain `assistant` event's `usage`, the same three
 *    token counts, with NO window: tokens and no percentage, never a guess from the model's name
 *    (CLAUDE.md). Sub-agent turns (`isSidechain`) run in their own context and are skipped.
 *  - Plan usage (5-hour and weekly) of the account the tab MATCHED under, asked with that account's
 *    token (`fetchCcrAccountUsage`), never the host's feed, which is whichever login Orca holds.
 *
 * Both are read together once a minute with the model (use-ccr-session-model.ts), and each fails on
 * its own: a refused usage call leaves the context, and the reverse. A reading is used only while it
 * is fresh, from this connection, and for the session and account the tab is matched to NOW.
 */

export const CCR_USAGE_FRESH_MS = 150_000

export type CcrSessionContext = { usedTokens: number; windowTokens: number | null }

export type CcrUsageReading = {
  /** Null for a tab not matched yet, read through its config dir's account: limits only. */
  sessionId: string | null
  accountId: string
  epoch: number | null
  fetchedAt: number
  /** Plan windows, or null when the account's usage could not be read. */
  limits: readonly CcrUsageWindow[] | null
  /** The session's context, or null when neither its row nor its events state one. */
  context: CcrSessionContext | null
}

const readings = new Map<string, CcrUsageReading>()
const listeners = new Set<() => void>()
let version = 0

function bump(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

/** How many accounts the phone is signed in to, as the last read found them; null before any read. */
let signedInAccounts: number | null = null

export function ccrSignedInAccountCount(): number | null {
  return signedInAccounts
}

function noteSignedInAccounts(count: number): void {
  if (signedInAccounts !== count) {
    signedInAccounts = count
    bump()
  }
}

export function recordCcrUsage(tabId: string, reading: CcrUsageReading): void {
  readings.set(tabId, reading)
  bump()
}

export function forgetCcrUsage(tabId: string): void {
  if (readings.delete(tabId)) {
    bump()
  }
}

export function subscribeCcrUsage(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function ccrUsageVersion(): number {
  return version
}

/** The tab's reading while fresh, from this connection, and for the session and account it is
 *  matched to now; another account's or another session's reading is never returned. */
export function ccrUsageForTab(
  tabId: string,
  epoch: number | null,
  sessionId: string | null,
  accountId: string | null,
  now = Date.now()
): CcrUsageReading | null {
  const reading = readings.get(tabId)
  if (
    !reading ||
    reading.epoch !== epoch ||
    reading.sessionId !== sessionId ||
    reading.accountId !== accountId ||
    now - reading.fetchedAt > CCR_USAGE_FRESH_MS
  ) {
    return null
  }
  return reading
}

export function resetCcrUsageForTests(): void {
  signedInAccounts = null
  rowContexts.clear()
  readings.clear()
  bump()
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * The session's context tokens from its events, NEWEST FIRST (the order the API returns them): the
 * newest main-chain assistant turn's tokens. No window: events never state one (see the top).
 */
export function ccrContextOfEvents(events: readonly CcrEvent[]): CcrSessionContext | null {
  for (const { payload } of events) {
    if (payload.type !== 'assistant' || payload.isSidechain === true) {
      continue
    }
    const message = record(payload.message)
    const usage = record(message?.usage)
    // A synthetic turn (an interruption notice) carries all-zero usage and is not a reading.
    if (usage && message?.model !== '<synthetic>') {
      const total = count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens)
      if (total > 0) {
        return { usedTokens: total, windowTokens: null }
      }
    }
  }
  return null
}

/** Newest events read for the context tokens: one page, and a second only when the first held no
 *  assistant turn (most events are `system`). */
const CONTEXT_PAGES = 2

async function readContext(deps: CcrPipelineDeps, auth: { token: string; organizationUuid: string }, sessionId: string): Promise<CcrSessionContext | null> {
  let cursor: string | null = null
  for (let page = 0; page < CONTEXT_PAGES; page += 1) {
    const result = await listCcrSessionEvents(deps.fetch, auth, sessionId, { cursor, limit: CCR_EVENT_PAGE_SIZE })
    const context = ccrContextOfEvents(result.events)
    if (context !== null || !result.nextCursor || result.nextCursor === cursor) {
      return context
    }
    cursor = result.nextCursor
  }
  return null
}

const rowContexts = new Map<string, { sessionId: string; epoch: number | null; context: CcrSessionContext }>()

/** Keeps the context a session row states for itself (`external_metadata.context_usage`), or drops the
 *  tab's when the row states none. Called with the row each model re-read has in hand. */
export function noteCcrRowContext(tabId: string, epoch: number | null, row: Pick<CcrSessionRow, 'id' | 'contextUsage'>): void {
  if (row.contextUsage) {
    rowContexts.set(tabId, { sessionId: row.id, epoch, context: { usedTokens: row.contextUsage.usedTokens, windowTokens: row.contextUsage.maxTokens } })
  } else {
    rowContexts.delete(tabId)
  }
}

/**
 * Re-reads the matched tab's usage: the account's plan windows and the session's context. Only the
 * account the tab matched under is asked, with only its token refreshed. Not matched on this
 * connection: nothing. That account signed out: the reading is dropped.
 * The row's own statement is used when it has one; `needContext` false skips the events fallback
 * (a live beacon or screen already states the context).
 */
export async function refreshCcrUsage(
  tabId: string,
  epoch: number | null,
  deps: CcrPipelineDeps,
  agentSessionId: string | null,
  needContext: boolean,
  configDir: string | null = null
): Promise<void> {
  const sessionId = ccrSessionForTab(tabId, epoch, agentSessionId, configDir)
  const accountId = ccrAccountForTab(tabId, epoch, agentSessionId, configDir)
  const log = deps.log ?? defaultLog
  const say = (ok: boolean, detail: string) => log(`[ccr-usage] ${ok ? 'ok' : 'failed'} — ${detail} (tab ${maskId(tabId)})`, ok)
  if (!sessionId || !accountId) {
    await refreshBoundAccountUsage(tabId, epoch, deps, configDir, say)
    return
  }
  try {
    const accounts = await deps.accounts.list(accountId)
    const account = accounts.find((entry) => entry.id === accountId)
    const token = account?.accessToken ?? null
    if (!account || !token) {
      forgetCcrUsage(tabId)
      say(false, !account ? 'the account this tab matched under is no longer signed in' : `${account.label}: ${account.error ?? 'no usable token'}`)
      return
    }
    const kept = rowContexts.get(tabId)
    const stated = kept && kept.sessionId === sessionId && kept.epoch === epoch ? kept.context : null
    const [limits, context] = await Promise.all([
      fetchCcrAccountUsage(deps.fetch, token).then(
        (windows): readonly CcrUsageWindow[] | null => windows,
        (error: unknown) => {
          say(false, `plan usage: ${reasonOf(error)}`)
          return null
        }
      ),
      stated !== null
        ? Promise.resolve(stated)
        : needContext && account.organizationUuid
        ? readContext(deps, { token, organizationUuid: account.organizationUuid }, sessionId).catch((error: unknown) => {
            say(false, `session context: ${reasonOf(error)}`)
            return null
          })
        : Promise.resolve(null)
    ])
    recordCcrUsage(tabId, { sessionId, accountId, epoch, fetchedAt: Date.now(), limits, context })
    say(
      true,
      `${account.label}: ${limits === null ? 'plan usage unread' : `${limits.length} plan window(s)`}, context ${
        context === null ? 'unread' : `${context.usedTokens} tokens${context.windowTokens === null ? ', window not stated' : ` of ${context.windowTokens}`}`
      }`
    )
  } catch (error) {
    forgetCcrUsage(tabId)
    say(false, reasonOf(error))
  }
}

/**
 * A tab not matched to a session yet: its plan usage through the account its Claude config dir was
 * last matched under (`~/.claude-work` is the work account), so the rows are that account's from the
 * first second. No binding: no reading, and the count of signed-in accounts is kept so the rows know
 * whether the host's feed may stand in (one account) or not (several). The session's context stays
 * unknown until the match lands.
 */
async function refreshBoundAccountUsage(
  tabId: string,
  epoch: number | null,
  deps: CcrPipelineDeps,
  configDir: string | null,
  say: (ok: boolean, detail: string) => void
): Promise<void> {
  try {
    const entries = await deps.accounts.list().catch((error: unknown) => {
      say(false, `the sign-in could not be read: ${reasonOf(error)}`)
      return []
    })
    noteSignedInAccounts(entries.length)
    const boundId = configDir ? ccrAccountForConfigDir(configDir) : null
    const account = boundId ? entries.find((entry) => entry.id === boundId) : undefined
    if (!account?.accessToken) {
      forgetCcrUsage(tabId)
      return
    }
    const limits = await fetchCcrAccountUsage(deps.fetch, account.accessToken).catch((error: unknown) => {
      say(false, `plan usage: ${reasonOf(error)}`)
      return null
    })
    recordCcrUsage(tabId, { sessionId: null, accountId: account.id, epoch, fetchedAt: Date.now(), limits, context: null })
  } catch (error) {
    forgetCcrUsage(tabId)
    say(false, reasonOf(error))
  }
}
