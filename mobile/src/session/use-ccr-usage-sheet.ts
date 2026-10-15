import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { acquireCcrLink } from './ccr-link-registry'
import { askCcrContextUsage, CCR_CONTEXT_USAGE_TIMEOUT_MS, type CcrContextUsageAnswer, type CcrContextUsageAskDeps } from './ccr-context-usage'
import { newCcrEventUuid, postCcrSessionEvents } from './ccr-send'
import type { CcrEvent, CcrPlanRow } from './ccr-session-api'
import { ccrAccountForConfigDir, ccrSendTargetForTab, type CcrSendTarget } from './ccr-session-cache'
import { refreshCcrUsage, type CcrUsageReading } from './ccr-session-usage'
import { usageSheetAccount, type UsageContextFigure, type UsagePlanState } from './ccr-usage-sheet-model'
import { loadDefaultCcrPipelineDeps } from './use-ccr-session-images'
import type { ClaudeUsageSheetData } from './ClaudeUsageSheet'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

/**
 * The Usage sheet's data for a Claude tab, and the live context answer the ring shows.
 *
 * As the Claude app 1.261009.20 does it (ccr-context-usage.ts has the request): the session is
 * asked for its context when the sheet opens, when its refresh is tapped (taa.f via w530.t,
 * aa6.java:310; the tap also re-reads plan usage, the `t8` launched beside it), and again each time
 * a turn ends while it is asked about (n0l.java:103-117). An answer stands for the turn it was
 * given in (taa.g compares the turn). Here the first message after it ends it, so mid-turn the ring
 * follows the beacon again, which moves with the turn; then the ring falls back to what it showed
 * before. Here the ring is asked at every turn's end while the chat is open, so it
 * reads the session's own figure after each answer rather than the status line's a few seconds
 * behind (2026-10-15: 128k on the phone, 145.5k in the app).
 *
 * Every figure is the tab's OWN session and account (`ccrSendTargetForTab`): a copy of the session
 * under the other profile is never asked, and the plan cards show that account's rows or "Loading".
 */

type Entry = {
  sessionId: string
  accountId: string
  /** What the context was when the answer landed (`ccrContextKey` then). */
  contextKey: string | null
  answer: CcrContextUsageAnswer | null
  answeredAt: number | null
  ask: 'idle' | 'asking' | 'unanswered'
}

const entries = new Map<string, Entry>()
/** The last plan rows read per account, so a failed refresh keeps the rows already shown. */
const keptPlanRows = new Map<string, readonly CcrPlanRow[]>()
const listeners = new Set<() => void>()
let version = 0

function bump(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const currentVersion = (): number => version

export function resetCcrUsageSheetForTests(): void {
  entries.clear()
  keptPlanRows.clear()
  bump()
}

/** The turn the session is on: the newest `result` event's uuid (events oldest first), or null. */
export function ccrTurnKey(events: readonly CcrEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]!.payload
    if (payload.type === 'result') {
      return typeof payload.uuid === 'string' ? payload.uuid : (events[index]!.eventId ?? `#${index}`)
    }
  }
  return null
}

/** Events that change what the context holds: a message, a turn's end, a compaction, a clear. */
function movesContext(payload: Record<string, unknown>): boolean {
  switch (payload.type) {
    case 'user':
    case 'assistant':
    case 'result':
    case 'conversation_reset':
      return true
    case 'system':
      return payload.subtype === 'compact_boundary'
    default:
      return false
  }
}

/**
 * Where the session's context stands: the newest event that changes it (oldest first in), or null.
 * An answer stands while this is unchanged, so the next turn's first message hands the ring back to
 * the beacon, which moves with the turn; the request's own control events do not count.
 */
export function ccrContextKey(events: readonly CcrEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (movesContext(event.payload)) {
      return typeof event.payload.uuid === 'string' ? event.payload.uuid : (event.eventId ?? `#${index}`)
    }
  }
  return null
}

function entryFor(tabId: string, sessionId: string, accountId: string): Entry | null {
  const entry = entries.get(tabId)
  return entry && entry.sessionId === sessionId && entry.accountId === accountId ? entry : null
}

export type CcrUsageAskDeps = (accountId: string, sessionId: string) => { deps: CcrContextUsageAskDeps; release: () => void }

