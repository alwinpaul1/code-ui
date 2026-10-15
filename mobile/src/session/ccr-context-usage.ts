import type { CcrStreamFrame } from './ccr-event-stream'
import { ccrCseId } from './ccr-send'

/**
 * The context figure the Claude Android app 1.261009.20 shows on its Usage sheet, asked of the live
 * session itself rather than read off a stored row. Read from the app's jadx output (R8 names of
 * that build):
 *  - the request: `ControlRequestBody.GetContextUsage` (rda.java, pda.java), `{subtype:
 *    "get_context_usage", detail: "summary" | "full"}` (`ContextUsageDetail`, g9a.java,
 *    tw9.java:40). It goes out as a `StdinMessage.ControlRequest` (jhx.java, lhx.java): `{type:
 *    "control_request", uuid, request_id, request}`, a fresh uuid and request id each time
 *    (j7v.java:683-688), posted to `v1/code/sessions/{cse}/events` like a message.
 *  - the wait: `j7v.h` gives `j7v.c` 45 000 ms (j7v.java:1184) for the `control_response` whose
 *    `response.request_id` is that id (`SdkControlResponseEvent.Response`, j7u.java).
 *  - the reply: `response.subtype` "success" with `response.response` = `ContextUsageTotalsReply`
 *    (waa.java) `{totalTokens, rawMaxTokens, percentage?}` for "summary"; "full" adds the
 *    categories, MCP tools, memory files and agents (`ContextUsageReplyRows`, aaa.java), which the
 *    user asked to leave out (2026-10-15: "No need of this"), so only "summary" is asked.
 *  - the outcomes (j7v.java:1199-1219, taa.java:129-168): an answer is the figure; a reply that is
 *    not a success leaves the sheet as it was (`t8a`); no session, a refused POST, or no reply in
 *    45 s (`f6v`/`g6v`/`i6v` → `s8a` → `h7a`) is "The session didn’t respond. Tap the refresh button
 *    to try again." (rr3.java:646-647).
 *  - the percent (`v7a`): the reply's own `percentage` when it gives one, else
 *    round(used × 100 / window), both clamped to 0..100; 75 and up is a warning, 90 and up critical.
 *
 * What is posted is a control request, not a message: Claude Code answers it from its last
 * response's usage (2.1.300: "'summary' answers from the last response's usage and local
 * estimates without the per-category token-count calls") and the transcript draws nothing for it
 * (ccr-transcript-decode.ts). Nothing here reads or logs a token.
 */

export const CCR_CONTEXT_USAGE_TIMEOUT_MS = 45_000

export type CcrContextUsageAnswer = { usedTokens: number; windowTokens: number; percent: number }

export type CcrContextUsageReply = { kind: 'answer'; answer: CcrContextUsageAnswer } | { kind: 'refused' }

export type CcrContextUsageOutcome = CcrContextUsageReply | { kind: 'unanswered' }

