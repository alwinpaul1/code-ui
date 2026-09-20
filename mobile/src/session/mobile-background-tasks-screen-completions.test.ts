import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { countRunningBackgroundTasks, deriveBackgroundTasks } from './mobile-background-tasks'

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

// This session's own launch results, verbatim (Claude Code 2.1.277, 2026-09-20).
const launched = (id: string, input: Record<string, unknown>, at: number) => [
  call('Bash', { ...input, run_in_background: true }, at),
  result(
    `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/7449d614-3e02-439b-8e71-5bed99eaf4f0/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`,
    at + 500
  )
]

// A completion the phone read off the agent's screen: the notification's own
// <summary>, which quotes the launch's `description` (19 of 19 in this
// session's transcript) or, for a launch without one, its whole command
// (seen across ~2,600 summaries on this machine). The screen half that reads
// the row is mobile-terminal-task-completions.ts; this is the reader half.
describe('a completion the agent stated on its screen', () => {
  const T = Date.UTC(2026, 8, 20, 18, 9, 0)
  const later = T + 30 * 60_000
  const pane = { state: 'working' as const, workingMode: 'monitoring' as const, stateStartedAt: T - 60_000 }
  const three = [
    ...launched('bud7tazkw', { command: './gradlew assembleRelease', description: 'Build the release APK locally' }, T + 7_000),
    ...launched('bgcig10bq', { command: 'gh run watch 1', description: 'Watch the 0.9.7 release workflow to completion' }, T + 40_000),
    ...launched('b9y349v6k', { command: 'until adb devices; do sleep 5; done', description: 'Wait until the phone shows up on adb' }, T + 57_000)
  ]

  it('retires the launch whose description the row names, with the status the row states', () => {
    const tasks = deriveBackgroundTasks(three, later, pane, {
      screenCompletions: [{ label: 'Build the release APK locally', status: 'completed' }]
    })
    expect(tasks.running.map((task) => task.id)).toEqual(['bgcig10bq', 'b9y349v6k'])
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([['bud7tazkw', 'completed']])
  })

  it('marks the task failed when the row says it failed', () => {
    const tasks = deriveBackgroundTasks(three, later, pane, {
      screenCompletions: [{ label: 'Watch the 0.9.7 release workflow to completion', status: 'failed' }]
    })
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([['bgcig10bq', 'failed']])
  })

  it('matches a launch with no description by its whole command, whitespace folded', () => {
    const transcript = launched('bnodesc01', { command: 'cd mobile &&\n  npx vitest run' }, T)
    const tasks = deriveBackgroundTasks(transcript, later, pane, {
      screenCompletions: [{ label: 'cd mobile && npx vitest run', status: 'completed' }]
    })
    expect(tasks.running).toEqual([])
    expect(tasks.finished.map((task) => task.id)).toEqual(['bnodesc01'])
  })

  it('retires the older of two launches that share a description, one per stated completion', () => {
    const twins = [
      ...launched('bgate0001', { command: 'npx vitest run', description: 'Run the gate' }, T),
      ...launched('bgate0002', { command: 'npx vitest run', description: 'Run the gate' }, T + 5_000)
    ]
    const one = deriveBackgroundTasks(twins, later, pane, { screenCompletions: [{ label: 'Run the gate', status: 'completed' }] })
    expect(one.running.map((task) => task.id)).toEqual(['bgate0002'])
    expect(one.finished.map((task) => task.id)).toEqual(['bgate0001'])
    const both = deriveBackgroundTasks(twins, later, pane, {
      screenCompletions: [
        { label: 'Run the gate', status: 'completed' },
        { label: 'Run the gate', status: 'completed' }
      ]
    })
    expect(both.running).toEqual([])
  })

  it('retires nothing for a row naming no launch the phone holds', () => {
    const tasks = deriveBackgroundTasks(three, later, pane, {
      screenCompletions: [{ label: 'Something launched above the window', status: 'completed' }]
    })
    expect(tasks.running).toHaveLength(3)
  })

  it('does not retire a launch a transcript notification already settled, twice', () => {
    const tasks = deriveBackgroundTasks(three, later, pane, {
      finishedTaskIds: ['bud7tazkw'],
      screenCompletions: [{ label: 'Build the release APK locally', status: 'failed' }]
    })
    // The beacon's answer came first and stands; the row does not re-decide it.
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([['bud7tazkw', 'completed']])
    expect(tasks.running).toHaveLength(2)
  })

  it('leaves the footer cap to retire what no row named', () => {
    const tasks = deriveBackgroundTasks(three, later, pane, {
      screenCompletions: [{ label: 'Wait until the phone shows up on adb', status: 'completed' }],
      onScreenShellCount: 1
    })
    expect(tasks.running.map((task) => task.id)).toEqual(['bgcig10bq'])
    // The count-retired row leads: it was decided just now, the stated one
    // when its row was read.
    expect(tasks.finished.map((task) => [task.id, task.status])).toEqual([
      ['bud7tazkw', 'finished'],
      ['b9y349v6k', 'completed']
    ])
    expect(countRunningBackgroundTasks(three, pane, { screenCompletions: [{ label: 'Wait until the phone shows up on adb', status: 'completed' }], onScreenShellCount: 1 }, later)).toBe(1)
  })

  it('never retires a subagent by a shell row', () => {
    const withAgent = [
      ...three,
      call('Agent', { description: 'Build the release APK locally', prompt: 'x' }, T + 60_000),
      result('agentId: a-build (internal ID - do not mention to user.)', T + 60_500)
    ]
    const tasks = deriveBackgroundTasks(withAgent, later, { ...pane, subagents: [{ id: 'a-build', description: 'Build the release APK locally', state: 'working', startedAt: later }] }, {
      screenCompletions: [{ label: 'Build the release APK locally', status: 'completed' }]
    })
    expect(tasks.running.map((task) => task.id)).toEqual(['bgcig10bq', 'b9y349v6k', 'a-build'])
  })
})
