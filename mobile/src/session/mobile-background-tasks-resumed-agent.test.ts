import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { deriveBackgroundTasks, type BackgroundTaskHostStatus } from './mobile-background-tasks'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import {
  COMPLETED_NOTIFICATION,
  FAILED_NOTIFICATION,
  QUEUED_RESULT,
  RESUMED_AGENT_DESCRIPTION,
  RESUMED_AGENT_ID,
  RESUMED_AGENT_PANE_STARTED_AT,
  RESUMED_AGENT_ROSTER_ROW,
  RESUMED_AGENTS_REVIEWER_ROW,
  RESUMED_AGENT_TIMES,
  RESUME_RESULT,
  launchRecords,
  notificationRecord,
  queuedRecords,
  resumeRecords,
  sendMessageRecords
} from './fixtures/claude-resumed-agent-2.1.283'

// Session 790eafa8, 2026-09-28, Claude Code 2.1.283, phone on 0.9.102: the
// lead launched a38e1687ac3722765 at 12:18, it failed at 13:34, and the lead
// resumed it at 16:28. The status row read "Working · Tools" with no running
// task while it ran. Orca's roster still listed it, with its first start
// (12:18:28.952), and a roster row older than the agent's notification was
// read as the run that notification ended.

const ID = RESUMED_AGENT_ID
const at = (iso: string) => Date.parse(iso)
const pane = (subagents: AgentSubagentSnapshot[]): BackgroundTaskHostStatus => ({
  state: 'working',
  stateStartedAt: RESUMED_AGENT_PANE_STARTED_AT,
  subagents
})
const runningIds = (messages: readonly NativeChatMessage[], now: number, host: BackgroundTaskHostStatus | null, finishedTaskIds: string[] = []) =>
  deriveBackgroundTasks(messages, now, host, { finishedTaskIds }).running.map((task) => task.id)

const failedThenResumed = () => [...launchRecords(), notificationRecord(), ...resumeRecords()]
const completedThenResumed = () => [...launchRecords(), notificationRecord(RESUMED_AGENT_TIMES.failed, COMPLETED_NOTIFICATION), ...resumeRecords()]
const AFTER_RESUME = at('2026-09-28T16:29:00.000Z')
const AFTER_QUEUED = at('2026-09-28T16:36:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a subagent the lead resumed, against the roster row Orca kept', () => {
  it('counts a subagent the lead resumed after it failed as running', () => {
    // What the status row reads: the report carries every id a window showed
    // ending, so the failed run's id is in it.
    const tasks = deriveReportedBackgroundTasks(failedThenResumed(), AFTER_RESUME, pane([RESUMED_AGENT_ROSTER_ROW]), {
      finishedTaskIds: [ID],
      runningTaskIds: null,
      runningTaskIdsAt: null,
      launchedTaskIds: [],
      agentProvenance: { ownAgentIds: [ID], preexistingAgentIds: [] }
    })

    expect(tasks.running.map((task) => [task.id, task.kind, task.title])).toEqual([[ID, 'agent', RESUMED_AGENT_DESCRIPTION]])
    expect(tasks.finished).toEqual([])
  })

  it('counts a subagent the lead resumed after it completed as running', () => {
    expect(runningIds(completedThenResumed(), AFTER_RESUME, pane([RESUMED_AGENT_ROSTER_ROW]), [ID])).toEqual([ID])
  })

  it('counts it once, not the reviewer it started, through the messages queued to it while it runs', () => {
    const tasks = deriveReportedBackgroundTasks([...failedThenResumed(), ...queuedRecords()], AFTER_QUEUED, pane([RESUMED_AGENT_ROSTER_ROW, RESUMED_AGENTS_REVIEWER_ROW]), {
      finishedTaskIds: [ID],
      runningTaskIds: null,
      runningTaskIdsAt: null,
      launchedTaskIds: [],
      agentProvenance: { ownAgentIds: [ID], preexistingAgentIds: [] }
    })

    expect(tasks.running.map((task) => task.id)).toEqual([ID])
  })

  it('clears a resumed subagent once its next notification lands, though the row Orca kept is still there', () => {
    const finishedAgain = [...failedThenResumed(), ...queuedRecords(), notificationRecord('2026-09-28T17:05:00.000Z', COMPLETED_NOTIFICATION)]
    const tasks = deriveBackgroundTasks(finishedAgain, at('2026-09-28T17:06:00.000Z'), pane([RESUMED_AGENT_ROSTER_ROW]))

    expect(tasks.running).toEqual([])
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([[ID, 'completed']])
  })

  it('clears a resumed subagent the roster no longer lists', () => {
    // A resumed run fires SubagentStart and SubagentStop like a first run;
    // a one-shot row leaves at its stop. The roster is still the authority.
    expect(runningIds(failedThenResumed(), AFTER_RESUME, pane([]))).toEqual([])
  })
})

