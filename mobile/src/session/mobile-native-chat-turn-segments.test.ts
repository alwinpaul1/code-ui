import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { splitTurnIntoSegments } from './mobile-native-chat-turn-segments'

const text = (t: string): NativeChatBlock => ({ type: 'text', text: t })
const call = (name: string): NativeChatBlock => ({ type: 'tool-call', name, input: {} })
const result = (output: string): NativeChatBlock => ({ type: 'tool-result', output })

// 2026-09-15, reported from the phone: a reply read as if it came after work it
// had actually come before. The renderer sorted a turn's blocks into two
// buckets — all prose, then all tools — so the words lost their place relative
// to the work. The transcript's order is the record of what happened, and the
// terminal shows it that way; the phone has to as well.
describe('where a turn\'s words sit relative to its work', () => {
  it('keeps each run of words with the work that followed it', () => {
    const segments = splitTurnIntoSegments([
      text('Answering your question'),
      call('Bash'),
      result('ok'),
      text('Both reviews are running'),
      call('Read'),
      result('ok')
    ])
    expect(segments.map((segment) => [segment.kind, segment.blocks.length])).toEqual([
      ['prose', 1],
      ['tools', 2],
      ['prose', 1],
      ['tools', 2]
    ])
  })

  it('states words that come after the work after it, not before', () => {
    const segments = splitTurnIntoSegments([call('Bash'), result('ok'), text('Done.')])
    expect(segments.map((segment) => segment.kind)).toEqual(['tools', 'prose'])
  })

  it('leaves a turn that is only words as one run', () => {
    expect(splitTurnIntoSegments([text('a'), text('b')]).map((s) => s.kind)).toEqual(['prose'])
  })

  it('leaves a turn that is only work as one run', () => {
    expect(splitTurnIntoSegments([call('Bash'), result('ok')]).map((s) => s.kind)).toEqual(['tools'])
  })

  it('has nothing to say about an empty turn', () => {
    expect(splitTurnIntoSegments([])).toEqual([])
  })

  // The blocks must survive exactly, in order: this only groups them.
  it('never drops or reorders a block', () => {
    const blocks = [text('a'), call('Bash'), text('b'), result('ok'), call('Read')]
    expect(splitTurnIntoSegments(blocks).flatMap((segment) => segment.blocks)).toEqual(blocks)
  })
})
