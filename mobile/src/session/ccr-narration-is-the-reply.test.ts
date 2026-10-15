import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { parseCcrEvent, type CcrEvent } from './ccr-session-api'
import { decodeCcrEvents, slimCcrEvent } from './ccr-transcript-decode'
import {
  NARRATION_WORDS,
  agentCall,
  ghRunListCall,
  ghRunListResult,
  ghRunViewCall,
  narration,
  prompt,
  readCall,
  readResult,
  signatureOnlyThought,
  thoughtBetweenCommands
} from './fixtures/ccr-narration-thinking-2.1.296'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'

// Reported 2026-10-15 on an Opus 5.5 session: Code UI drew "Thought process" between "Ran 6
// commands (1 failed)" and "Running agent", where the Claude app drew the agent's words.
//
// The app (1.261013.20) decides per thinking block (u5v.j, decompiled single-class, lines 534-553):
//  - a block whose index is in the event's `narration_block_indexes` (n8u.w) becomes plain reply
//    text (`tpy`, its words trimmed by u5a.c);
//  - any other thinking becomes a thought (`lyy`), and `redacted_thinking` an empty one;
//  - a thought whose words are blank draws nothing (gy30.java:31962, `ssx.y0` = all whitespace),
//    and a message with nothing else visible draws no row (gy30.java:372).
// Opus 5.5's own thinking is always signature-only, so on that model the only thinking with words
// IS narration: the row the user saw was a narration the app draws as the reply.

const keep = (key: string) => `file:///cache/${encodeURIComponent(key)}`
const asEvent = (raw: Record<string, unknown>): CcrEvent => slimCcrEvent(parseCcrEvent(raw)!, keep)
const decode = (...raws: Record<string, unknown>[]) => decodeCcrEvents(raws.map(asEvent), new WeakMap())
const chat = (...raws: Record<string, unknown>[]) => foldMobileNativeChatMessages(decode(...raws))

/** Each row as [role, what it holds]: a call by its tool name, words by their text. */
function shape(rows: readonly NativeChatMessage[]): [string, string[]][] {
  return rows.map((row) => [
    row.role,
    row.blocks.flatMap((block) => (block.type === 'tool-call' ? [`call:${block.name}`] : block.type === 'text' ? [block.text] : []))
  ])
}

describe('a narration between tool calls is the agent’s words, as the Claude app draws it', () => {
  it('draws no Thought process row between the run and the Running agent row', () => {
    const rows = chat(readCall(), readResult(), signatureOnlyThought(), narration(), agentCall())
    expect(rows.some((row) => row.role === 'reasoning')).toBe(false)
    // The run, then the words with the Agent call after them: the app's "Ran …", text, "Running agent".
    expect(shape(rows)).toEqual([
      ['assistant', ['call:Read']],
      ['assistant', [NARRATION_WORDS, 'call:Agent']]
    ])
  })

  it('a narration the turn says nothing else in is the reply on its own', () => {
    expect(shape(decode(prompt('p1', 'Build the recording row'), narration()))).toEqual([
      ['user', ['Build the recording row']],
      ['assistant', [NARRATION_WORDS]]
    ])
  })

  it('reads the index the frame names, not the block’s place in the message', () => {
    // A frame whose narration is its second block: only that block is words.
    const both = narration([1])
    const message = both.payload as { message: { content: unknown[] } }
    message.message.content.unshift({ type: 'thinking', thinking: '', signature: 'CAQS0xQKEAgSGAI4AUIIdGhpbmtpbmcSDIoo8ub18WFg/JZ+eBoMNT3nBTtMklQm4Mf+' })
    expect(shape(decode(both))).toEqual([['assistant', [NARRATION_WORDS]]])
  })

  it('keeps a thought the frame does not name as narration a Thought process row (a CLI from before the field)', () => {
    expect(shape(decode(narration(null)))).toEqual([['reasoning', [NARRATION_WORDS]]])
  })

  it('a list that names no block of this frame leaves its thought a thought', () => {
    for (const listed of ['0', ['0'], [-1], [1], [], {}, [0.5]]) {
      expect(shape(decode(narration(listed))), JSON.stringify(listed)).toEqual([['reasoning', [NARRATION_WORDS]]])
    }
  })

  it('a named block with no words, or one that is not thinking, still draws nothing', () => {
    const signatureOnly = narration([0])
    const blocks = (signatureOnly.payload as { message: { content: Record<string, unknown>[] } }).message.content
    blocks[0] = { ...blocks[0], thinking: '\n\n' }
    expect(decode(signatureOnly)).toEqual([])
    const redacted = narration([0])
    ;(redacted.payload as { message: { content: unknown[] } }).message.content[0] = { type: 'redacted_thinking', data: 'x' }
    expect(decode(redacted)).toEqual([])
  })
})

describe('a thought with no words takes no room, so the work around it reads as one run', () => {
  it('a turn whose only block is a signature-only thought draws nothing after the prompt', () => {
    expect(shape(decode(prompt('p1', 'Check CI'), signatureOnlyThought()))).toEqual([['user', ['Check CI']]])
  })

  it('a signature-only thought between two commands leaves them in one run', () => {
    const rows = chat(ghRunListCall(), ghRunListResult(), thoughtBetweenCommands(), ghRunViewCall())
    expect(shape(rows)).toEqual([['assistant', ['call:Bash', 'call:Bash']]])
  })
})
