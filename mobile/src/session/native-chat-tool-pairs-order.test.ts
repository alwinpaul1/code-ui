import { describe, expect, it } from 'vitest'
import { pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import { unpairedToolResultIndices } from '../../../src/shared/native-chat-tool-pairs'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'

// Orca #26968 (8452fc3315) moved pairing into native-chat-tool-pairs.ts with an id index, so a
// long run of out-of-order results costs one lookup each. The answers are the ones the fork's
// own pairToolBlocks gave (#22619): these cases pin that, since upstream's shared tests are not
// collected here, and they passed on the old pairer too.

const call = (callId: string | undefined, command: string): NativeChatBlock => ({
  type: 'tool-call',
  name: 'Bash',
  ...(callId ? { callId } : {}),
  input: { command }
})
const result = (callId: string | undefined, output: string): NativeChatBlock => ({
  type: 'tool-result',
  ...(callId ? { callId } : {}),
  output
})

describe('pairing a run of tool results with their commands', () => {
  it('gives a result that finished early to the command it names, not the oldest', () => {
    const pairs = pairToolBlocks([
      call('test', 'pnpm test'),
      call('read', 'cat a.ts'),
      result('read', 'file contents'),
      result('test', 'all green')
    ])
    expect(pairs.map((pair) => [pair.call?.input, pair.result?.output])).toEqual([
      [{ command: 'pnpm test' }, 'all green'],
      [{ command: 'cat a.ts' }, 'file contents']
    ])
  })

  it('keeps a named result whose command is not in the run as a result of its own', () => {
    const blocks = [call('a', 'ls'), result('elsewhere', 'stray'), result('a', 'listing')]
    expect(pairToolBlocks(blocks)).toEqual([
      { call: blocks[0], result: blocks[2] },
      { result: blocks[1] }
    ])
    expect([...unpairedToolResultIndices(blocks)]).toEqual([1])
  })

  it('answers the oldest call for an unnamed result, whatever its id, and the oldest of a repeated id', () => {
    const blocks = [
      call('dup', 'first'),
      call('dup', 'second'),
      call(undefined, 'third'),
      result('dup', 'one'),
      result(undefined, 'two'),
      result('dup', 'three')
    ]
    const pairs = pairToolBlocks(blocks)
    // 'two' names nothing, so it takes the oldest call still open (the second 'dup'); 'three' then
    // finds no 'dup' left and stands as a result of its own.
    expect(pairs.map((pair) => pair.result?.output)).toEqual(['one', 'two', undefined, 'three'])
  })

  it('handles the empty run and a run of one', () => {
    expect(pairToolBlocks([])).toEqual([])
    expect(pairToolBlocks([result(undefined, 'only')])).toEqual([{ result: result(undefined, 'only') }])
  })

  it('stops at its limit while still answering the calls it kept', () => {
    const blocks = [call('a', 'a'), call('b', 'b'), call('c', 'c'), result('a', 'A'), result('c', 'C')]
    expect(pairToolBlocks(blocks, 2)).toEqual([{ call: blocks[0], result: blocks[3] }, { call: blocks[1] }])
  })
})
