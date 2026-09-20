import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { countRunningBackgroundTasks, deriveBackgroundTasks } from './mobile-background-tasks'
import { backgroundTaskStatusLabel } from './mobile-background-task-labels'

// Message builders, as in mobile-background-tasks.test.ts: transcript blocks
// carry no tool ids, so a call and its result pair by order.
let nextId = 0

function call(name: string, input: unknown, timestamp: number | null): NativeChatMessage {
  nextId += 1
  return { id: `assistant-${nextId}`, role: 'assistant', timestamp, source: 'transcript', blocks: [{ type: 'tool-call', name, input }] }
}

function result(output: string, timestamp: number | null): NativeChatMessage {
  nextId += 1
  return { id: `result-${nextId}`, role: 'user', timestamp, source: 'transcript', blocks: [{ type: 'tool-result', output }] }
}

// Verbatim from a Claude Code 2.x transcript on this machine (2026-09-09).
const agentLaunchOutput = (id: string) =>
  `Async agent launched successfully. (This tool result is internal metadata — never quote or paste any part of it, including the agentId below, into a user-facing reply.)
agentId: ${id} (internal ID - do not mention to user. Use SendMessage with to: '${id}', summary: '<5-10 word recap>' to continue this agent.)
The agent is working in the background. You will be notified automatically when it completes.`

// From the phone, 2026-09-20, on a HAND-STARTED tab (a bare `claude` typed
// into an Orca terminal, so no Code UI beacon: no `live=`, no `done=`, no
// `run=`). Three shells were launched in one turn; the first finished
// mid-turn, which Claude Code 2.1.277 records as a `queue-operation` and
// an `attachment` (commandMode `task-notification`) that Orca's reader never
// surfaces. Desk footer: "⏵⏵ auto mode on · 2 shells · ← for agents". Phone:
// "3 running tasks". The launches below are this session's own tool
// results, verbatim; the pane stayed `working` (monitoring) with its
// `stateStartedAt` pinned before the launches, so nothing retired the first.
describe('a hand-started tab whose footer counts fewer shells than the phone names', () => {
  const launch = (id: string, description: string, at: number) => [
    call('Bash', { command: `# ${id}`, description, run_in_background: true }, at),
    result(
      `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/7449d614-3e02-439b-8e71-5bed99eaf4f0/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.
Session cwd remains /Users/alwinpaul/Desktop/Project/Code UI; directory changes made by the backgrounded command do not apply to subsequent commands.`,
      at + 500
    )
  ]
  const turnStart = Date.UTC(2026, 8, 20, 18, 1, 31)
  const transcript = [
    ...launch('bud7tazkw', 'Build the release APK locally', Date.UTC(2026, 8, 20, 18, 9, 7)),
    ...launch('bgcig10bq', 'Watch the 0.9.7 release workflow to completion', Date.UTC(2026, 8, 20, 18, 9, 40)),
    ...launch('b9y349v6k', 'Wait until the phone shows up on adb', Date.UTC(2026, 8, 20, 18, 9, 57))
  ]
  const pane = { state: 'working' as const, workingMode: 'monitoring' as const, stateStartedAt: turnStart }
  const later = Date.UTC(2026, 8, 20, 18, 40, 0)

  it('shows the count the agent itself paints, and retires the surplus oldest first', () => {
    const tasks = deriveBackgroundTasks(transcript, later, pane, { onScreenShellCount: 2 })
    expect(tasks.running.map((task) => task.id)).toEqual(['bgcig10bq', 'b9y349v6k'])
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([['bud7tazkw', 'finished']])
    expect(countRunningBackgroundTasks(transcript, pane, { onScreenShellCount: 2 }, later)).toBe(2)
  })

  it('labels the retired row as finished by the agent\'s count, not as completed', () => {
    const tasks = deriveBackgroundTasks(transcript, later, pane, { onScreenShellCount: 2 })
    expect(backgroundTaskStatusLabel(tasks.finished[0]!.status)).toBe("Finished (agent's count)")
  })

  it('retires every named shell when the footer says none are running', () => {
    const tasks = deriveBackgroundTasks(transcript, later, pane, { onScreenShellCount: 0 })
    expect(tasks.running).toEqual([])
    expect(tasks.finished.map((task) => task.id).sort()).toEqual(['b9y349v6k', 'bgcig10bq', 'bud7tazkw'])
  })

  it('leaves one named shell alone when the footer counts one', () => {
    const tasks = deriveBackgroundTasks(transcript.slice(0, 2), later, pane, { onScreenShellCount: 1 })
    expect(tasks.running.map((task) => task.id)).toEqual(['bud7tazkw'])
    expect(tasks.finished).toEqual([])
  })

  it('never retires a subagent to meet a shell count', () => {
    const withAgent = [
      ...transcript,
      call('Agent', { description: 'Review the diff', prompt: 'review' }, Date.UTC(2026, 8, 20, 18, 10, 0)),
      result(agentLaunchOutput('a-review'), Date.UTC(2026, 8, 20, 18, 10, 1))
    ]
    const tasks = deriveBackgroundTasks(withAgent, later, { ...pane, subagents: [{ id: 'a-review', description: 'Review the diff', state: 'working', startedAt: later }] }, { onScreenShellCount: 2 })
    expect(tasks.running.map((task) => task.id)).toEqual(['bgcig10bq', 'b9y349v6k', 'a-review'])
  })

  it('does not retire a shell launched seconds ago, before the footer could have counted it', () => {
    // The screen is polled (1 s working, 5 s idle) and the transcript is
    // pushed, so a fresh launch can be named before the footer's count has
    // moved. Without a grace the row would flip to finished and back.
    const fresh = [
      ...transcript,
      ...launch('bfresh001', 'Just started', later - 3_000)
    ]
    const tasks = deriveBackgroundTasks(fresh, later, pane, { onScreenShellCount: 3 })
    expect(tasks.running.map((task) => task.id)).toEqual(['bgcig10bq', 'b9y349v6k', 'bfresh001'])
    expect(tasks.finished.map((task) => task.id)).toEqual(['bud7tazkw'])
  })

  it('does not cap while the footer is off screen', () => {
    const tasks = deriveBackgroundTasks(transcript, later, pane, {})
    expect(tasks.running).toHaveLength(3)
  })
})