/** The POST body for one `get_context_usage` request, as the app's `lhx` serialises it. */
export function buildCcrContextUsageRequestBody(args: { sessionId: string; uuid: string; requestId: string }): {
  session_id: string
  events: { payload: Record<string, unknown> }[]
} {
  return {
    session_id: ccrCseId(args.sessionId),
    events: [
      {
        payload: {
          type: 'control_request',
          uuid: args.uuid,
          request_id: args.requestId,
          request: { subtype: 'get_context_usage', detail: 'summary' }
        }
      }
    ]
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function wholeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

/** `v7a`'s percent: the stated one, else used over window, rounded; 0..100. A zero window has none. */
export function contextPercent(usedTokens: number, windowTokens: number, stated: number | null = null): number {
  const raw = stated !== null ? stated : windowTokens > 0 ? Math.round((usedTokens * 100) / windowTokens) : 0
  return Math.max(0, Math.min(100, Math.round(raw)))
}

/** The `request_id` a `control_response` payload answers, or null for any other payload. */
export function ccrControlResponseRequestId(payload: Record<string, unknown>): string | null {
  if (payload.type !== 'control_response') {
    return null
  }
  const id = record(payload.response)?.request_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * A `control_response` payload read as the answer to a `get_context_usage` request. A success that
 * does not carry both counts, or a zero window, is not an answer: the app's deserialiser would
 * have refused it, and a guessed window is never drawn (CLAUDE.md).
 */
export function readCcrContextUsageReply(payload: Record<string, unknown>): CcrContextUsageReply {
  const response = record(payload.response)
  if (response?.subtype !== 'success') {
    return { kind: 'refused' }
  }
  const body = record(response.response)
  const usedTokens = wholeCount(body?.totalTokens)
  const windowTokens = wholeCount(body?.rawMaxTokens)
  if (usedTokens === null || windowTokens === null || windowTokens === 0) {
    return { kind: 'refused' }
  }
  const stated = typeof body?.percentage === 'number' && Number.isFinite(body.percentage) ? body.percentage : null
  return { kind: 'answer', answer: { usedTokens, windowTokens, percent: contextPercent(usedTokens, windowTokens, stated) } }
}

export type CcrContextUsageAskDeps = {
  /** Starts listening for the `control_response` to `requestId`; resolves with its payload, or null
   *  when none came within `timeoutMs`. Registered BEFORE the POST, so a fast reply is not missed. */
  waitForResponse: (requestId: string, timeoutMs: number) => { reply: Promise<Record<string, unknown> | null>; cancel: () => void }
  /** Posts one events batch into the tab's own session with its own account's sign-in. */
  post: (body: ReturnType<typeof buildCcrContextUsageRequestBody>) => Promise<void>
  newUuid: () => string
  log: (line: string) => void
}

/** Asks the session for its context once. Never throws: every failure is an outcome. */
export async function askCcrContextUsage(deps: CcrContextUsageAskDeps, sessionId: string, timeoutMs = CCR_CONTEXT_USAGE_TIMEOUT_MS): Promise<CcrContextUsageOutcome> {
  const uuid = deps.newUuid()
  const requestId = deps.newUuid()
  const wait = deps.waitForResponse(requestId, timeoutMs)
  try {
    await deps.post(buildCcrContextUsageRequestBody({ sessionId, uuid, requestId }))
  } catch (error) {
    wait.cancel()
    deps.log(`[ccr-context] failed — the request was not posted: ${error instanceof Error ? error.message : String(error)}`)
    return { kind: 'unanswered' }
  }
  const payload = await wait.reply
  if (!payload) {
    deps.log(`[ccr-context] failed — the session did not answer within ${Math.round(timeoutMs / 1000)} s`)
    return { kind: 'unanswered' }
  }
  const reply = readCcrContextUsageReply(payload)
  if (reply.kind === 'refused') {
    const error = record(payload.response)?.error
    deps.log(`[ccr-context] failed — the session refused: ${typeof error === 'string' ? error : 'no figure in the reply'}`)
  }
  return reply
}

/**
 * Who is waiting for which `control_response`, fed by a session link's stream (the reply comes as
 * an `ephemeral_event` or a `client_event`; either is matched by `request_id`).
 */
export class CcrControlWaiters {
  private readonly waiting = new Map<string, (payload: Record<string, unknown> | null) => void>()

  constructor(private readonly setTimer: (run: () => void, ms: number) => () => void) {}

  wait(requestId: string, timeoutMs: number): { reply: Promise<Record<string, unknown> | null>; cancel: () => void } {
    let cancelTimer: () => void = () => undefined
    const reply = new Promise<Record<string, unknown> | null>((resolve) => {
      const settle = (payload: Record<string, unknown> | null): void => {
        if (this.waiting.get(requestId) === settle) {
          this.waiting.delete(requestId)
          cancelTimer()
          resolve(payload)
        }
      }
      this.waiting.set(requestId, settle)
      cancelTimer = this.setTimer(() => settle(null), timeoutMs)
    })
    return { reply, cancel: () => this.waiting.get(requestId)?.(null) }
  }

  /** A stream frame: a stored or a live-only event that is the reply someone waits for settles it. */
  offerFrame(frame: CcrStreamFrame): void {
    if (frame.kind === 'event') {
      this.offer(frame.event.payload)
    } else if (frame.kind === 'ephemeral') {
      this.offer(frame.payload)
    }
  }

  /** One payload off the stream: settles its waiter when it is the reply one is waiting for. */
  offer(payload: Record<string, unknown>): void {
    const id = ccrControlResponseRequestId(payload)
    if (id !== null) {
      this.waiting.get(id)?.(payload)
    }
  }

  /** The link closing: everyone waiting is told no reply will come. */
  closeAll(): void {
    for (const settle of this.waiting.values()) {
      settle(null)
    }
  }
}