describe('a subagent the lead resumed, with no host status to judge it', () => {
  // The window's own notification is from before the resume; no id-only
  // list names the agent (see the last describe for when one does).
  it('counts a subagent the lead resumed after it failed as running', () => {
    expect(runningIds(failedThenResumed(), AFTER_RESUME, null)).toEqual([ID])
  })

  it('counts a subagent the lead resumed after it completed as running', () => {
    expect(runningIds(completedThenResumed(), AFTER_RESUME, null)).toEqual([ID])
  })

  it('times the resumed run from the resume, not from the first launch', () => {
    const [task] = deriveBackgroundTasks(failedThenResumed(), AFTER_RESUME, null).running

    expect(task?.startedAt).toBe(at(RESUMED_AGENT_TIMES.resumed))
    expect(task?.elapsedMs).toBe(AFTER_RESUME - at(RESUMED_AGENT_TIMES.resumed))
  })

  it('does not count messages queued to the running agent as more runs', () => {
    expect(runningIds([...failedThenResumed(), ...queuedRecords()], AFTER_QUEUED, null)).toEqual([ID])
    // Never stopped at all: queued messages keep one run, and start none.
    expect(runningIds([...launchRecords(), ...queuedRecords()], AFTER_QUEUED, null)).toEqual([ID])
  })

  it('clears a resumed subagent once its next notification lands, failed or completed', () => {
    const failedAgain = [...failedThenResumed(), notificationRecord('2026-09-28T17:05:00.000Z', FAILED_NOTIFICATION)]
    const completed = [...failedThenResumed(), notificationRecord('2026-09-28T17:05:00.000Z', COMPLETED_NOTIFICATION)]
    const later = at('2026-09-28T17:06:00.000Z')

    expect(deriveBackgroundTasks(failedAgain, later, null).finished.map((task) => [task.id, task.status])).toEqual([[ID, 'failed']])
    expect(deriveBackgroundTasks(completed, later, null, { finishedTaskIds: [ID] }).running).toEqual([])
  })

  it('counts the resumed agent when the resume is the only task in the window', () => {
    // The launch and the failure have slid above the loaded window.
    const tasks = deriveBackgroundTasks(resumeRecords(), AFTER_RESUME, null)

    expect(tasks.running.map((task) => [task.id, task.kind])).toEqual([[ID, 'agent']])
  })

  it('counts nothing in an empty window, or one holding only a message queued to an agent it never launched', () => {
    expect(runningIds([], AFTER_RESUME, null)).toEqual([])
    expect(runningIds([], AFTER_RESUME, pane([]))).toEqual([])
    expect(runningIds(queuedRecords(), AFTER_QUEUED, null)).toEqual([])
  })
})

