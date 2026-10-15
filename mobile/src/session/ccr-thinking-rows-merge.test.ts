import { describe, expect, it } from 'vitest'
import { parseCcrEvent, type CcrEvent } from './ccr-session-api'
import { decodeCcrEvents, slimCcrEvent } from './ccr-transcript-decode'
import { SESSION_A, event } from './fixtures/ccr-session-api-2026-10-14'

// Claude Code sends each thinking block as an assistant event of its own, so a
// turn that thought three times drew three "Thought process" rows in a row. The
// Claude app (1.261013.20, reducer `t5v`) folds a thinking-only assistant item
// into the thinking-only item before it, the texts joined by a blank line: one row.

const keep = (key: string) => `file:///cache/${encodeURIComponent(key)}`
const asEvent = (raw: Record<string, unknown>): CcrEvent => slimCcrEvent(parseCcrEvent(raw)!, keep)
const rows = (...raws: Record<string, unknown>[]) => decodeCcrEvents(raws.map(asEvent), new WeakMap())

const assistant = (uuid: string, content: unknown[]) =>
  event({ type: 'assistant', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'assistant', model: 'claude-opus-5-5', content } })
const thought = (uuid: string, text: string) => assistant(uuid, [{ type: 'thinking', thinking: text, signature: 's' }])
const said = (uuid: string, text: string) => assistant(uuid, [{ type: 'text', text }])

describe('thinking in a row is one "Thought process" row, as in the Claude app', () => {
  it('joins thoughts that follow each other into one row, a blank line apart', () => {
    const decoded = rows(thought('t1', 'First idea.'), thought('t2', 'Second idea.'), thought('t3', 'Third.'))
    expect(decoded.map((row) => [row.id, row.role])).toEqual([['t1:thinking', 'reasoning']])
    expect(decoded[0]!.blocks).toEqual([{ type: 'text', text: 'First idea.\n\nSecond idea.\n\nThird.' }])
  })

  it('keeps thoughts apart when words come between them', () => {
    const decoded = rows(thought('t1', 'One.'), said('a1', 'Looking.'), thought('t2', 'Two.'))
    expect(decoded.map((row) => row.role)).toEqual(['reasoning', 'assistant', 'reasoning'])
  })

  it('leaves a single thought as it was', () => {
    expect(rows(thought('t1', 'Only.')).map((row) => row.blocks)).toEqual([[{ type: 'text', text: 'Only.' }]])
  })
})
