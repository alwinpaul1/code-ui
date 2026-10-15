import { describe, expect, it } from 'vitest'
import { createSseParser, readCcrEventStream, readCcrStreamFrame, type CcrStreamFetch, type CcrStreamFrame } from './ccr-event-stream'
import { CcrApiError, getCcrSession, listCcrSessionEvents } from './ccr-session-api'
import { ORG_UUID, SESSION_A, TOKEN, event, eventsReply, fakeFetch, reply, sessionRow } from './fixtures/ccr-session-api-2026-10-14'
import { sseBody, sseFrame, streamFetch } from './fixtures/ccr-session-stream'

const auth = { token: TOKEN, organizationUuid: ORG_UUID }

describe('the session stream frames, as Claude Code 2.1.300 reads them', () => {
  it('gives back whole frames whatever the chunking, CRLF and comments included', () => {
    const parser = createSseParser()
    const text = ': keep-alive\r\nevent: client_event\r\nid: 7\r\ndata: {"a":\r\ndata: 1}\r\n\r\nevent: catch_up_truncated\ndata: {}\n\n'
    const frames = [...text].flatMap((char) => parser.push(char))
    expect(frames).toEqual([
      { event: 'client_event', id: '7', data: '{"a":\n1}' },
      { event: 'catch_up_truncated', id: '7', data: '{}' }
    ])
    expect(parser.flush()).toEqual([])
  })

  it('drops a frame with no event name or no data, as Claude Code does', () => {
    const parser = createSseParser()
    expect(parser.push('data: {}\n\nevent: client_event\n\n')).toEqual([])
  })

  it('a client_event carries the durable event with its sequence number, the SSE id when the data has none', () => {
    const raw = event({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } })
    const frame = readCcrStreamFrame({ event: 'client_event', id: String(raw.sequence_num), data: JSON.stringify(raw) })
    expect(frame).toMatchObject({ kind: 'event', event: { eventId: raw.event_id, sequenceNum: raw.sequence_num, source: 'worker', payload: { uuid: 'u1' } } })
    const { sequence_num: _dropped, ...noSequence } = raw
    expect(readCcrStreamFrame({ event: 'client_event', id: '42', data: JSON.stringify(noSequence) })).toMatchObject({ kind: 'event', event: { sequenceNum: 42 } })
  })

  it('skips, and says why, a frame it cannot read rather than guessing', () => {
    expect(readCcrStreamFrame({ event: 'client_event', id: null, data: '{not json' })).toEqual({ kind: 'skipped', event: 'client_event', reason: 'malformed' })
    expect(readCcrStreamFrame({ event: 'client_event', id: null, data: JSON.stringify({ payload: { uuid: 'x' } }) })).toEqual({ kind: 'skipped', event: 'client_event', reason: 'no-payload-type' })
    expect(readCcrStreamFrame({ event: 'mystery', id: null, data: '{}' })).toEqual({ kind: 'skipped', event: 'mystery', reason: 'unknown-event' })
  })

  it('reads truncation, connection status and ephemeral output, and ignores delivery updates', () => {
    expect(readCcrStreamFrame({ event: 'catch_up_truncated', id: null, data: '' })).toEqual({ kind: 'truncated' })
    expect(readCcrStreamFrame({ event: 'session_update', id: null, data: '{"connection_status":"disconnected"}' })).toEqual({ kind: 'connection', status: 'disconnected' })
    expect(readCcrStreamFrame({ event: 'delivery_update', id: null, data: '{"status":"PROCESSED"}' })).toEqual({ kind: 'ignored', event: 'delivery_update' })
    expect(readCcrStreamFrame({ event: 'ephemeral_event', id: null, data: JSON.stringify({ event_type: 'stream_event', payload: { type: 'stream_event', event: { type: 'content_block_delta' } } }) })).toMatchObject({
      kind: 'ephemeral',
      eventType: 'stream_event'
    })
  })
})