describe('a SendMessage that resumed nothing', () => {
  // The shapes are the 2.1.283 bundle's templates for these outcomes; no
  // transcript on this machine holds one yet.
  const missing = 'a0f00000000000000'
  const notThere = `{"success":false,"message":"No agent named '${missing}' is reachable. "}`
  const notResumed = `{"success":false,"message":"Agent \\"${ID}\\" could not be resumed: its transcript is missing"}`

  it('counts nothing for a message to an agent that is not there', () => {
    const messages = sendMessageRecords(RESUMED_AGENT_TIMES.resumeCall, RESUMED_AGENT_TIMES.resumed, notThere, '[summary]', missing)

    expect(deriveBackgroundTasks(messages, AFTER_RESUME, null)).toEqual({ running: [], finished: [] })
    expect(deriveBackgroundTasks(messages, AFTER_RESUME, pane([]))).toEqual({ running: [], finished: [] })
  })

  it('keeps a failed agent finished when the resume itself failed', () => {
    const messages = [
      ...launchRecords(),
      notificationRecord(),
      ...sendMessageRecords(RESUMED_AGENT_TIMES.resumeCall, RESUMED_AGENT_TIMES.resumed, notResumed, '[summary]')
    ]

    expect(runningIds(messages, AFTER_RESUME, null, [ID])).toEqual([])
    expect(runningIds(messages, AFTER_RESUME, pane([RESUMED_AGENT_ROSTER_ROW]), [ID])).toEqual([])
  })

  it('does not count a resume written without the agent id, and says why once', () => {
    // Claude Code leaves resumedAgentId out when an agent still in memory
    // names another owner; the message alone names only a 7-character prefix.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unowned = RESUME_RESULT.replace(/,"resumedAgentId":"[^"]+"/, '')
    const messages = [...launchRecords(), notificationRecord(), ...sendMessageRecords(RESUMED_AGENT_TIMES.resumeCall, RESUMED_AGENT_TIMES.resumed, unowned, '[summary]')]

    expect(runningIds(messages, AFTER_RESUME, null)).toEqual([])
    expect(runningIds(messages, AFTER_RESUME, null)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/not counted as a resumed agent .*no resumedAgentId/)
  })

  it('does not count a resume written as plain text, and says why', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const messages = [...launchRecords(), notificationRecord(), ...sendMessageRecords(RESUMED_AGENT_TIMES.resumeCall, RESUMED_AGENT_TIMES.resumed, 'Resuming agent a38e168', '[summary]')]

    expect(runningIds(messages, AFTER_RESUME, null)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/plain text/)
  })

  it('does not take a queued message for a resume', () => {
    expect(QUEUED_RESULT).toContain('Message queued for delivery')
    expect(runningIds([...launchRecords(), notificationRecord(), ...queuedRecords()], AFTER_QUEUED, null, [ID])).toEqual([])
  })
})

describe('a foreground agent the lead resumed after its report', () => {
  // The report a foreground agent returns once its run is over, from a NexOS
  // session on this machine (2026-08-11 07:56 UTC), cut after its first line.
  const reportAt = at('2026-08-11T07:56:05.179Z')
  const report = `## Summary

**Verdict: NO** — no official IONITY truck-suitability flag for German sites exists.
agentId: a093e15feb44a7819 (use SendMessage with to: 'a093e15feb44a7819', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 92022
tool_uses: 28
duration_ms: 310179</usage>`
  const messages: NativeChatMessage[] = [
    { id: 'call', role: 'assistant', timestamp: reportAt - 310_179, source: 'transcript', blocks: [{ type: 'tool-call', name: 'Agent', input: { description: 'Research IONITY truck sites', subagent_type: 'general-purpose' } }] },
    { id: 'report', role: 'user', timestamp: reportAt, source: 'transcript', blocks: [{ type: 'tool-result', output: report }] }
  ]
  const resume = (resultAt: number | null): NativeChatMessage[] => [
    {
      id: `resume-call-${resultAt}`,
      role: 'assistant',
      timestamp: resultAt,
      source: 'transcript',
      blocks: [{ type: 'tool-call', name: 'SendMessage', input: { to: 'a093e15feb44a7819', message: '[message]', summary: '[summary]', type: 'message' } }]
    },
    {
      id: `resume-${resultAt}`,
      role: 'user',
      timestamp: resultAt,
      source: 'transcript',
      blocks: [{ type: 'tool-result', output: '{"success":true,"message":"Resuming agent a093e15","resumedAgentId":"a093e15feb44a7819"}' }]
    }
  ]

  it('counts it as running from the resume', () => {
    const resumedAt = reportAt + 600_000
    const tasks = deriveBackgroundTasks([...messages, ...resume(resumedAt)], resumedAt + 1000, null)

    expect(tasks.running.map((task) => [task.id, task.title, task.startedAt])).toEqual([['a093e15feb44a7819', 'Research IONITY truck sites', resumedAt]])
  })

  it('does not count a resume it cannot place after the report', () => {
    // No time on the resume: the report is placed after the window and only
    // time orders the two, so the run is taken as over.
    expect(deriveBackgroundTasks([...messages, ...resume(null)], reportAt + 700_000, null).running).toEqual([])
  })
})

