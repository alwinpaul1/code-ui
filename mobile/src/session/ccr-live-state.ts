import type { CcrEvent } from './ccr-session-api'
import { decodeCcrEvent, isCcrInterruptEvent } from './ccr-transcript-decode'

/**
 * A Claude tab's LIVE state, read from Anthropic's copy of its Remote Control session, as the
 * Claude app reads it (com.anthropic.claude 1.261009.20, jadx, read 2026-10-15). The relay to the
 * desktop is not needed: on 2026-10-15 12:29-12:31 the relay was down for 1.5 minutes while the
 * Claude app, on the same session, still showed "Generating… · 2 running tasks" and its limit
 * banner. This is what lets a Code UI tab do the same.
 *
 * What each field is read from:
 *
 *  - `working`: a turn is open. The app ends a turn on `result` (qhu.java:905-938) and on the
 *    interrupt marker `[Request interrupted by user]` (qhu.java:670-675). A turn is open when a
 *    top-level `user` or `assistant` event came after the last of those. Nothing is claimed from
 *    events that were only read from the phone's kept copy (`liveFrom`): that copy keeps the rows
 *    and drops `result`, so a finished turn read from it would look open for ever. A session
 *    Anthropic calls `disconnected` is not working (its Claude Code is not attached).
 *  - `turnStartedAt`: the app's `y6y.d` (y6y.java:76-150), the time of the turn's prompt; here the
 *    first top-level user or assistant event of the open turn, its `created_at`.
 *  - `thinking`: the app's `su8.f7` (com.anthropic.claude 1.261013.20, read 2026-10-16; zr8 case
 *    15: `gzy.c() != null`, with no dialog or permission state over it). `gzy.o`, behind `c()`, is
 *    set only by `ThinkingTokensChanged` with its block open (`olv`, emitted for a `system`
 *    `thinking_tokens` that moved the count, t5v.java:1058-1061; handled in
 *    sessions/store/a.d, classes3 dex 0x700-0x7de) and cleared by `ThinkingBlockClosed` (`nlv`, a
 *    top-level assistant message after such tokens, t5v.java:846-848; a.d 0x7df-0x82e) and by the
 *    resets at a typed prompt and the result (t5v.L) and an interrupt (t5v.s). So thinking is: a
 *    `thinking_tokens` moved the count since the last top-level assistant message. Neither the
 *    prompt, a thinking-only message nor the stream's content blocks set it. Until 2026-10-16 this
 *    was inferred from those, and a turn waiting on a tool read "thinking some more…" where the
 *    app drew its verb (the user's screenshots of one moment, 2026-10-16).
 *  - `thinkingTokens`: `system` `thinking_tokens` (`estimated_tokens`, `estimated_tokens_delta`,
 *    omt.java:30-31), summed as the app's `j8y`/`v0z` does (v0z.java): a block's figure is the
 *    larger of its running delta sum and its estimate, and it is committed when a top-level
 *    assistant message lands (v0z.a). The figure outlives the block (the app's `gzy.m` is cleared
 *    only by the resets): it starts over at a typed prompt and with the turn. Null when there were
 *    none since.
 *  - `runningTasks`: the newest top-level `system` `background_tasks_changed`: its `tasks` array,
 *    each entry with a non-blank `task_id` (qhu.java:2296-2335). Null when none is held: unknown,
 *    not zero.
 *  - `compacting`: the newest `system` `status` says `status: "compacting"` (qhu.java:984-991).
 *  - `rateLimit`: the newest top-level `rate_limit_event`'s `rate_limit_info` (klt.java, mlt.java:
 *    `status`, `rateLimitType`, `resetsAt` epoch seconds, `isUsingOverage`, `utilization`,
 *    `overageStatus`; shapes confirmed live 2026-10-15, scratchpad/probe/p8-result.json: `status`
 *    allowed / allowed_warning / rejected, `rateLimitType` five_hour / seven_day, plus
 *    `unifiedWindows` not read here), read as the app reads it (a430.java:881-897): `rejected` is the limit
 *    reached, `allowed_warning` with a reset time is approaching, `allowed` is clear. A status not
 *    on that list is refused (null), never guessed.
 *
 * Subagent events (`parent_tool_use_id` set) are not the lead's turn and are skipped throughout,
 * as the app skips them (qhu.java:2296).
 */

