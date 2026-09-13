import { describe, expect, it } from 'vitest'
import type { NativeChatMessage, NativeChatSource } from '../../../src/shared/native-chat-types'
import { splitHookThinkingRows } from './mobile-native-chat-thinking-rows'

function row(
  id: string,
  source: NativeChatSource,
  blocks: NativeChatMessage['blocks']
): NativeChatMessage {
  return { id, role: 'assistant', blocks, timestamp: 0, source }
}
const text = (t: string) => ({ type: 'text' as const, text: t })
const call = { type: 'tool-call' as const, id: 'c1', name: 'Bash', input: { command: 'ls' } }
const claude = { agent: 'claude', transcriptReadable: true }

// 2026-09-13: three of the model's summarized thoughts stood in the chat as
// replies, in words it never said to the user. The transcript reader drops
// thinking blocks, so they had reached the phone through the hook stream.
describe('splitHookThinkingRows', () => {
  it('turns a hook row on Claude into a collapsed thought and keeps its tools under the original id', () => {
    const folded = [row('a1', 'hook', [text('0.5.48 published fine, but…'), call])]
    expect(splitHookThinkingRows(folded, claude)).toEqual([
      { ...folded[0], id: 'a1:thinking', role: 'reasoning', blocks: [text('0.5.48 published fine, but…')] },
      { ...folded[0], blocks: [call] }
    ])
  })

  it('keeps the original id when the row was nothing but the thought', () => {
    const folded = [row('a1', 'hook', [text('just a thought')])]
    expect(splitHookThinkingRows(folded, claude)).toEqual([
      { ...folded[0], role: 'reasoning' }
    ])
  })

  it('leaves a transcript row alone: that is a reply the model wrote', () => {
    const folded = [row('a1', 'transcript', [text('Verified on your phone.'), call])]
    expect(splitHookThinkingRows(folded, claude)).toEqual(folded)
  })

  it('leaves hook rows alone when the transcript cannot be read, since they are the only replies then', () => {
    const folded = [row('a1', 'hook', [text('a real reply'), call])]
    expect(splitHookThinkingRows(folded, { agent: 'claude', transcriptReadable: false })).toEqual(folded)
  })

  it('leaves other agents alone', () => {
    const folded = [row('a1', 'hook', [text('a codex reply')])]
    expect(splitHookThinkingRows(folded, { agent: 'codex', transcriptReadable: true })).toEqual(folded)
  })
})
