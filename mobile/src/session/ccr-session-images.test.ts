import { describe, expect, it } from 'vitest'
import type { CcrEvent } from './ccr-session-api'
import { base64ByteLength, ccrImageDataUri, extractCcrImages } from './ccr-session-images'
import { matchCcrSession } from './ccr-session-match'
import { JPEG_HEAD, PNG_1PX, WEBP_1PX, imageBlock, pasteEvent, readResultEvent, systemEvent } from './fixtures/ccr-session-api-2026-10-14'

const MAX = 8 * 1024 * 1024
const asEvent = (raw: Record<string, unknown>): CcrEvent => ({ eventId: String(raw.event_id), payload: raw.payload as Record<string, unknown> })
const wanted = (toolUseIds: string[] = [], userMessageIds: string[] = []) => ({ toolUseIds: new Set(toolUseIds), userMessageIds: new Set(userMessageIds) })

describe('an image block as a data URI', () => {
  it.each([
    ['image/png', PNG_1PX],
    ['image/jpeg', JPEG_HEAD],
    ['image/webp', WEBP_1PX],
    ['image/gif', 'R0lGODlhAQABAAAAACw=']
  ])('takes %s', (mediaType, data) => {
    expect(ccrImageDataUri(imageBlock(data, mediaType), MAX)).toEqual({ uri: `data:${mediaType};base64,${data}` })
  })

  it('lower-cases the media type it writes', () => {
    expect(ccrImageDataUri(imageBlock(PNG_1PX, 'IMAGE/PNG'), MAX)).toEqual({ uri: `data:image/png;base64,${PNG_1PX}` })
  })

  it('refuses a type the phone does not draw', () => {
    expect(ccrImageDataUri(imageBlock(PNG_1PX, 'image/svg+xml'), MAX)).toEqual({ skip: 'unsupported-type' })
  })

  it('skips a picture over the cap, measured without decoding it', () => {
    expect(base64ByteLength(PNG_1PX)).toBe(70)
    expect(ccrImageDataUri(imageBlock(PNG_1PX), 69)).toEqual({ skip: 'oversize' })
    expect(ccrImageDataUri(imageBlock(PNG_1PX), 70)).toEqual({ uri: `data:image/png;base64,${PNG_1PX}` })
  })

  it.each([
    ['characters base64 does not have', 'iVBO*w0K'],
    ['a length that is not a whole quantum', 'iVBORw0'],
    ['nothing', '']
  ])('refuses base64 with %s', (_name, data) => {
    expect(ccrImageDataUri(imageBlock(data), MAX)).toEqual({ skip: 'malformed' })
  })

  it.each([
    ['a URL source', { type: 'image', source: { type: 'url', url: 'https://x/y.png' } }],
    ['no source', { type: 'image' }],
    ['no media type', { type: 'image', source: { type: 'base64', data: PNG_1PX } }],
    ['not an object', 'image']
  ])('refuses %s', (_name, block) => {
    expect(ccrImageDataUri(block, MAX)).toEqual({ skip: 'malformed' })
  })
})

