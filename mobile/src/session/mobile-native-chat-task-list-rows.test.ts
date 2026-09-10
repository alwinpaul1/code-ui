import { describe, expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import {
  mobileTaskListPredecessors,
  mobileTaskListRows,
  mobileTaskListState
} from './mobile-native-chat-task-list-rows'

function call(
  content: string,
  status = 'pending',
  name = 'TodoWrite'
): NativeChatBlock {
  return {
    type: 'tool-call',
    name,
    input:
      name === 'TodoWrite'
        ? { todos: [{ content, status }] }
        : { plan: [{ step: content, status }] },
    state: 'completed'
  }
}

function message(
  id: string,
  blocks: NativeChatBlock[],
  role: NativeChatMessage['role'] = 'assistant'
): NativeChatMessage {
  return { id, role, timestamp: 1, source: 'transcript', blocks }
}

describe('checklist history across turns', () => {
  it('diffs a later message against the plan from an earlier one, not only this run', () => {
    const first = call('Read the parser', 'pending')
    const next = call('Read the parser', 'completed')
    const history = mobileTaskListPredecessors([
      message('a', [first, { type: 'tool-result', output: 'ok' }]),
      message('b', [{ type: 'text', text: 'Continue' }], 'user'),
      message('c', [next, { type: 'tool-result', output: 'ok' }])
    ])
    const rows = mobileTaskListRows(
      pairToolBlocks([next, { type: 'tool-result', output: 'ok' }]),
      history.get('c')
    )
    expect(rows[0]?.previous?.tasks[0]?.status).toBe('pending')
    expect(rows[0]?.list.tasks[0]?.status).toBe('completed')
  })

  it('keeps Claude and Codex plans separate', () => {
    const claude = call('Read', 'pending', 'TodoWrite')
    const codex = call('Read', 'pending', 'update_plan')
    const next = call('Read', 'completed', 'TodoWrite')
    const history = mobileTaskListPredecessors([
      message('a', [claude]),
      message('b', [codex]),
      message('c', [next])
    ])
    expect(history.get('c')).toEqual({
      todowrite: expect.objectContaining({ tasks: [{ content: 'Read', status: 'pending' }] }),
      update_plan: expect.objectContaining({ tasks: [{ content: 'Read', status: 'pending' }] })
    })
    const rows = mobileTaskListRows(pairToolBlocks([next]), history.get('c'))
    expect(rows[0]?.previous?.tasks[0]?.status).toBe('pending')
  })
})

describe('the latest plan the composer can show', () => {
  it('survives a user follow-up and clears on an explicit empty list', () => {
    const first = message('first', [call('Read')])
    const user = message('user', [{ type: 'text', text: 'Continue' }], 'user')
    const empty = message('empty', [
      { type: 'tool-call', name: 'TodoWrite', input: { todos: [] }, state: 'completed' }
    ])
    expect(mobileTaskListState([first, user]).list?.tasks).toHaveLength(1)
    expect(mobileTaskListState([first, user, empty]).list?.tasks).toEqual([])
    expect(mobileTaskListState([]).list).toBeNull()
  })

  it('does not replace a valid plan with a failed or malformed call', () => {
    const first = message('first', [call('Read')])
    const failed = message('failed', [
      { type: 'tool-call', name: 'TodoWrite', input: { todos: [{ content: 'Wrong' }] }, state: 'failed' }
    ])
    expect(mobileTaskListState([first, failed]).list?.tasks[0]?.content).toBe('Read')
  })
})
