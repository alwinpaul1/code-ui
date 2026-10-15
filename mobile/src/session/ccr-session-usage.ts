import { fetchCcrAccountUsage, listCcrSessionEvents, type CcrEvent, type CcrUsageWindow } from './ccr-session-api'
import { ccrAccountForTab, ccrSessionForTab } from './ccr-session-cache'
import { CCR_EVENT_PAGE_SIZE, defaultLog, maskId, reasonOf, type CcrPipelineDeps } from './ccr-session-shared'

/**
 * What Anthropic says about the TAB'S OWN session and account, for the context ring and the usage
 * rows (user, 2026-10-15: "if I'm on my work account, the context ring must show that account's
 * usage and that exact session's context usage").
 *
 *  - Context of THIS session, from its newest events (the payload is the transcript record):
 *    the latest MAIN-chain `assistant` message's `usage`, input + cache-creation + cache-read tokens,
 *    which is Claude Code's own `current_usage` for the status line (the beacon script adds the same
 *    three, agent-hud-launch-args.ts). Sub-agent turns (`isSidechain`) run in their own context and
 *    are skipped. The WINDOW is used only when the session states it: the newest `result` event's
 *    `modelUsage[<that model>].contextWindow` (Claude Code's SDK result, 2.1.300). No such figure:
 *    tokens with no percentage, never a guess from the model's name (CLAUDE.md).
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
  sessionId: string
  accountId: string
  epoch: number | null
  fetchedAt: number
  /** Plan windows, or null when the account's usage could not be read. */
  limits: readonly CcrUsageWindow[] | null
  /** The session's context, or null when its events held no main-chain assistant usage. */
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
 * The session's context from its events, NEWEST FIRST (the order the API returns them): the newest
 * main-chain assistant turn's tokens, and the window its model's newest `result` states.
 */
export function ccrContextOfEvents(events: readonly CcrEvent[]): CcrSessionContext | null {
  let used: number | null = null
  let model: string | null = null
  const windows = new Map<string, number>()
  for (const { payload } of events) {
    if (payload.type === 'assistant' && used === null && payload.isSidechain !== true) {
      const message = record(payload.message)
      const usage = record(message?.usage)
      // A synthetic turn (an interruption notice) carries all-zero usage and is not a reading.
      if (usage && message?.model !== '<synthetic>') {
        const total = count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens)
        if (total > 0) {
          used = total
          model = typeof message?.model === 'string' ? message.model : null
        }
      }
    } else if (payload.type === 'result') {
      for (const [name, entry] of Object.entries(record(payload.modelUsage) ?? {})) {
        const stated = record(entry)?.contextWindow
        if (!windows.has(name) && typeof stated === 'number' && Number.isFinite(stated) && stated > 0) {
          windows.set(name, stated)
        }
      }
    }
  }
  if (used === null) {
    return null
  }
  return { usedTokens: used, windowTokens: model !== null ? (windows.get(model) ?? null) : null }
}

/** Newest events read for the context: one page, and a second only when the first held no
 *  assistant turn (most events are `system`). */
const CONTEXT_PAGES = 2

async function readContext(deps: CcrPipelineDeps, auth: { token: string; organizationUuid: string }, sessionId: string): Promise<CcrSessionContext | null> {
  const events: CcrEvent[] = []
  let cursor: string | null = null
  for (let page = 0; page < CONTEXT_PAGES; page += 1) {
    const result = await listCcrSessionEvents(deps.fetch, auth, sessionId, { cursor, limit: CCR_EVENT_PAGE_SIZE })
    events.push(...result.events)
    const context = ccrContextOfEvents(events)
    if (context !== null && context.windowTokens !== null) {
      return context
    }
    if (!result.nextCursor || result.nextCursor === cursor) {
      return context
    }
    cursor = result.nextCursor
  }
  return ccrContextOfEvents(events)
}

/**
 * Re-reads the matched tab's usage: the account's plan windows and the session's context. Only the
 * account the tab matched under is asked, with only its token refreshed. Not matched on this
 * connection: nothing. That account signed out: the reading is dropped.
 * `needContext` false skips the events read (a live beacon or screen already states the context).
 */
export async function refreshCcrUsage(
  tabId: string,
  epoch: number | null,
  deps: CcrPipelineDeps,
  agentSessionId: string | null,
  needContext: boolean
): Promise<void> {
  const sessionId = ccrSessionForTab(tabId, epoch, agentSessionId)
  const accountId = ccrAccountForTab(tabId, epoch, agentSessionId)
  if (!sessionId || !accountId) {
    return
  }
  const log = deps.log ?? defaultLog
  const say = (ok: boolean, detail: string) => log(`[ccr-usage] ${ok ? 'ok' : 'failed'} — ${detail} (tab ${maskId(tabId)})`, ok)
  try {
    const accounts = await deps.accounts.list(accountId)
    const account = accounts.find((entry) => entry.id === accountId)
    const token = account?.accessToken ?? null
    if (!account || !token) {
      forgetCcrUsage(tabId)
      say(false, !account ? 'the account this tab matched under is no longer signed in' : `${account.label}: ${account.error ?? 'no usable token'}`)
      return
    }
    const [limits, context] = await Promise.all([
      fetchCcrAccountUsage(deps.fetch, token).then(
        (windows): readonly CcrUsageWindow[] | null => windows,
        (error: unknown) => {
          say(false, `plan usage: ${reasonOf(error)}`)
          return null
        }
      ),
      needContext && account.organizationUuid
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
