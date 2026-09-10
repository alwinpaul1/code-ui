// Guards for two shared hot paths the chat view runs on every frame, after the
// allocation work in Orca #19496 (6a9c5d8ce) and #19468 (44eb95fc6). Both are
// pure refactors: the answers below are the answers before them too.
//
// They live under mobile/ because `src/shared/*.test.ts` is vendored and never
// runs here — vitest is rooted at mobile/ — so upstream's own tests for these
// commits cannot guard anything in this fork.

import { describe, expect, it } from 'vitest'
import { extractPendingAsk } from '../../../src/shared/native-chat-ask'
import { foldToolMessages, pairToolBlocks } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'

function message(
  role: NativeChatMessage['role'],
  blocks: NativeChatBlock[],
  id = `m-${role}-${blocks.length}`
): NativeChatMessage {
  return { id, role, source: 'transcript', timestamp: 0, blocks }
}

const ASK_INPUT = {
  questions: [{ question: 'Ship it?', options: ['Yes', 'No'] }]
}

describe('the ask card over the composer', () => {
  it('stays up while an unrelated call answers ahead of it', () => {
    const pending = extractPendingAsk([
      message('assistant', [
        { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool-call', name: 'AskUserQuestion', input: ASK_INPUT }
      ]),
      // The Read answers first. FIFO: this result belongs to the Read, not to
      // the ask sitting behind it.
      message('tool', [{ type: 'tool-result', output: 'file contents' }])
    ])
    expect(pending?.questions[0]?.question).toBe('Ship it?')
  })

  it('comes down once the answer to the ask itself lands', () => {
    const pending = extractPendingAsk([
      message('assistant', [
        { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool-call', name: 'AskUserQuestion', input: ASK_INPUT }
      ]),
      message('tool', [{ type: 'tool-result', output: 'file contents' }]),
      message('tool', [{ type: 'tool-result', output: 'yes' }])
    ])
    expect(pending).toBeNull()
  })

  it('comes down when a new user turn strands it', () => {
    const pending = extractPendingAsk([
      message('assistant', [{ type: 'tool-call', name: 'AskUserQuestion', input: ASK_INPUT }]),
      message('user', [{ type: 'text', text: 'never mind' }])
    ])
    expect(pending).toBeNull()
  })
})

describe('a tool run the view has capped', () => {
  it('still pairs every call it draws with its own result', () => {
    const blocks: NativeChatBlock[] = []
    for (let index = 0; index < 6; index++) {
      blocks.push({ type: 'tool-call', name: `Tool${index}`, input: { index } })
    }
    for (let index = 0; index < 6; index++) {
      blocks.push({ type: 'tool-result', output: `out-${index}` })
    }
    const pairs = pairToolBlocks(blocks, 3)
    expect(pairs).toHaveLength(3)
    expect(pairs.map((pair) => pair.call?.name)).toEqual(['Tool0', 'Tool1', 'Tool2'])
    expect(pairs.map((pair) => pair.result?.output)).toEqual(['out-0', 'out-1', 'out-2'])
  })

  it('keeps an orphan result visible when no call precedes it', () => {
    const pairs = pairToolBlocks([{ type: 'tool-result', output: 'orphan' }])
    expect(pairs).toEqual([{ result: { type: 'tool-result', output: 'orphan' } }])
  })
})

describe('a tool message the renderer cannot fully attribute', () => {
  it('keeps every block it can pair and drops only the unpairable ones', () => {
    const folded = foldToolMessages([
      message('assistant', [{ type: 'text', text: 'working' }], 'a1'),
      message(
        'tool',
        [
          { type: 'tool-result', output: 'stranded' },
          { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
          { type: 'tool-result', output: 'kept' }
        ],
        't1'
      )
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0]!.blocks).toEqual([
      { type: 'text', text: 'working' },
      { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool-result', output: 'kept' }
    ])
  })

  it('leaves a fully attributable message exactly as it arrived', () => {
    const blocks: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool-result', output: 'ok' }
    ]
    const folded = foldToolMessages([
      message('assistant', [{ type: 'text', text: 'working' }], 'a1'),
      message('tool', blocks, 't1')
    ])
    expect(folded[0]!.blocks.slice(1)).toEqual(blocks)
  })
})
