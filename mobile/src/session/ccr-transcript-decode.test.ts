import { describe, expect, it } from 'vitest'
import { NATIVE_CHAT_INTERRUPTED_STATUS_TEXT } from '../../../src/shared/native-chat-types'
import { parseCcrEvent, type CcrEvent } from './ccr-session-api'
import { ccrEventDrawsRow, ccrKeptImages, decodeCcrEvent, decodeCcrEvents, slimCcrEvent } from './ccr-transcript-decode'
import { PNG_1PX, SESSION_A, assistantEvent, event, imageBlock, pasteEvent, readResultEvent, systemEvent } from './fixtures/ccr-session-api-2026-10-14'

// Payload shapes: fixtures/ccr-session-api-2026-10-14.ts (observed live) and the SDK messages
// Claude Code 2.1.300 publishes; what the app draws for each: scratchpad/plan/claude-transcript-inventory.md.

const keep = (key: string) => `file:///cache/${encodeURIComponent(key)}`
const asEvent = (raw: Record<string, unknown>): CcrEvent => slimCcrEvent(parseCcrEvent(raw)!, keep)

function rows(...raws: Record<string, unknown>[]) {
  return decodeCcrEvents(raws.map(asEvent), new WeakMap())
}

const user = (uuid: string, content: unknown, extra: Record<string, unknown> = {}) =>
  event({ type: 'user', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'user', content }, ...extra })
const assistant = (uuid: string, content: unknown[], extra: Record<string, unknown> = {}) =>
  event({ type: 'assistant', uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role: 'assistant', model: 'claude-opus-5-5', content }, ...extra })

