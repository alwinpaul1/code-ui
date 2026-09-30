import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { decodeAgentHudChannelText } from './agent-hud-channel'
import { consumeAgentHudBeacons, getAgentHudBeacon, resetAgentHudBeacons } from './agent-hud-beacon'
import { CLAUDE_HUD_STOP_HOOK_SCRIPT } from './agent-hud-launch-args'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import { backgroundTaskReportFromBeacon } from './use-active-tab-finished-task-ids'
import {
  WORKFLOW_LAUNCHED_AT,
  WORKFLOW_TASK_ID,
  workflowFinishedMessage,
  workflowLaunchMessages
} from './fixtures/claude-workflow-2.1.284'

// Where a running workflow's fate is read from. The beacon has two lists: the
// status line's `live=` (every repaint, every 5 s on the phone's flag, built
// from Bash launch sentences only) and the Stop hook's `run=` (once per turn
// end, every `status: running` entry of `background_tasks`). Only `run=` can
// name a workflow or a monitor, so a `live=` repaint after the Stop must not
// retire either. The Stop lists below are what the REAL hook script prints for
// a payload naming them (agent-hud-launch-args.ts, run under sh); the `live=`
// repaint is the status line's own grammar, `live=` empty when no Bash runs.
const HANDLE = 'tab-1'
const SESSION = '790eafa8-07b2-4380-abc2-90e22f965369'
const MONITOR_ID = 'biifjm40h'
const STOP_AT = WORKFLOW_LAUNCHED_AT + 2 * 60_000
const NOW = WORKFLOW_LAUNCHED_AT + 30 * 60_000

function stopHook(background: { type: string; id: string; status: string }[], tty = join(process.env.TMPDIR ?? '/tmp', `cuihud-wf-${process.pid}.txt`)): string {
  execFileSync('sh', ['-c', `: > ${tty}`])
  execFileSync('sh', ['-c', CLAUDE_HUD_STOP_HOOK_SCRIPT], {
    input: JSON.stringify({ session_id: SESSION, hook_event_name: 'Stop', background_tasks: background }),
    env: { ...process.env, CUIHUD_TTY: tty },
    timeout: 20_000
  })
  return decodeAgentHudChannelText(readFileSync(tty, 'latin1')).join('\n')
}

function beacon(payload: string): void {
  consumeAgentHudBeacons(HANDLE, `\x1b]7777;${payload}\x07`)
}

const STATUS_LINE_NOTHING_RUNNING = `CUIHUD1 agent=claude sid=${SESSION} model=claude-opus-5-5 name=Opus%205.5 effort=high used=210000 win=1000000 pct=21 live=`

function through(messages: NativeChatMessage[], hostStatus: { state: 'working' | 'done'; subagents?: AgentSubagentSnapshot[] } = { state: 'working' }) {
  const held = getAgentHudBeacon(HANDLE)
  const report = backgroundTaskReportFromBeacon(held, held?.doneTaskIds ?? [])
  return deriveReportedBackgroundTasks(messages, NOW, hostStatus, report)
}

function monitorLaunch(): NativeChatMessage[] {
  return [
    {
      id: 'monitor-call',
      role: 'assistant',
      timestamp: WORKFLOW_LAUNCHED_AT,
      source: 'transcript',
      blocks: [{ type: 'tool-call', name: 'Monitor', input: { command: 'tail -f build.log', description: 'Watch the build log' } }]
    },
    {
      id: 'monitor-result',
      role: 'user',
      timestamp: WORKFLOW_LAUNCHED_AT + 500,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-result',
          output: `Monitor started (task ${MONITOR_ID}, timeout 3000000ms). You will be notified on each event. Keep working — do not poll.`
        }
      ]
    }
  ]
}

