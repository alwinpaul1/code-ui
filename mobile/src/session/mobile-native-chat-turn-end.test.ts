import { describe, expect, it } from 'vitest'
import type { NativeChatMessage, NativeChatRole } from '../../../src/shared/native-chat-types'
import { messageIdsEndingATurn } from './mobile-native-chat-turn-end'

// The Claude app draws its copy and speak actions once, at the end of the
// assistant's turn (2026-10-09 screenshot). Ours drew copy and the scroll-up
// arrow under every assistant message, even beside a tool row. A turn runs
// from a prompt to the next one, so the message that ends it is the last one
// before a prompt, a notice, or the end of the list.

const message = (id: string, role: NativeChatRole): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text: id }],
  timestamp: null,
  source: 'transcript'
})

const ending = (rows: [string, NativeChatRole][]): string[] =>
  [...messageIdsEndingATurn(rows.map(([id, role]) => message(id, role)))].sort()

describe('the message that ends a turn', () => {
  it('is the only message of a turn with a single block', () => {
    expect(ending([['u1', 'user'], ['a1', 'assistant']])).toEqual(['a1'])
  })

  it('is the last assistant message of a turn made of several', () => {
    expect(ending([['u1', 'user'], ['a1', 'assistant'], ['a2', 'assistant'], ['a3', 'assistant']])).toEqual(['a3'])
  })

  it('is not an assistant message a tool result, a thought or more words follow', () => {
    expect(
      ending([['u1', 'user'], ['a1', 'assistant'], ['t1', 'tool'], ['r1', 'reasoning'], ['a2', 'assistant']])
    ).toEqual(['a2'])
  })

  it('is one per turn when the conversation holds several', () => {
    expect(
      ending([
        ['u1', 'user'], ['a1', 'assistant'], ['a2', 'assistant'],
        ['u2', 'user'], ['a3', 'assistant'],
        ['u3', 'user'], ['a4', 'assistant'], ['a5', 'assistant']
      ])
    ).toEqual(['a2', 'a3', 'a5'])
  })

  it('is cut off by a notice, which the agent did not say', () => {
    expect(ending([['u1', 'user'], ['a1', 'assistant'], ['s1', 'system'], ['a2', 'assistant']])).toEqual(['a1', 'a2'])
  })

  it('is the last row of a list with no prompt at all', () => {
    expect(ending([['a1', 'assistant'], ['a2', 'assistant']])).toEqual(['a2'])
  })

  it('is never a prompt, even a last one', () => {
    expect(ending([['u1', 'user'], ['u2', 'user']])).toEqual([])
  })

  it('is nothing for an empty list, and the one row of a list of one', () => {
    expect(ending([])).toEqual([])
    expect(ending([['a1', 'assistant']])).toEqual(['a1'])
  })
})
