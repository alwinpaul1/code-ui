import { CCR_CONTROL_LANE } from './ccr-control-request'
import { acquireCcrLink } from './ccr-link-registry'
import { ccrCseId, newCcrEventUuid, postCcrSessionEvents } from './ccr-send'

/**
 * Stopping one background task through Anthropic, as the Claude app's sheet does (decompiled
 * 1.261013.20): `su8.stopBackgroundTask` → `j7v.t` (j7v.java:2195-2249) posts a control request
 * `{subtype: "stop_task", task_id}` (`ControlRequestBody.StopTask`, sea.java) as a
 * `StdinMessage.ControlRequest` `{type: "control_request", uuid, request_id, request}` with a fresh
 * uuid and request id, to `v1/code/sessions/{cse}/events` like a message. It does NOT wait for
 * the `control_response`: the POST failing is the only failure ("Failed to send stop_task"), and
 * the sheet then says "Couldn’t stop the task. Try again." (`ccr_background_task_stop_failed`,
 * lt2.java). Claude Code answers `stop_task` itself (2.1.300: `case"stop_task":{let a=
 * e.request.task_id;…`) and the task's own `task_notification` / `task_updated` ends the row.
 *
 * Kept small and apart from the interrupt / model / mode requests (ccr-control-request.ts), but
 * shipped behind the same switch: none of these bodies is proven against the live service yet.
 */

/** The control lane's switch: while it is off, no Stop is drawn on Anthropic's rows and no
 *  `stop_task` is sent. */
export const CCR_STOP_TASK_THROUGH_ANTHROPIC = CCR_CONTROL_LANE

export function buildCcrStopTaskBody(args: { sessionId: string; uuid: string; requestId: string; taskId: string }): {
  session_id: string
  events: { payload: Record<string, unknown> }[]
} {
  return {
    session_id: ccrCseId(args.sessionId),
    events: [{ payload: { type: 'control_request', uuid: args.uuid, request_id: args.requestId, request: { subtype: 'stop_task', task_id: args.taskId } } }]
  }
}

export type CcrStopTaskDeps = {
  post: (body: ReturnType<typeof buildCcrStopTaskBody>) => Promise<void>
  newUuid: () => string
  log: (line: string) => void
}

/** Posts the stop. True when Anthropic took it; never throws. */
export async function stopCcrBackgroundTask(deps: CcrStopTaskDeps, sessionId: string, taskId: string, enabled: boolean = CCR_STOP_TASK_THROUGH_ANTHROPIC): Promise<boolean> {
  if (!enabled) {
    deps.log(`[ccr-stop-task] not sent — stop_task for ${taskId}: the Anthropic control lane is off`)
    return false
  }
  try {
    await deps.post(buildCcrStopTaskBody({ sessionId, uuid: deps.newUuid(), requestId: deps.newUuid(), taskId }))
    return true
  } catch (error) {
    deps.log(`[ccr-stop-task] failed — stop_task for ${taskId} was not posted: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** The real stop: through the tab's shared session link, with its account's own sign-in. */
export async function stopCcrBackgroundTaskOnLink(accountId: string, sessionId: string, taskId: string): Promise<boolean> {
  const held = acquireCcrLink(accountId, sessionId)
  try {
    return await stopCcrBackgroundTask(
      {
        post: (body) => held.link.withSession((deps, account, session) => postCcrSessionEvents(deps, account, session, body)),
        newUuid: () => newCcrEventUuid(),
        log: (line) => console.log(line)
      },
      sessionId,
      taskId
    )
  } finally {
    held.release()
  }
}