describe('opening the stream', () => {
  it('asks from the last sequence number it holds, with Last-Event-ID, as Claude Code does', async () => {
    const { fetch, requests } = streamFetch(() => ({ status: 200, chunks: [] }))
    await readCcrEventStream({ fetch, auth, sessionId: SESSION_A, fromSequenceNum: 1016, signal: new AbortController().signal, onFrame: () => undefined })
    expect(requests[0]!.url).toBe(`https://api.anthropic.com/v1/code/sessions/${SESSION_A}/events/stream?from_sequence_num=1016`)
    expect(requests[0]!.headers).toMatchObject({ Accept: 'text/event-stream', 'Last-Event-ID': '1016', 'X-Organization-Uuid': ORG_UUID, Authorization: `Bearer ${TOKEN}` })
  })

  it('a first open (nothing held) sends no from_sequence_num and no Last-Event-ID', async () => {
    const { fetch, requests } = streamFetch(() => ({ status: 200, chunks: [] }))
    await readCcrEventStream({ fetch, auth, sessionId: SESSION_A, fromSequenceNum: 0, signal: new AbortController().signal, onFrame: () => undefined })
    expect(requests[0]!.url).toBe(`https://api.anthropic.com/v1/code/sessions/${SESSION_A}/events/stream`)
    expect(requests[0]!.headers['Last-Event-ID']).toBeUndefined()
  })

  it('hands over every frame across byte chunks split mid-character, then says the server ended it', async () => {
    const first = event({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'Grüße ✓' }] } })
    const body = sseBody([sseFrame('client_event', first), sseFrame('session_update', { connection_status: 'connected' })])
    const { fetch } = streamFetch(() => ({ status: 200, chunks: body, chunkSize: 5 }))
    const frames: CcrStreamFrame[] = []
    const end = await readCcrEventStream({ fetch, auth, sessionId: SESSION_A, fromSequenceNum: 0, signal: new AbortController().signal, onFrame: (frame) => frames.push(frame) })
    expect(end).toBe('ended')
    expect(frames.map((frame) => frame.kind)).toEqual(['event', 'connection'])
    expect(frames[0]).toMatchObject({ event: { payload: { message: { content: [{ text: 'Grüße ✓' }] } } } })
  })

  it('a refused connect is a typed error naming the stage, never the body', async () => {
    for (const [status, reason] of [
      [401, 'unauthorized'],
      [404, 'not-found'],
      [500, 'http']
    ] as const) {
      const { fetch } = streamFetch(() => ({ status, chunks: [], text: 'secret body' }))
      const error = await readCcrEventStream({ fetch, auth, sessionId: SESSION_A, fromSequenceNum: 0, signal: new AbortController().signal, onFrame: () => undefined }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(CcrApiError)
      expect(error).toMatchObject({ stage: 'stream', reason, status })
      expect(String((error as Error).message)).not.toContain('secret')
    }
  })

  it('a 403 that names device trust is an untrusted-device refusal', async () => {
    const { fetch } = streamFetch(() => ({ status: 403, chunks: [], text: '{"error":{"type":"untrusted_device"}}' }))
    await expect(readCcrEventStream({ fetch, auth, sessionId: SESSION_A, fromSequenceNum: 0, signal: new AbortController().signal, onFrame: () => undefined })).rejects.toMatchObject({ reason: 'untrusted-device' })
  })

  it('an abort ends the read quietly', async () => {
    const controller = new AbortController()
    const fetch: CcrStreamFetch = async () => {
      controller.abort()
      throw new Error('aborted')
    }
    await expect(readCcrEventStream({ fetch, auth, sessionId: SESSION_A, fromSequenceNum: 0, signal: controller.signal, onFrame: () => undefined })).resolves.toBe('aborted')
  })
})

describe('history pages and the session row', () => {
  it('a history page keeps each event’s sequence number, source and time, a string sequence included', async () => {
    const raw = { ...event({ type: 'user', uuid: 'u1' }), sequence_num: '16', source: 'client' }
    const { fetch } = fakeFetch([() => reply(200, eventsReply([raw]))])
    const page = await listCcrSessionEvents(fetch, auth, SESSION_A, { cursor: null, limit: 100 })
    expect(page.events[0]).toMatchObject({ sequenceNum: 16, source: 'client', createdAt: Date.parse('2026-10-14T16:20:00Z') })
  })

  it('reads one session’s row and its connection status', async () => {
    const { fetch, requests } = fakeFetch([() => reply(200, sessionRow(SESSION_A, { connection_status: 'disconnected' }))])
    await expect(getCcrSession(fetch, auth, SESSION_A)).resolves.toMatchObject({ id: SESSION_A, connectionStatus: 'disconnected' })
    expect(requests[0]!.url).toBe(`https://api.anthropic.com/v1/code/sessions/${SESSION_A}`)
  })

  it('a session that is gone is not-found at stage session', async () => {
    const { fetch } = fakeFetch([])
    await expect(getCcrSession(fetch, auth, SESSION_A)).rejects.toMatchObject({ stage: 'session', reason: 'not-found' })
  })
})
