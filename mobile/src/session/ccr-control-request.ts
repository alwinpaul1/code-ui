import { ccrCseId } from './ccr-send'
import type { CcrContextUsageAskDeps } from './ccr-context-usage'

/**
 * The control lane of a Claude tab matched to its Remote Control session: Stop, the permission
 * mode, the model and the effort, sent the way the Claude Android app 1.261013.20 sends them, as a
 * `control_request` posted to `v1/code/sessions/{cse}/events` (the same POST as a message and as
 * `get_context_usage`, ccr-context-usage.ts), never typed into the desktop terminal. Read from the
 * app's jadx output (R8 names of that build):
 *
 *  - the envelope (`StdinMessage.ControlRequest`, jhx.java/lhx.java): `{type: "control_request",
 *    uuid, request_id, request}`, a fresh uuid and request id each time.
 *  - the bodies (`ControlRequestBody.*`): `{subtype: "interrupt"}` (bea/dea), `{subtype:
 *    "set_model", model}` (nea/pea), `{subtype: "set_permission_mode", mode}` (kea/mea),
 *    `{subtype: "apply_flag_settings", settings}` (ida/kda). `settings` is `FlagSettings`
 *    (fff.java) written by its own serializer (gff.java, bytecode): `effortLevel` the level's name,
 *    `ultracode` only when set. A pick sends `ultracode: <level is "ultracode">` beside it
 *    (`new fff(phd, name.equals("ultracode"), 2)`, gx.java case 24).
 *  - when: on the pick, for a session already running (set_model it2/snw.java case 17 through
 *    gx.java:133; set_permission_mode bto.java:204; apply_flag_settings xt8.java:255). The app
 *    bundles them ahead of a user event only when it STARTS a session (s1b.java:125-145, drv.v0
 *    with a title): Code UI never starts a session on Anthropic, so it sends on the pick.
 *  - the wait (`j7v.d`, j7v.java:914-963): set_model and set_permission_mode 30 000 ms,
 *    apply_flag_settings 45 000 ms, for the `control_response` whose `response.request_id`
 *    matches. `interrupt` awaits nothing: a 2xx is the whole answer (j7v.java:1800-1840,
 *    drv.java:2539).
 *  - the outcomes (`ffa`): a success reply is applied (`dfa`); a reply that is not a success is
 *    refused (`cfa`, logged "<subtype> refused"); no session or a refused POST is unsent (`bfa`);
 *    no reply in time is unanswered (`efa`). The app treats unanswered as applied for the model
 *    (snw.java:620) and keeps the picked mode on it (bto.java:262-273): the request did go.
 *
 * Nothing here reads, logs or returns a token. A failure leaves one `[ccr-control] …` line that
 * names the request and the cause.
 */

/** THE switch. On: a matched Claude tab whose link is live sends Stop, mode, model and effort
 *  picks and permission answers as control requests, draws Anthropic's permission prompt as its
 *  card, reads its mode pill from the session's own `system` events, and lifts the composer's
 *  terminal-lease lock. Off: every one of those keeps the path it has on main (the terminal, the
 *  beacon, the screen). The bodies here are read from the app and NOT yet seen accepted by
 *  Anthropic; `scratchpad/probe/p15-control-lane.cjs` proves them. Turn on only after it does.
 *  The read-only parts stay behind it too: a mode read from a `system` event goes stale once the
 *  terminal's Shift+Tab changes it, a card drawn here could only be answered through this lane,
 *  and an unlocked composer could start a turn that only this lane could stop. */
export const CCR_CONTROL_LANE = false

/** How long Stop waits for the interrupt POST before it falls back to Escape on the terminal. The
 *  app awaits nothing past the POST; 10 s is OkHttp's default read timeout, which bounds it there. */
export const CCR_INTERRUPT_POST_TIMEOUT_MS = 10_000

export const CCR_SET_MODEL_TIMEOUT_MS = 30_000
export const CCR_SET_PERMISSION_MODE_TIMEOUT_MS = 30_000
export const CCR_APPLY_FLAG_SETTINGS_TIMEOUT_MS = 45_000
export const CCR_REWIND_TIMEOUT_MS = 15_000

/** The app's words for each failure (res/values/strings.xml of 1.261013.20). */
export const CCR_MODEL_REFUSED = 'That model isn’t available for this thread.' // code_project_model_rejected
export const CCR_MODEL_UNSENT = 'Model change couldn’t be applied. Try again.' // code_project_model_change_failed
export const CCR_EFFORT_FAILED = 'Couldn’t change effort. Try again.' // ccr_effort_change_failed
export const CCR_MODE_REFUSED = 'That mode isn’t available right now' // ccr_permission_mode_rejected
export const CCR_MODE_UNSENT = 'Couldn’t change mode. Try again.' // ccr_permission_mode_apply_failed
export const CCR_REWIND_REFUSED = 'Couldn’t rewind the conversation. The session is unchanged.' // ccr_rewind_rejected_generic
export const CCR_REWIND_TIMED_OUT = 'Rewind timed out. The session is unchanged.' // ccr_rewind_timed_out
export const CCR_REWIND_NOT_CONNECTED = 'Can’t retry while reconnecting. The session is unchanged.' // ccr_rewind_not_connected