describe('a matched Claude tab draws Anthropic’s events as the Claude app does', () => {
  it('a prompt is the user’s row under its own uuid, timed by the event', () => {
    const raw = user('u1', 'Fix the build')
    expect(rows(raw)).toEqual([{ id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'Fix the build' }], timestamp: Date.parse('2026-10-14T16:20:00Z'), source: 'transcript' }])
  })

  it('a tool call and its result pair by the call id, so a result never lands on the wrong call', () => {
    const decoded = rows(assistantEvent('a1', 'toolu_1', '/tmp/shot.png'), readResultEvent('u2', 'toolu_1', 'read ok'))
    expect(decoded.map((row) => [row.role, row.blocks[0]])).toEqual([
      ['assistant', { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/shot.png' }, callId: 'toolu_1' }],
      ['tool', { type: 'tool-result', output: 'read ok', callId: 'toolu_1' }]
    ])
  })

  it('a Read’s picture goes to a file under its call id, for the Read row to draw', () => {
    const slim = asEvent(readResultEvent('u2', 'toolu_9', [imageBlock(PNG_1PX)]))
    expect(ccrKeptImages(slim).tool.get('toolu_9')).toBe(keep('ccr\0tool\0toolu_9'))
    expect(JSON.stringify(slim)).not.toContain(PNG_1PX)
  })

  it('pictures a prompt names with [Image #N] are drawn where the markers are, not twice', () => {
    const slim = asEvent(pasteEvent('u3', [imageBlock(PNG_1PX), imageBlock(PNG_1PX)]))
    expect(ccrKeptImages(slim).user.get('u3')).toEqual([keep('ccr\0user\0u3\0' + '0'), keep('ccr\0user\0u3\0' + '1')])
    expect(decodeCcrEvent(slim)[0]!.blocks).toEqual([{ type: 'text', text: '[Image #1] [Image #2] Fix this issue' }])
  })

  it('pictures sent with no marker (from the Claude app or the phone) draw as tiles in the bubble', () => {
    const decoded = rows(user('u4', [imageBlock(PNG_1PX), { type: 'text', text: 'What colour is this?' }]))
    expect(decoded[0]!.blocks).toEqual([
      { type: 'text', text: 'What colour is this?' },
      { type: 'image-ref', url: keep('ccr\0user\0u4\0' + '0') }
    ])
  })

  it('a picture over the 8 MiB cap is not kept, and its marker stays a chip', () => {
    const huge = 'A'.repeat(Math.ceil(((8 * 1024 * 1024 + 4) / 3) * 4 / 4) * 4)
    const slim = asEvent(pasteEvent('u5', [imageBlock(huge)], '[Image #1] big'))
    expect(ccrKeptImages(slim).user.get('u5')).toEqual([''])
    expect(JSON.stringify(slim)).not.toContain(huge.slice(0, 64))
  })

  it('thinking is its own Thought process row, before the reply it led to', () => {
    const decoded = rows(assistant('a2', [{ type: 'thinking', thinking: 'Check the lockfile first.', signature: 'sig' }, { type: 'text', text: 'Done.' }]))
    expect(decoded.map((row) => [row.id, row.role])).toEqual([
      ['a2:thinking', 'reasoning'],
      ['a2', 'assistant']
    ])
  })

  it('thinking with no words (redacted, or a signature only) draws nothing', () => {
    expect(rows(assistant('a3', [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'redacted_thinking', data: 'x' }]))).toEqual([])
  })

  it('an interrupt is the quiet status line, not a user bubble', () => {
    expect(rows(user('u6', [{ type: 'text', text: '[Request interrupted by user]' }]))).toEqual([
      expect.objectContaining({ id: 'u6', role: 'system', blocks: [{ type: 'text', text: NATIVE_CHAT_INTERRUPTED_STATUS_TEXT }] })
    ])
  })

  it('an injected turn (meta, synthetic, compaction summary) shows only its tool results', () => {
    expect(rows(user('u7', 'Caveat: local command', { isMeta: true }))).toEqual([])
    expect(rows(user('u8', 'summary of the conversation', { isCompactSummary: true }))).toEqual([])
    const meta = rows(user('u9', [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }], { isMeta: true }))
    expect(meta.map((row) => row.role)).toEqual(['tool'])
  })

  it('a record kept for the transcript only, and a replayed peer message, are hidden as the app hides them', () => {
    expect(rows(user('u10', 'x', { isVisibleInTranscriptOnly: true }))).toEqual([])
    expect(rows(user('u11', 'x', { isReplay: true, origin: { kind: 'peer' } }))).toEqual([])
    expect(rows(user('u12', 'typed again', { isReplay: true, origin: { kind: 'human' } }))).toHaveLength(1)
  })

  it('a subagent’s own messages stay out of the conversation, as in the app’s main list', () => {
    expect(rows(user('u13', 'sub prompt', { parent_tool_use_id: 'toolu_agent' }), assistant('a4', [{ type: 'text', text: 'sub reply' }], { parent_tool_use_id: 'toolu_agent' }))).toEqual([])
  })

  it('a compaction is the divider; a /clear is the Context cleared divider', () => {
    const compact = rows(event({ type: 'system', subtype: 'compact_boundary', uuid: 's1', session_id: SESSION_A, compact_metadata: { trigger: 'auto', pre_tokens: 160000 } }))
    expect(compact).toEqual([expect.objectContaining({ id: 's1', role: 'system', blocks: [expect.objectContaining({ presentation: 'compaction' })] })])
    const reset = rows(event({ type: 'conversation_reset', uuid: 'r1', trigger: 'clear' }))
    expect(reset[0]!.blocks[0]).toMatchObject({ text: 'Context cleared', contextClear: { operationId: 'r1' } })
  })

  it('a compaction divider carries how many tokens it saved, from the event’s own counts', () => {
    // compact_boundary as Claude Code 2.1.296 writes it on this machine (preTokens 167968,
    // postTokens 14060 in the transcript record), in the stream form the app reads
    // (`CompactionDivider.pre_tokens` / `.post_tokens`, k23.java:1245).
    const text = (compactMetadata: unknown): unknown =>
      rows(event({ type: 'system', subtype: 'compact_boundary', uuid: 's1', session_id: SESSION_A, compact_metadata: compactMetadata }))[0]!.blocks[0]
    expect(text({ trigger: 'auto', pre_tokens: 167968, post_tokens: 14060 })).toMatchObject({ text: 'Compacted conversation · saved 153.9k tokens', presentation: 'compaction' })
    expect(text({ trigger: 'manual', pre_tokens: 1_000_000, post_tokens: 53_200 })).toMatchObject({ text: 'Compacted conversation · saved 946.8k tokens' })
  })

  it('a compaction divider with no usable counts says only "Compacted conversation"', () => {
    const text = (compactMetadata: unknown): unknown =>
      rows(event({ type: 'system', subtype: 'compact_boundary', uuid: 's1', session_id: SESSION_A, compact_metadata: compactMetadata }))[0]!.blocks[0]
    expect(text(undefined)).toMatchObject({ text: 'Compacted conversation' })
    expect(text({ trigger: 'auto', pre_tokens: 160000 })).toMatchObject({ text: 'Compacted conversation' })
    expect(text({ trigger: 'auto', pre_tokens: 'many', post_tokens: null })).toMatchObject({ text: 'Compacted conversation' })
  })

  it('status, init, results, rate limits and control traffic draw no row', () => {
    expect(
      rows(
        systemEvent('s2'),
        event({ type: 'system', subtype: 'init', uuid: 's3', model: 'claude-opus-4-7' }),
        event({ type: 'system', subtype: 'background_tasks_changed', uuid: 's4', tasks: [] }),
        event({ type: 'system', subtype: 'model_refusal_fallback', uuid: 's5' }),
        event({ type: 'result', subtype: 'success', uuid: 'r2', is_error: false }),
        event({ type: 'rate_limit_event', uuid: 'l1' }),
        event({ type: 'control_request', uuid: 'c1', request_id: 'q1', request: { subtype: 'end_session' } })
      )
    ).toEqual([])
  })

  it('an event with no uuid and no event id is refused, not drawn under a made-up id', () => {
    expect(decodeCcrEvent({ eventId: null, payload: { type: 'user', message: { role: 'user', content: 'x' } } })).toEqual([])
  })
})

// Review 2026-10-15: every streamed event re-decoded every held event (persist filters by
// ccrEventDrawsRow, which decoded afresh each call).
describe('deciding whether an event draws a row', () => {
  it('reuses the decode already made for the event instead of decoding it again', () => {
    const held = asEvent(user('u-cache', 'hello'))
    expect(ccrEventDrawsRow(held)).toBe(true)
    // What a fresh decode would now say differs; the decision made once stands for this event.
    ;(held.payload as Record<string, unknown>).type = 'system'
    expect(ccrEventDrawsRow(held)).toBe(true)
    expect(decodeCcrEvents([held]).map((row) => row.id)).toEqual(['u-cache'])
  })

  it('an undrawn event is remembered as undrawn', () => {
    const status = asEvent(systemEvent('s-cache'))
    expect(ccrEventDrawsRow(status)).toBe(false)
    expect(decodeCcrEvents([status])).toEqual([])
  })
})