describe('the pictures in a session’s events', () => {
  it('finds a Read’s picture in its tool result, as the transcript holds it', () => {
    const out = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_A', [imageBlock(PNG_1PX)]))], wanted(['toolu_A']), MAX)
    expect(out.byToolUseId.get('toolu_A')).toBe(`data:image/png;base64,${PNG_1PX}`)
    expect(out.skipped.size).toBe(0)
  })

  it('takes the first picture when one result holds several', () => {
    const out = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_A', [imageBlock(JPEG_HEAD, 'image/jpeg'), imageBlock(PNG_1PX)]))], wanted(['toolu_A']), MAX)
    expect(out.byToolUseId.get('toolu_A')).toBe(`data:image/jpeg;base64,${JPEG_HEAD}`)
  })

  it('takes the next picture when the first is unusable', () => {
    const out = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_A', [imageBlock('bad*'), imageBlock(PNG_1PX)]))], wanted(['toolu_A']), MAX)
    expect(out.byToolUseId.get('toolu_A')).toBe(`data:image/png;base64,${PNG_1PX}`)
  })

  it('looks into nested content lists', () => {
    const nested = [{ type: 'text', text: 'here' }, { type: 'tool_result', content: [[imageBlock(WEBP_1PX, 'image/webp')]] }]
    const out = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_A', nested))], wanted(['toolu_A']), MAX)
    expect(out.byToolUseId.get('toolu_A')).toBe(`data:image/webp;base64,${WEBP_1PX}`)
  })

  it.each([
    ['a string result', 'File read'],
    ['a text-only result', [{ type: 'text', text: 'ok' }]],
    ['an empty result', []]
  ])('says there was no picture in %s', (_name, content) => {
    const out = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_A', content))], wanted(['toolu_A']), MAX)
    expect(out.byToolUseId.size).toBe(0)
    expect(out.skipped.get('toolu_A')).toBe('no-image-in-event')
  })

  it('says why when the only picture is over the cap', () => {
    const out = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_A', [imageBlock(PNG_1PX)]))], wanted(['toolu_A']), 10)
    expect(out.skipped.get('toolu_A')).toBe('oversize')
  })

  it('leaves a tool result nobody asked for alone', () => {
    const out = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_B', [imageBlock(PNG_1PX)]))], wanted(['toolu_A']), MAX)
    expect(out.byToolUseId.size).toBe(0)
    expect(out.skipped.size).toBe(0)
  })

  it('finds a user’s pasted pictures by the message uuid, in order', () => {
    const out = extractCcrImages(
      [asEvent(pasteEvent('p1', [imageBlock(JPEG_HEAD, 'image/jpeg'), imageBlock(PNG_1PX)]))],
      wanted([], ['p1']),
      MAX
    )
    expect(out.byUserMessageId.get('p1')).toEqual([`data:image/jpeg;base64,${JPEG_HEAD}`, `data:image/png;base64,${PNG_1PX}`])
  })

  it('keeps an unusable pasted picture’s slot empty so the next keeps its own', () => {
    const out = extractCcrImages([asEvent(pasteEvent('p1', [imageBlock(PNG_1PX), imageBlock(PNG_1PX)]))], wanted([], ['p1']), 10)
    expect(out.byUserMessageId.has('p1')).toBe(false)
    expect(out.skipped.get('p1')).toBe('oversize')
    const mixed = extractCcrImages([asEvent(pasteEvent('p2', [imageBlock('bad*'), imageBlock(PNG_1PX)]))], wanted([], ['p2']), MAX)
    expect(mixed.byUserMessageId.get('p2')).toEqual(['', `data:image/png;base64,${PNG_1PX}`])
  })

  it('says a wanted prompt held no picture', () => {
    const out = extractCcrImages([asEvent(pasteEvent('p1', [], 'just words'))], wanted([], ['p1']), MAX)
    expect(out.skipped.get('p1')).toBe('no-image-in-event')
  })

  it('gathers every event’s uuid, system events included, and ignores non-user content', () => {
    const out = extractCcrImages([asEvent(systemEvent('s1')), asEvent(readResultEvent('u1', 'toolu_A', [imageBlock(PNG_1PX)]))], wanted(), MAX)
    expect([...out.uuids]).toEqual(['s1', 'u1'])
  })

  it('keeps the first picture found for an id', () => {
    const into = extractCcrImages([asEvent(readResultEvent('u1', 'toolu_A', [imageBlock(PNG_1PX)]))], wanted(['toolu_A']), MAX)
    extractCcrImages([asEvent(readResultEvent('u2', 'toolu_A', [imageBlock(JPEG_HEAD, 'image/jpeg')]))], wanted(['toolu_A']), MAX, into)
    expect(into.byToolUseId.get('toolu_A')).toBe(`data:image/png;base64,${PNG_1PX}`)
  })

  it('reads nothing from no events', () => {
    const out = extractCcrImages([], wanted(['toolu_A'], ['p1']), MAX)
    expect(out.byToolUseId.size + out.byUserMessageId.size + out.skipped.size + out.uuids.size).toBe(0)
  })
})

describe('which session a tab is', () => {
  const tab = new Set(['m1', 'm2', 'm3'])
  it('is the one session that shares messages with it', () => {
    expect(matchCcrSession(tab, [{ sessionId: 'A', uuids: new Set(['m1', 'm2', 'm3']) }, { sessionId: 'B', uuids: new Set(['x']) }])).toEqual({ kind: 'matched', sessionId: 'A', overlap: 3 })
  })

  it('needs only one shared message (a partial overlap)', () => {
    expect(matchCcrSession(tab, [{ sessionId: 'A', uuids: new Set(['m3', 'later']) }])).toEqual({ kind: 'matched', sessionId: 'A', overlap: 1 })
  })

  it('is refused when two sessions share messages with it', () => {
    expect(matchCcrSession(tab, [{ sessionId: 'A', uuids: new Set(['m1']) }, { sessionId: 'B', uuids: new Set(['m2', 'm3']) }])).toEqual({ kind: 'ambiguous', sessionIds: ['A', 'B'] })
  })

  it('is none when nothing is shared', () => {
    expect(matchCcrSession(tab, [{ sessionId: 'A', uuids: new Set(['x']) }])).toEqual({ kind: 'none', candidates: 1 })
  })

  it('is none with no candidates, or a tab with no messages', () => {
    expect(matchCcrSession(tab, [])).toEqual({ kind: 'none', candidates: 0 })
    expect(matchCcrSession(new Set(), [{ sessionId: 'A', uuids: new Set(['m1']) }])).toEqual({ kind: 'none', candidates: 1 })
  })
})