/** The real ask: through the tab's shared session link, its stream carrying the reply. */
export const defaultCcrUsageAskDeps: CcrUsageAskDeps = (accountId, sessionId) => {
  const held = acquireCcrLink(accountId, sessionId)
  return {
    deps: {
      waitForResponse: (requestId, timeoutMs) => held.link.controlWaiters.wait(requestId, timeoutMs),
      post: (body) => held.link.withSession((deps, account, session) => postCcrSessionEvents(deps, account, session, body)),
      newUuid: () => newCcrEventUuid(),
      log: (line) => console.log(line)
    },
    release: held.release
  }
}

/**
 * Asks the tab's own session for its context once; a second ask while one is out is not sent. The
 * outcome is kept for the tab: an answer (stamped with where the context stands when it LANDS, so a
 * slow reply that crossed a turn's end counts for the turn it was read in), "unanswered", or, when
 * the session refused, the earlier answer left as it was.
 */
export async function askCcrUsageForTab(tabId: string, target: CcrSendTarget, contextKeyNow: () => string | null, makeDeps: CcrUsageAskDeps, now: () => number = Date.now, timeoutMs = CCR_CONTEXT_USAGE_TIMEOUT_MS): Promise<void> {
  if (target.kind !== 'target') {
    return
  }
  const { sessionId, accountId } = target
  const before = entryFor(tabId, sessionId, accountId)
  if (before?.ask === 'asking') {
    return
  }
  entries.set(tabId, before ? { ...before, ask: 'asking' } : { sessionId, accountId, contextKey: null, answer: null, answeredAt: null, ask: 'asking' })
  bump()
  const held = makeDeps(accountId, sessionId)
  try {
    const outcome = await askCcrContextUsage(held.deps, sessionId, timeoutMs)
    const kept = entryFor(tabId, sessionId, accountId)
    if (!kept) {
      return
    }
    switch (outcome.kind) {
      case 'answer':
        entries.set(tabId, { ...kept, answer: outcome.answer, answeredAt: now(), contextKey: contextKeyNow(), ask: 'idle' })
        break
      case 'refused':
        entries.set(tabId, { ...kept, ask: 'idle' })
        break
      case 'unanswered':
        entries.set(tabId, { ...kept, ask: 'unanswered' })
        break
      default: {
        const unhandled: never = outcome
        return unhandled
      }
    }
    bump()
  } finally {
    held.release()
  }
}

/**
 * What the sheet shows before the session answers: the ring's own figure (the beacon or the badge,
 * as labels with the percent), else the session row's statement (counts), else nothing.
 */
export function ccrUsageFallbackFigure(context: TerminalHudContextWindow | null, reading: CcrUsageReading | null): Omit<UsageContextFigure, 'updatedAt'> | null {
  if (context) {
    // The beacon's labels when it gave them; a percent alone (the status line's bare "40%") too.
    return { usedTokens: null, windowTokens: null, usedLabel: context.usedLabel, windowLabel: context.windowLabel, percent: context.usedLabel && !context.windowLabel ? null : context.usedPercent }
  }
  if (reading?.context) {
    return { usedTokens: reading.context.usedTokens, windowTokens: reading.context.windowTokens, percent: null }
  }
  return null
}

export type CcrUsageSheetArgs = {
  enabled: boolean
  tabId: string | null
  epoch: number | null
  agentSessionId: string | null
  configDir: string | null
  /** The matched link's events, oldest first (for the turn's end). */
  events: readonly CcrEvent[]
  /** `useCcrSessionUsage`'s reading for the tab. */
  reading: CcrUsageReading | null
  /** What the ring shows when there is no live answer (beacon, row statement), for the sheet. */
  fallback: Omit<UsageContextFigure, 'updatedAt'> | null
  /** Passed to the plan re-read: the session's events are read for context only when nothing else states it. */
  needsContext: boolean
  askDeps?: CcrUsageAskDeps
  refreshPlan?: (tabId: string, epoch: number | null, agentSessionId: string | null, needsContext: boolean, configDir: string | null) => Promise<void>
}

const defaultRefreshPlan = async (tabId: string, epoch: number | null, agentSessionId: string | null, needsContext: boolean, configDir: string | null): Promise<void> =>
  refreshCcrUsage(tabId, epoch, await loadDefaultCcrPipelineDeps(), agentSessionId, needsContext, configDir)