export type CcrRateLimitState = {
  kind: 'approaching' | 'reached' | 'clear'
  /** Epoch seconds, as the event states it; null when it states none. */
  resetsAt: number | null
  rateLimitType: string | null
  isUsingOverage: boolean
  /** 0..1 as the event states it, or null. */
  utilization: number | null
  overageStatus: string | null
}

export type CcrLiveState = {
  working: boolean
  turnStartedAt: number | null
  thinking: boolean
  thinkingTokens: number | null
  runningTasks: number | null
  compacting: boolean
  rateLimit: CcrRateLimitState | null
}

export const CCR_IDLE_LIVE_STATE: CcrLiveState = {
  working: false,
  turnStartedAt: null,
  thinking: false,
  thinkingTokens: null,
  runningTasks: null,
  compacting: false,
  rateLimit: null
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function topLevel(payload: Record<string, unknown>): boolean {
  const parent = payload.parent_tool_use_id
  return !(typeof parent === 'string' && parent.length > 0)
}

/** An epoch time as seconds. The app reads `resetsAt` as seconds (`Instant.ofEpochSecond`,
 *  a430.java:884-887); the live capture of 2026-10-15 (scratchpad/probe/p8-result.json) recorded
 *  only that it is a number. A figure of 10^12 or more cannot be seconds (that is the year 33658)
 *  and is read as milliseconds rather than drawn as a reset thirty thousand years away. */
function epochSeconds(value: number | null): number | null {
  return value === null ? null : value >= 1e12 ? Math.floor(value / 1000) : value
}

/** The `rate_limit_info` of a `rate_limit_event`, as the app reads it; null for a shape it would not. */
export function readCcrRateLimit(payload: Record<string, unknown>): CcrRateLimitState | null {
  const info = rec(payload.rate_limit_info)
  if (!info || typeof info.status !== 'string') {
    return null
  }
  const resetsAt = epochSeconds(num(info.resetsAt))
  const base = {
    resetsAt,
    rateLimitType: typeof info.rateLimitType === 'string' ? info.rateLimitType : null,
    isUsingOverage: info.isUsingOverage === true,
    utilization: num(info.utilization),
    overageStatus: typeof info.overageStatus === 'string' ? info.overageStatus : null
  }
  switch (info.status) {
    case 'rejected':
      return { kind: 'reached', ...base }
    case 'allowed_warning':
      // The app draws the warning only with a reset time (a430.java:893).
      return resetsAt === null ? { kind: 'clear', ...base } : { kind: 'approaching', ...base }
    case 'allowed':
      return { kind: 'clear', ...base }
    default:
      return null
  }
}

/** The count a `background_tasks_changed` states, or null when its `tasks` is not a list. */
function runningTaskCount(payload: Record<string, unknown>): number | null {
  if (!Array.isArray(payload.tasks)) {
    return null
  }
  let count = 0
  for (const task of payload.tasks) {
    const id = rec(task)?.task_id
    if (typeof id === 'string' && id.trim().length > 0) {
      count += 1
    }
  }
  return count
}

type TurnSignal = 'prompt' | 'thinking' | 'output' | 'end' | 'other'

/** What one top-level user or assistant event says about the lead's turn. */
function turnSignal(event: CcrEvent): TurnSignal {
  // Stop's marker draws no row (the Claude app's rule) but still ends the turn.
  if (isCcrInterruptEvent(event)) {
    return 'end'
  }
  const rows = decodeCcrEvent(event)
  if (rows.some((row) => row.role === 'user')) {
    return 'prompt'
  }
  if (rows.some((row) => row.role === 'assistant' || row.role === 'tool')) {
    return 'output'
  }
  if (rows.some((row) => row.role === 'reasoning')) {
    return 'thinking'
  }
  return 'other'
}

/**
 * The live state from a link's events (oldest first). `liveFrom`: the sequence number up to which
 * the events were read from the phone's kept copy rather than from Anthropic (0 when none were);
 * the turn is judged only from what came after it.
 */
export function deriveCcrLiveState(
  events: readonly CcrEvent[],
  options: { liveFrom: number; connectionStatus: string | null }
): CcrLiveState {
  let runningTasks: number | null = null
  let compacting = false
  let rateLimit: CcrRateLimitState | null = null
  // The open turn, judged from events after the kept copy only.
  let open = false
  let turnStartedAt: number | null = null
  // `gzy.o != null`: a thinking_tokens moved the count since the last top-level assistant message.
  let thinkingOpen = false
  let committedTokens = 0
  let blockTokens = 0
  let sawTokens = false
  let blockHasDelta = false
  for (const event of events) {
    const payload = event.payload
    if (!topLevel(payload)) {
      continue
    }
    const live = (event.sequenceNum ?? Number.MAX_SAFE_INTEGER) > options.liveFrom
    switch (payload.type) {
      case 'system': {
        if (payload.subtype === 'background_tasks_changed') {
          const count = runningTaskCount(payload)
          if (count !== null) {
            runningTasks = count
          }
        } else if (payload.subtype === 'status') {
          compacting = payload.status === 'compacting'
        } else if (payload.subtype === 'compact_boundary') {
          compacting = false
        } else if (payload.subtype === 'thinking_tokens' && live && open) {
          // j8y.c: negative figures count as 0; a delta of 0 counts only once a block has had one.
          const estimate = Math.max(0, num(payload.estimated_tokens) ?? 0)
          const delta = num(payload.estimated_tokens_delta)
          if (delta !== null && (delta > 0 || blockHasDelta || estimate > 0)) {
            const before = committedTokens + blockTokens
            blockHasDelta ||= delta > 0
            blockTokens = Math.max(Math.max(0, delta) + blockTokens, estimate)
            sawTokens = true
            // v0z.c answers true only when the count moved; only then is `olv` sent (t5v.java:1059).
            if (committedTokens + blockTokens !== before) {
              thinkingOpen = true
            }
          }
        }
        break
      }
      case 'rate_limit_event': {
        const read = readCcrRateLimit(payload)
        if (read) {
          rateLimit = read
        }
        break
      }
      case 'result':
        if (live) {
          open = false
          turnStartedAt = null
          thinkingOpen = false
        }
        break
      case 'user':
      case 'assistant': {
        if (!live) {
          break
        }
        const signal = turnSignal(event)
        const wasOpen = open
        if (signal === 'end') {
          open = false
          turnStartedAt = null
          thinkingOpen = false
          break
        }
        if (!open) {
          open = true
          turnStartedAt = event.createdAt ?? null
        }
        if (!wasOpen || signal === 'prompt') {
          // t5v.L at a typed prompt (and the turn's start): the figure and the block start over.
          committedTokens = 0
          blockTokens = 0
          sawTokens = false
          blockHasDelta = false
          thinkingOpen = false
        }
        if (payload.type === 'assistant') {
          // v0z.a: a top-level assistant message commits the block's figure and closes the block
          // (`ThinkingBlockClosed`).
          committedTokens += blockTokens
          blockTokens = 0
          blockHasDelta = false
          thinkingOpen = false
        }
        break
      }
      default:
        break
    }
  }
  const disconnected = options.connectionStatus === 'disconnected'
  const working = open && !disconnected
  const thinking = working && thinkingOpen
  const tokens = committedTokens + blockTokens
  return {
    working,
    turnStartedAt: working ? turnStartedAt : null,
    thinking,
    thinkingTokens: working && sawTokens && tokens > 0 ? tokens : null,
    runningTasks,
    compacting: working && compacting,
    rateLimit
  }
}