describe('a workflow and a monitor across the status line’s repaints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAgentHudBeacons()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function stopNamingWorkflowAndMonitor(): void {
    vi.setSystemTime(STOP_AT)
    beacon(
      stopHook([
        { type: 'local_workflow', id: WORKFLOW_TASK_ID, status: 'running' },
        { type: 'monitor', id: MONITOR_ID, status: 'running' }
      ])
    )
  }

  it('the real Stop hook names both in run=', () => {
    stopNamingWorkflowAndMonitor()
    expect(getAgentHudBeacon(HANDLE)?.stopRunningTaskIds).toEqual([WORKFLOW_TASK_ID, MONITOR_ID])
  })

  it('stays Running after a live= repaint that names nothing, and after several', () => {
    stopNamingWorkflowAndMonitor()
    for (let repaint = 1; repaint <= 3; repaint += 1) {
      vi.setSystemTime(STOP_AT + repaint * 5_000)
      beacon(STATUS_LINE_NOTHING_RUNNING)
    }
    const { running, finished } = through([...workflowLaunchMessages(), ...monitorLaunch()])
    expect(running.map((task) => task.id).sort()).toEqual([MONITOR_ID, WORKFLOW_TASK_ID].sort())
    expect(finished).toEqual([])
  })

  it('a later Stop whose run= no longer names them retires both', () => {
    stopNamingWorkflowAndMonitor()
    vi.setSystemTime(STOP_AT + 60_000)
    beacon(stopHook([]))
    const { running, finished } = through([...workflowLaunchMessages(), ...monitorLaunch()])
    expect(running).toEqual([])
    expect(finished.map((task) => task.id).sort()).toEqual([MONITOR_ID, WORKFLOW_TASK_ID].sort())
  })

  it('a done= that names one retires it and leaves the other running', () => {
    stopNamingWorkflowAndMonitor()
    vi.setSystemTime(STOP_AT + 10_000)
    beacon(`${STATUS_LINE_NOTHING_RUNNING} done=${MONITOR_ID}`)
    const { running, finished } = through([...workflowLaunchMessages(), ...monitorLaunch()])
    expect(running.map((task) => task.id)).toEqual([WORKFLOW_TASK_ID])
    expect(finished.map((task) => task.id)).toEqual([MONITOR_ID])
  })

  it('a pane the host says is done retires them', () => {
    stopNamingWorkflowAndMonitor()
    vi.setSystemTime(STOP_AT + 10_000)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const { running } = through([...workflowLaunchMessages(), ...monitorLaunch()], { state: 'done' })
    expect(running).toEqual([])
  })

  it('the workflow’s own completion notification retires it', () => {
    stopNamingWorkflowAndMonitor()
    vi.setSystemTime(STOP_AT + 10_000)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const { running, finished } = through([...workflowLaunchMessages(), workflowFinishedMessage()])
    expect(running).toEqual([])
    expect(finished[0]?.id).toBe(WORKFLOW_TASK_ID)
  })

  it('a launch after the Stop spoke is not judged by it', () => {
    vi.setSystemTime(WORKFLOW_LAUNCHED_AT - 5 * 60_000)
    beacon(stopHook([]))
    vi.setSystemTime(WORKFLOW_LAUNCHED_AT + 10_000)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    expect(through(workflowLaunchMessages()).running.map((task) => task.id)).toEqual([WORKFLOW_TASK_ID])
  })

  it('with no Stop yet, neither is retired by a live= list', () => {
    vi.setSystemTime(STOP_AT)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    expect(through([...workflowLaunchMessages(), ...monitorLaunch()]).running).toHaveLength(2)
  })

  it('a shell is still judged by live=: an empty repaint retires it', () => {
    vi.setSystemTime(STOP_AT)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const shell: NativeChatMessage[] = [
      { id: 'sh-call', role: 'assistant', timestamp: WORKFLOW_LAUNCHED_AT, source: 'transcript', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'sleep 999', description: 'Wait', run_in_background: true } }] },
      { id: 'sh-result', role: 'user', timestamp: WORKFLOW_LAUNCHED_AT + 100, source: 'transcript', blocks: [{ type: 'tool-result', output: 'Command running in background with ID: bshell001. Output is being written to: /tmp/x.output.' }] }
    ]
    expect(through(shell).running).toEqual([])
  })
})