export type CcrControlRequest =
  | { subtype: 'interrupt' }
  | { subtype: 'set_model'; model: string }
  | { subtype: 'set_permission_mode'; mode: string }
  | { subtype: 'apply_flag_settings'; settings: { effortLevel: string; ultracode?: boolean } }
  /** A refusal card's Edit and retry (`RewindConversation`, jea.java/hea.java; sent by j7v.java
   *  ~1517 with a 15 000 ms wait): back to before the refused prompt. */
  | { subtype: 'rewind_conversation'; target_message_uuid: string; interrupt_if_running: boolean }

export type CcrControlOutcome = 'applied' | 'refused' | 'unsent' | 'unanswered'

export type CcrEventsBody = { session_id: string; events: { payload: Record<string, unknown> }[] }

/** The POST body for one control request, as the app's `lhx` serialises it. */
export function buildCcrControlRequestBody(args: { sessionId: string; uuid: string; requestId: string; request: CcrControlRequest }): CcrEventsBody {
  return {
    session_id: ccrCseId(args.sessionId),
    events: [{ payload: { type: 'control_request', uuid: args.uuid, request_id: args.requestId, request: { ...args.request } } }]
  }
}

/** An effort pick's settings, as the app's pick builds them (gx.java case 24). */
export function ccrEffortSettings(level: string): { effortLevel: string; ultracode: boolean } {
  return { effortLevel: level, ultracode: level === 'ultracode' }
}

export type CcrControlDeps = CcrContextUsageAskDeps

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Sends one control request and waits for its answer (`j7v.d`). Never throws: every failure is an
 * outcome, and every outcome but `applied` leaves one log line naming the cause.
 */
export async function sendCcrControlRequest(deps: CcrControlDeps, sessionId: string, request: Exclude<CcrControlRequest, { subtype: 'interrupt' }>, timeoutMs: number): Promise<CcrControlOutcome> {
  const uuid = deps.newUuid()
  const requestId = deps.newUuid()
  const wait = deps.waitForResponse(requestId, timeoutMs)
  try {
    await deps.post(buildCcrControlRequestBody({ sessionId, uuid, requestId, request }))
  } catch (error) {
    wait.cancel()
    deps.log(`[ccr-control] ${request.subtype} failed — the request was not posted: ${reasonOf(error)}`)
    return 'unsent'
  }
  const payload = await wait.reply
  if (!payload) {
    deps.log(`[ccr-control] ${request.subtype} unanswered — the session did not reply within ${Math.round(timeoutMs / 1000)} s`)
    return 'unanswered'
  }
  const response = record(payload.response)
  if (response?.subtype === 'success') {
    return 'applied'
  }
  const error = response?.error
  deps.log(`[ccr-control] ${request.subtype} refused — the session answered: ${typeof error === 'string' && error ? error : 'not a success'}`)
  return 'refused'
}

/** Posts `interrupt` and waits for no reply, as the app does. Null when the POST was taken, else
 *  why not: a refused POST, or none within CCR_INTERRUPT_POST_TIMEOUT_MS. It logs nothing itself,
 *  so the fallback's one line names the cause and what it did instead. */
export async function postCcrInterrupt(
  deps: Pick<CcrControlDeps, 'post' | 'newUuid'>,
  sessionId: string,
  setTimer: (run: () => void, ms: number) => () => void = (run, ms) => {
    const handle = setTimeout(run, ms)
    return () => clearTimeout(handle)
  }
): Promise<string | null> {
  let cancelTimer: () => void = () => undefined
  const timedOut = new Promise<string>((resolve) => {
    cancelTimer = setTimer(() => resolve(`the POST had no answer within ${Math.round(CCR_INTERRUPT_POST_TIMEOUT_MS / 1000)} s`), CCR_INTERRUPT_POST_TIMEOUT_MS)
  })
  const posted = deps.post(buildCcrControlRequestBody({ sessionId, uuid: deps.newUuid(), requestId: deps.newUuid(), request: { subtype: 'interrupt' } })).then(
    () => null,
    (error: unknown) => `the request was not posted: ${reasonOf(error)}`
  )
  try {
    return await Promise.race([posted, timedOut])
  } finally {
    cancelTimer()
  }
}

/** What the user is told for a model pick's outcome; null when it went (applied or unanswered). */
export function ccrModelOutcomeMessage(outcome: CcrControlOutcome): string | null {
  return outcome === 'refused' ? CCR_MODEL_REFUSED : outcome === 'unsent' ? CCR_MODEL_UNSENT : null
}

/** What the user is told for an effort pick's outcome; null when it went. */
export function ccrEffortOutcomeMessage(outcome: CcrControlOutcome): string | null {
  return outcome === 'refused' || outcome === 'unsent' ? CCR_EFFORT_FAILED : null
}

/** What the user is told for a mode pick's outcome; null when it went (applied or unanswered). */
export function ccrModeOutcomeMessage(outcome: CcrControlOutcome): string | null {
  return outcome === 'refused' ? CCR_MODE_REFUSED : outcome === 'unsent' ? CCR_MODE_UNSENT : null
}

/** What the user is told for a rewind's outcome; null when the session took it. Unlike a model
 *  pick, an unanswered rewind did not go as far as anyone can tell: its prefill is not offered. */
export function ccrRewindOutcomeMessage(outcome: CcrControlOutcome): string | null {
  return outcome === 'applied' ? null : outcome === 'unanswered' ? CCR_REWIND_TIMED_OUT : CCR_REWIND_REFUSED
}