export function useCcrUsageSheet(args: CcrUsageSheetArgs): {
  /** The live answer for the ring, for this tab's own session and the current turn; else null. */
  live: CcrContextUsageAnswer | null
  sheet: ClaudeUsageSheetData | null
  /** The sheet opened: ask the session, re-read the plan. */
  onOpen: () => void
} {
  useSyncExternalStore(subscribe, currentVersion, currentVersion)
  const { enabled, tabId, epoch, agentSessionId, configDir, events, reading, fallback, needsContext } = args
  const askDeps = args.askDeps ?? defaultCcrUsageAskDeps
  const refreshPlan = args.refreshPlan ?? defaultRefreshPlan
  const [refreshing, setRefreshing] = useState(false)
  const [planFailed, setPlanFailed] = useState<string | null>(null)
  const target: CcrSendTarget = enabled && tabId ? ccrSendTargetForTab(tabId, epoch, agentSessionId, configDir) : { kind: 'refused', reason: 'unmatched' }
  const turnKey = ccrTurnKey(events)
  const contextKey = ccrContextKey(events)
  const latest = useRef({ target, contextKey, askDeps, refreshPlan, tabId, epoch, agentSessionId, configDir, needsContext })
  latest.current = { target, contextKey, askDeps, refreshPlan, tabId, epoch, agentSessionId, configDir, needsContext }

  const ask = useCallback(() => {
    const now = latest.current
    if (now.tabId) {
      void askCcrUsageForTab(now.tabId, now.target, () => latest.current.contextKey, now.askDeps).catch((error: unknown) => {
        console.warn(`[ccr-context] could not ask: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }, [])

  const rereading = useRef(false)
  const rereadPlan = useCallback(() => {
    const now = latest.current
    if (!now.tabId || rereading.current) {
      return
    }
    rereading.current = true
    const account = usageSheetAccount(now.target, now.configDir ? ccrAccountForConfigDir(now.configDir) : null)
    setRefreshing(true)
    void now
      .refreshPlan(now.tabId, now.epoch, now.agentSessionId, now.needsContext, now.configDir)
      .then(
        () => setPlanFailed(null),
        (error: unknown) => {
          setPlanFailed(account)
          console.warn(`[ccr-usage] could not refresh: ${error instanceof Error ? error.message : String(error)}`)
        }
      )
      .finally(() => {
        rereading.current = false
        setRefreshing(false)
      })
  }, [])

  // A turn ended: the session is asked again, so the ring follows it. The first turn seen for a
  // session is where the phone came in, not an end it watched; nor is events coming back after
  // they went away (a relink, a resume): from no turn to one is not a turn ending.
  const seenTurn = useRef<{ key: string; turn: string | null } | null>(null)
  const sessionKey = target.kind === 'target' ? `${tabId}\u0000${target.accountId}\u0000${target.sessionId}` : null
  useEffect(() => {
    if (sessionKey === null) {
      seenTurn.current = null
      return
    }
    const seen = seenTurn.current
    seenTurn.current = { key: sessionKey, turn: turnKey }
    if (seen && seen.key === sessionKey && seen.turn !== null && turnKey !== null && seen.turn !== turnKey) {
      ask()
    }
  }, [sessionKey, turnKey, ask])

  if (!enabled || !tabId) {
    return { live: null, sheet: null, onOpen: () => undefined }
  }
  const account = usageSheetAccount(target, configDir ? ccrAccountForConfigDir(configDir) : null)
  if (target.kind !== 'target' && account === null) {
    // No session and no account of its own to read: the ring keeps the old card, which shows what
    // the beacon and the host state, rather than a sheet stuck on "Loading".
    return { live: null, sheet: null, onOpen: () => undefined }
  }
  const entry = target.kind === 'target' ? entryFor(tabId, target.sessionId, target.accountId) : null
  const live = entry?.answer && entry.contextKey === contextKey ? entry.answer : null
  const older = entry?.answer && !live ? { ...entry.answer, updatedAt: entry.answeredAt } : null
  const figure: UsageContextFigure | null = fallback ? { ...fallback, updatedAt: null } : older ? { usedTokens: older.usedTokens, windowTokens: older.windowTokens, percent: older.percent, updatedAt: older.updatedAt } : null
  const own = reading && account !== null && reading.accountId === account ? reading : null
  if (own?.planRows && account !== null) {
    keptPlanRows.set(account, own.planRows)
  }
  const plan: UsagePlanState | null =
    account === null
      ? null
      : {
          rows: own?.planRows ?? keptPlanRows.get(account) ?? null,
          failed: planFailed === account || (own !== null && own.planRows == null && own.limits === null)
        }
  return {
    live,
    sheet: {
      context: { answer: live, figure, ask: target.kind === 'target' ? (entry?.ask ?? 'idle') : 'idle' },
      plan,
      refreshing: refreshing || entry?.ask === 'asking',
      onRefresh: () => {
        ask()
        rereadPlan()
      }
    },
    onOpen: () => {
      ask()
      rereadPlan()
    }
  }
}
