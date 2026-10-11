import { describe, expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { mobileTaskListState } from './mobile-native-chat-task-list-rows'

// The calls and results below are a real Claude Code session's, verbatim
// (Walletify, Claude Code 2.1.228; descriptions cut, ids as written). Claude
// Code 2.1.296 still answers a create with "Task #<id> created successfully:
// <subject>" (its own result builder), which is where the id lives.

function create(callId: string, subject: string, activeForm: string): NativeChatBlock {
  return {
    type: 'tool-call',
    name: 'TaskCreate',
    callId,
    state: 'completed',
    input: { subject, description: 'After screen agents finish…', activeForm }
  }
}
function update(callId: string, taskId: string, status: string): NativeChatBlock {
  return { type: 'tool-call', name: 'TaskUpdate', callId, state: 'completed', input: { taskId, status } }
}
function result(callId: string, output: string, isError = false): NativeChatBlock {
  return { type: 'tool-result', callId, output, ...(isError ? { isError } : {}) }
}
function turn(id: string, blocks: NativeChatBlock[]): NativeChatMessage {
  return { id, role: 'assistant', timestamp: 1, source: 'transcript', blocks }
}

const REBUILD = 'Rebuild all seven screens per Tiles of Fact spec via six parallel screen agents'
const QA = 'QA pass, bundle export, contrast gate, commit Tiles of Fact rebuild'

const SESSION: NativeChatMessage[] = [
  // An update for a task this transcript never created (#5, from an earlier session).
  turn('a', [update('toolu_01Kc', '5', 'completed'), result('toolu_01Kc', 'Updated task #5 status')]),
  turn('b', [
    create('toolu_015A', REBUILD, 'Rebuilding all seven screens via parallel agents'),
    result('toolu_015A', `Task #7 created successfully: ${REBUILD}`)
  ]),
  turn('c', [
    create('toolu_01Pr', QA, 'Running QA and committing the rebuild'),
    result('toolu_01Pr', `Task #8 created successfully: ${QA}`)
  ]),
  turn('d', [update('toolu_01U8', '7', 'in_progress'), result('toolu_01U8', 'Updated task #7 status')])
]

describe('the todo pill reads the list Claude Code builds with its Task tools', () => {
  it('lists the tasks this session created, in the order they were made', () => {
    expect(mobileTaskListState(SESSION).list).toEqual({
      tasks: [
        { content: REBUILD, status: 'in_progress', activeForm: 'Rebuilding all seven screens via parallel agents' },
        { content: QA, status: 'pending', activeForm: 'Running QA and committing the rebuild' }
      ]
    })
  })

  it('follows parallel updates whose results land after both calls', () => {
    const list = mobileTaskListState([
      ...SESSION,
      turn('e', [
        update('toolu_01NY', '6', 'completed'),
        update('toolu_01UR', '7', 'completed'),
        result('toolu_01NY', 'Updated task #6 status'),
        result('toolu_01UR', 'Updated task #7 status')
      ])
    ]).list
    expect(list?.tasks.map((task) => task.status)).toEqual(['completed', 'pending'])
  })

  it('leaves out a create whose result names no id, and an update that failed', () => {
    const list = mobileTaskListState([
      ...SESSION,
      turn('e', [create('x1', 'Ship it', 'Shipping'), result('x1', 'Error: task list is locked', true)]),
      turn('f', [update('x2', '8', 'completed'), result('x2', 'Task not found', true)])
    ]).list
    expect(list?.tasks.map((task) => task.content)).toEqual([REBUILD, QA])
    expect(list?.tasks[1]?.status).toBe('pending')
  })

  it('drops a deleted task, and shows nothing once the last one is gone', () => {
    const one = mobileTaskListState([
      ...SESSION,
      turn('e', [update('d1', '8', 'deleted'), result('d1', 'Updated task #8 deleted')])
    ]).list
    expect(one?.tasks.map((task) => task.content)).toEqual([REBUILD])
    const none = mobileTaskListState([
      ...SESSION,
      turn('e', [update('d1', '8', 'deleted'), result('d1', 'Updated task #8 deleted')]),
      turn('f', [update('d2', '7', 'deleted'), result('d2', 'Updated task #7 deleted')])
    ]).list
    expect(none).toBeNull()
  })

  it('shows nothing for a transcript with no plan, or only updates to unknown tasks', () => {
    expect(mobileTaskListState([]).list).toBeNull()
    expect(mobileTaskListState([SESSION[0]!]).list).toBeNull()
  })

  it('shows whichever plan changed last: a later Codex update_plan wins, and so does a later Task call', () => {
    const codexPlan: NativeChatBlock = {
      type: 'tool-call',
      name: 'update_plan',
      state: 'completed',
      input: { plan: [{ step: 'Read the parser', status: 'in_progress' }] }
    }
    const afterCodex = mobileTaskListState([...SESSION, turn('e', [codexPlan, result('p', 'Plan updated')])]).list
    expect(afterCodex?.tasks.map((task) => task.content)).toEqual(['Read the parser'])
    const afterTask = mobileTaskListState([
      turn('z', [codexPlan, result('p', 'Plan updated')]),
      ...SESSION
    ]).list
    expect(afterTask?.tasks.map((task) => task.content)).toEqual([REBUILD, QA])
  })
})
