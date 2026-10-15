// The Stop on Anthropic's lane posts what the Claude app posts (j7v.java `t`, sea.java; Claude
// Code 2.1.300 answers `stop_task` itself), and a refused POST is the only failure, said in a line
// that names the task (CLAUDE.md: a failure's one line says where to look).

import { describe, expect, it, vi } from 'vitest'
import { CCR_STOP_TASK_THROUGH_ANTHROPIC, buildCcrStopTaskBody, stopCcrBackgroundTask, type CcrStopTaskDeps } from './ccr-background-task-stop'

function deps(post: CcrStopTaskDeps['post']) {
  let n = 0
  return { post, newUuid: () => `id-${(n += 1)}`, log: vi.fn<(line: string) => void>() }
}

describe("a Stop posts the app's stop_task control request", () => {
  it('posts {type: control_request, uuid, request_id, request: {subtype: stop_task, task_id}} into the session', async () => {
    const post = vi.fn(async () => undefined)
    await expect(stopCcrBackgroundTask(deps(post), 'session_01Abc', 'bzp6f42la', true)).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith({
      session_id: 'cse_01Abc',
      events: [{ payload: { type: 'control_request', uuid: 'id-1', request_id: 'id-2', request: { subtype: 'stop_task', task_id: 'bzp6f42la' } } }]
    })
    expect(buildCcrStopTaskBody({ sessionId: 'session_01Abc', uuid: 'u', requestId: 'r', taskId: 't' }).events[0]?.payload.request).toEqual({ subtype: 'stop_task', task_id: 't' })
  })

  it('reports a refused POST as not taken, and logs which task it could not stop and why', async () => {
    const held = deps(async () => {
      throw new Error('events 403')
    })
    await expect(stopCcrBackgroundTask(held, 'session_01Abc', 'a7cce30ab64e52712', true)).resolves.toBe(false)
    expect(held.log).toHaveBeenCalledWith('[ccr-stop-task] failed — stop_task for a7cce30ab64e52712 was not posted: events 403')
  })
})

// Off until the Anthropic control lane ships (ccr-background-task-stop.ts): nothing reaches the
// session, and the one line left behind says why no stop went out.
describe('no stop_task is sent while the switch is off', () => {
  it('ships off', () => {
    expect(CCR_STOP_TASK_THROUGH_ANTHROPIC).toBe(false)
  })

  it('posts nothing, reports the stop as not taken, and logs that the lane is off', async () => {
    const post = vi.fn(async () => undefined)
    const held = deps(post)
    await expect(stopCcrBackgroundTask(held, 'session_01Abc', 'bzp6f42la')).resolves.toBe(false)
    expect(post).not.toHaveBeenCalled()
    expect(held.log).toHaveBeenCalledWith('[ccr-stop-task] not sent — stop_task for bzp6f42la: the Anthropic control lane is off')
  })
})