// Lanes name no workflow, so a lane is counted on a card only when the last
// Stop's run= shows nothing else could own it. That list, not `live=`, is what
// the guard reads: a repaint after the Stop must not widen it.
describe('which workflow a lane is counted on, after real beacons', () => {
  const ABOVE = 'wabove0001'

  beforeEach(() => {
    vi.useFakeTimers()
    resetAgentHudBeacons()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function lane(startedAt: number): AgentSubagentSnapshot[] {
    return [{ id: 'a7f3c19d20be4a611', agentType: 'workflow-subagent', state: 'working', startedAt }]
  }
  const kinds = (result: ReturnType<typeof through>) => result.running.map((task) => task.kind).sort()
  const lanesOn = (result: ReturnType<typeof through>) => result.running.find((task) => task.id === WORKFLOW_TASK_ID)?.workflow?.lanes ?? null

  it('counts a lane when the Stop named only this workflow and the window reaches back past it', () => {
    vi.setSystemTime(STOP_AT)
    beacon(stopHook([{ type: 'local_workflow', id: WORKFLOW_TASK_ID, status: 'running' }]))
    vi.setSystemTime(STOP_AT + 5_000)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const result = through(workflowLaunchMessages(), { state: 'working', subagents: lane(STOP_AT + 6_000) })
    expect(kinds(result)).toEqual(['workflow'])
    expect(lanesOn(result)).toEqual({ count: 1, atLeast: false })
  })

  it('refuses after a lead Stop when another workflow, launched above the window, is still on run= and its lane came back later', () => {
    vi.setSystemTime(STOP_AT)
    beacon(
      stopHook([
        { type: 'local_workflow', id: ABOVE, status: 'running' },
        { type: 'local_workflow', id: WORKFLOW_TASK_ID, status: 'running' }
      ])
    )
    // The roster was cleared by that Stop; the lane returns with a fresh start,
    // after this workflow's launch, and a live= repaint follows.
    vi.setSystemTime(STOP_AT + 5_000)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const result = through(workflowLaunchMessages(), { state: 'working', subagents: lane(STOP_AT + 4_000) })
    expect(lanesOn(result)).toBeNull()
    expect(kinds(result)).toEqual(['agent', 'workflow'])
  })

  it('refuses when no Stop has spoken, whatever live= says', () => {
    vi.setSystemTime(STOP_AT)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const result = through(workflowLaunchMessages(), { state: 'working', subagents: lane(STOP_AT + 1_000) })
    expect(lanesOn(result)).toBeNull()
    expect(kinds(result)).toEqual(['agent', 'workflow'])
  })

  it('refuses when the last Stop spoke before this workflow launched and named another that is not in the window', () => {
    vi.setSystemTime(WORKFLOW_LAUNCHED_AT - 60_000)
    beacon(stopHook([{ type: 'local_workflow', id: ABOVE, status: 'running' }]))
    vi.setSystemTime(STOP_AT)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const result = through(workflowLaunchMessages(), { state: 'working', subagents: lane(STOP_AT) })
    expect(lanesOn(result)).toBeNull()
  })

  it('refuses when the loaded window begins after the last Stop: a launch since then could be above it', () => {
    vi.setSystemTime(WORKFLOW_LAUNCHED_AT - 60 * 60_000)
    beacon(stopHook([]))
    vi.setSystemTime(STOP_AT)
    beacon(STATUS_LINE_NOTHING_RUNNING)
    const result = through(workflowLaunchMessages(), { state: 'working', subagents: lane(STOP_AT) })
    expect(lanesOn(result)).toBeNull()
  })
})
