// The Background tasks sheet's list from Anthropic's stream: the tasks the Claude app lists, folded
// as its reducer folds them (t5v.java `k` and `h`, 1.261013.20; ccr-background-tasks.ts). The
// events are Claude Code 2.1.300's own shapes (fixtures/ccr-background-task-events-2.1.300.ts).

import { describe, expect, it } from 'vitest'
import { ccrBackgroundTaskRows, ccrSubagentMessages, deriveCcrBackgroundTasks } from './ccr-background-tasks'
import { BACKGROUND_AGENT } from './fixtures/claude-background-agent-launch-2.1.296'
import {
  AGENT_CALL,
  SHELL_CALL,
  SHELL_ID,
  T0,
  agentAndShellStarted,
  agentCallEvents,
  ccrEvent,
  subagentBashCall,
  taskNotification,
  taskStarted,
  taskUpdated,
  tasksChanged
} from './fixtures/ccr-background-task-events-2.1.300'

const AGENT = BACKGROUND_AGENT.agentId
const NOW = T0 + 600_000
const statusOf = (events: Parameters<typeof deriveCcrBackgroundTasks>[0], id: string) => deriveCcrBackgroundTasks(events).find((task) => task.taskId === id)?.status

describe("the running tasks are the Claude app's, read from Anthropic's task events", () => {
  it('lists nothing for a session with no task events, or none at all', () => {
    expect(deriveCcrBackgroundTasks([])).toEqual([])
    expect(ccrBackgroundTaskRows([], NOW)).toEqual({ running: [], finished: [] })
  })

  it('lists one started shell as running, timed from its own start', () => {
    const rows = ccrBackgroundTaskRows(deriveCcrBackgroundTasks(agentAndShellStarted().slice(1, 2)), NOW)
    expect(rows.finished).toEqual([])
    expect(rows.running).toEqual([
      { id: SHELL_ID, kind: 'shell', title: 'Rerun the rpc-recording suite', status: 'running', startedAt: T0 + 376_000, elapsedMs: 224_000, toolUseId: SHELL_CALL }
    ])
  })

  it('lists the running rows newest first, as the app showed them (3m 44s above 10m)', () => {
    const rows = ccrBackgroundTaskRows(deriveCcrBackgroundTasks(agentAndShellStarted()), NOW)
    expect(rows.running.map((task) => [task.title, task.elapsedMs])).toEqual([
      ['Rerun the rpc-recording suite', 224_000],
      [BACKGROUND_AGENT.description, 600_000]
    ])
    expect(rows.running[1]?.kind).toBe('agent')
    expect(rows.running[1]?.toolUseId).toBe(AGENT_CALL)
  })

  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['stopped', 'stopped'],
    ['killed', 'stopped'],
    ['an unknown word', 'stopped']
  ])('ends a task its notification says is %s as %s', (word, status) => {
    const events = [...agentAndShellStarted(), taskNotification({ taskId: AGENT, toolUseId: AGENT_CALL, status: word, at: NOW, summary: 'Done' })]
    expect(statusOf(events, AGENT)).toBe(status)
    const rows = ccrBackgroundTaskRows(deriveCcrBackgroundTasks(events), NOW)
    expect(rows.finished.map((task) => [task.id, task.status, task.elapsedMs])).toEqual([[AGENT, status, null]])
  })

  it('stops a task a patch says was cancelled, and takes its new description', () => {
    const events = [...agentAndShellStarted(), taskUpdated(SHELL_ID, { status: 'cancelled', description: 'Rerun it again' }, NOW)]
    const shell = deriveCcrBackgroundTasks(events).find((task) => task.taskId === SHELL_ID)
    expect(shell).toMatchObject({ status: 'stopped', description: 'Rerun it again', endedAt: NOW })
  })

  it('never moves a finished task back with a later patch or notification', () => {
    const events = [
      ...agentAndShellStarted(),
      taskNotification({ taskId: AGENT, toolUseId: AGENT_CALL, status: 'completed', at: NOW }),
      taskNotification({ taskId: AGENT, toolUseId: AGENT_CALL, status: 'failed', at: NOW + 1 }),
      taskUpdated(AGENT, { status: 'stopped' }, NOW + 2)
    ]
    expect(statusOf(events, AGENT)).toBe('completed')
  })

  it('stops a running task the background list no longer names, and runs it again when a later list does', () => {
    const dropped = [...agentAndShellStarted(), tasksChanged([{ taskId: AGENT, taskType: 'local_agent' }], NOW)]
    expect(statusOf(dropped, SHELL_ID)).toBe('stopped')
    expect(statusOf(dropped, AGENT)).toBe('running')
    const back = [...dropped, tasksChanged([{ taskId: AGENT, taskType: 'local_agent' }, { taskId: SHELL_ID, taskType: 'local_bash' }], NOW + 1)]
    expect(statusOf(back, SHELL_ID)).toBe('running')
  })

  // Claude Code 2.1.300 drops a finished agent from the background list before its notification
  // lands; the app's reducer lets the stated end override the list's guess (t5v.java `H`, 99-104).
  it('reads a background agent that finished normally as Completed, not Stopped, when the list drops it first', () => {
    const events = [
      taskStarted({ taskId: AGENT, toolUseId: AGENT_CALL, taskType: 'local_agent', description: 'Agent', at: T0 }),
      tasksChanged([{ taskId: AGENT, taskType: 'local_agent' }], T0 + 1),
      tasksChanged([], NOW - 1),
      taskNotification({ taskId: AGENT, toolUseId: AGENT_CALL, status: 'completed', at: NOW })
    ]
    expect(statusOf(events, AGENT)).toBe('completed')
    expect(ccrBackgroundTaskRows(deriveCcrBackgroundTasks(events), NOW).finished.map((task) => task.status)).toEqual(['completed'])
  })

  it('reads a task the list dropped as Failed once a patch says it failed', () => {
    const events = [...agentAndShellStarted(), tasksChanged([{ taskId: AGENT, taskType: 'local_agent' }], NOW - 1), taskUpdated(SHELL_ID, { status: 'failed' }, NOW)]
    expect(statusOf(events, SHELL_ID)).toBe('failed')
    // Settled by its own word now: a later notification no longer moves it.
    expect(statusOf([...events, taskNotification({ taskId: SHELL_ID, toolUseId: SHELL_CALL, status: 'completed', at: NOW + 1 })], SHELL_ID)).toBe('failed')
  })

  it('keeps a task the list dropped Stopped when its notification states no end the app knows', () => {
    const events = [...agentAndShellStarted(), tasksChanged([{ taskId: AGENT, taskType: 'local_agent' }], NOW - 1), taskNotification({ taskId: SHELL_ID, toolUseId: SHELL_CALL, status: 'mystery', at: NOW })]
    expect(statusOf(events, SHELL_ID)).toBe('stopped')
  })

  it('keeps a remote agent and a foreground one running when the background list leaves them out', () => {
    const events = [
      taskStarted({ taskId: 'remote', toolUseId: 'toolu_r', taskType: 'remote_agent', description: 'Cloud agent', at: T0 }),
      taskStarted({ taskId: 'fg', toolUseId: 'toolu_f', taskType: 'local_agent', description: 'Inline agent', at: T0, backgrounded: false }),
      tasksChanged([], NOW)
    ]
    expect(statusOf(events, 'remote')).toBe('running')
    expect(statusOf(events, 'fg')).toBe('running')
  })

  it("ignores a subagent's own task events: they are its tasks, not the lead's", () => {
    const scoped = { ...taskStarted({ taskId: 'inner', toolUseId: 'toolu_i', taskType: 'local_bash', description: 'Inner shell', at: T0 }) }
    scoped.payload = { ...scoped.payload, parent_tool_use_id: AGENT_CALL }
    expect(deriveCcrBackgroundTasks([scoped])).toEqual([])
  })

  it("ignores a stale run's event, and restarts the task on a newer run", () => {
    const first = taskStarted({ taskId: AGENT, toolUseId: AGENT_CALL, taskType: 'local_agent', description: 'Agent', at: T0, runId: 'run-2' })
    const stale = taskNotification({ taskId: AGENT, toolUseId: AGENT_CALL, status: 'completed', at: T0 + 5, runId: 'run-1' })
    expect(statusOf([first, stale], AGENT)).toBe('running')
    const done = taskNotification({ taskId: AGENT, toolUseId: AGENT_CALL, status: 'completed', at: T0 + 10, runId: 'run-2' })
    const resumed = taskStarted({ taskId: AGENT, toolUseId: AGENT_CALL, taskType: 'local_agent', description: 'Agent', at: T0 + 20, runId: 'run-3' })
    const tasks = deriveCcrBackgroundTasks([first, done, resumed])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ status: 'running', startedAt: T0 + 20 })
  })

  it('lists neither a monitor nor a task whose kind was never stated', () => {
    const events = [
      taskStarted({ taskId: 'mon', toolUseId: 'toolu_m', taskType: 'monitor_mcp', description: 'Watch', at: T0 }),
      ccrEvent({ type: 'system', subtype: 'task_progress', task_id: 'bare' }, T0)
    ]
    expect(ccrBackgroundTaskRows(deriveCcrBackgroundTasks(events), NOW)).toEqual({ running: [], finished: [] })
  })

  it('names a task by its kind when its description is blank or only its id', () => {
    const events = [taskStarted({ taskId: SHELL_ID, toolUseId: SHELL_CALL, taskType: 'local_bash', description: SHELL_ID, at: T0 })]
    expect(ccrBackgroundTaskRows(deriveCcrBackgroundTasks(events), NOW).running[0]?.title).toBe('Shell')
  })
})

describe("an agent's transcript is the stream's events under its Agent call", () => {
  it("reads only the events scoped to that call, never the lead's", () => {
    const events = [...agentCallEvents('Async agent launched successfully.', 'Do it'), ...subagentBashCall('toolu_sub1', 'ls', 'List files', T0 + 1_000)]
    const rows = ccrSubagentMessages(events, AGENT_CALL)
    expect(rows.flatMap((row) => row.blocks.map((block) => block.type))).toEqual(['tool-call', 'tool-result'])
    expect(ccrSubagentMessages(events, 'toolu_other')).toEqual([])
    expect(ccrSubagentMessages([], AGENT_CALL)).toEqual([])
  })
})