describe('what the review of this fix found (2026-09-28)', () => {
  const LATER = at('2026-09-28T18:01:00.000Z')
  let n = 0
  const command = (iso: string, output: string): NativeChatMessage[] => {
    n += 1
    return [
      { id: `bash-call-${n}`, role: 'assistant', timestamp: at(iso), source: 'transcript', blocks: [{ type: 'tool-call', name: 'Bash', input: { command: "jq '.toolUseResult' record.json" } }] },
      { id: `bash-result-${n}`, role: 'user', timestamp: at(iso) + 500, source: 'transcript', blocks: [{ type: 'tool-result', output }] }
    ]
  }
  // How this bug was investigated: jq over the lead's own records.
  const printedResume = JSON.stringify(JSON.parse(RESUME_RESULT), null, 2)

  it("does not take a command's printout of a resume for a resume", () => {
    const messages = [...launchRecords(), notificationRecord('2026-09-28T17:05:00.000Z', COMPLETED_NOTIFICATION), ...command('2026-09-28T18:00:00.000Z', printedResume)]

    expect(runningIds(messages, LATER, null)).toEqual([])
    expect(deriveBackgroundTasks(messages, LATER, pane([])).finished.map((task) => [task.id, task.status])).toEqual([[ID, 'completed']])
  })

  it('does not count a reviewer because a command printed its resume', () => {
    const reviewer = RESUMED_AGENTS_REVIEWER_ROW.id
    const output = JSON.stringify({ success: true, message: `Resuming agent ${reviewer.slice(0, 7)}`, resumedAgentId: reviewer })
    const tasks = deriveBackgroundTasks(command('2026-09-28T18:00:00.000Z', output), LATER, pane([RESUMED_AGENTS_REVIEWER_ROW]), {
      agentProvenance: { ownAgentIds: [ID], preexistingAgentIds: [] }
    })

    expect(tasks.running).toEqual([])
  })

  it('reads a resume whose result came back before a command called beside it', () => {
    const turn: NativeChatMessage = {
      id: 'parallel-calls',
      role: 'assistant',
      timestamp: at(RESUMED_AGENT_TIMES.resumeCall),
      source: 'transcript',
      blocks: [
        { type: 'tool-call', name: 'Bash', input: { command: 'git status' } },
        { type: 'tool-call', name: 'SendMessage', input: { to: ID, message: '[message]', summary: '[summary]', type: 'message' } }
      ]
    }
    const result = (id: string, output: string): NativeChatMessage => ({ id, role: 'user', timestamp: at(RESUMED_AGENT_TIMES.resumed), source: 'transcript', blocks: [{ type: 'tool-result', output }] })
    const messages = [...launchRecords(), notificationRecord(), turn, result('resume-first', RESUME_RESULT), result('status-second', 'On branch main')]

    expect(runningIds(messages, AFTER_RESUME, pane([RESUMED_AGENT_ROSTER_ROW]))).toEqual([ID])
  })

  it('stops counting a resumed subagent with no host status once an id-only list names it', () => {
    // With no host status nothing can see the resumed run end mid-turn (Orca's
    // reader drops that notification), and the beacon's `done=` cannot say
    // which run it names. Counting it would last forever; so it is not.
    const dayLater = at('2026-09-29T16:30:00.000Z')
    const tasks = deriveBackgroundTasks(failedThenResumed(), dayLater, null, { finishedTaskIds: [ID], runningTaskIds: [], runningTaskIdsAt: dayLater - 1000 })

    expect(tasks.running).toEqual([])
  })

  it("names a resumed agent whose launch slid out of the window by the roster's agent type", () => {
    const row: AgentSubagentSnapshot = { id: ID, state: 'working', startedAt: at('2026-09-28T16:28:14.000Z'), agentType: 'general-purpose' }
    const tasks = deriveBackgroundTasks(resumeRecords(), AFTER_RESUME, pane([row]), { agentProvenance: { ownAgentIds: [ID], preexistingAgentIds: [] } })

    expect(tasks.running.map((task) => [task.id, task.title])).toEqual([[ID, 'general-purpose']])
  })

  it('logs each refused resume once, however many the window holds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const messages = Array.from({ length: 201 }, (_unused, index) =>
      sendMessageRecords(RESUMED_AGENT_TIMES.resumeCall, RESUMED_AGENT_TIMES.resumed, `Resuming agent a${index}`, `[summary ${index}]`)
    ).flat()
    deriveBackgroundTasks(messages, AFTER_RESUME, null)
    const first = warn.mock.calls.length
    deriveBackgroundTasks(messages, AFTER_RESUME, null)

    expect(first).toBe(201)
    expect(warn.mock.calls.length).toBe(first)
  })
})
