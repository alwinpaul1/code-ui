import { CCR_API_BASE_URL, CcrApiError, ccrSessionHeaders, isCcrSessionId, parseCcrEvent, type CcrEvent } from './ccr-session-api'

/**
 * The live half of a Claude Code session on Anthropic: the SSE stream
 * `GET v1/code/sessions/{id}/events/stream`.
 *
 * Shape, from Claude Code 2.1.300's own client of this URL
 * (`SessionsV2Client`, `connect`/`readStream`/`handleFrame`, byte offsets
 * 224222444-224232000 of the binary):
 *  - the request: query `from_sequence_num=N` and header `Last-Event-ID: N`
 *    only when N > 0, `Accept: text/event-stream`, the session headers;
 *  - frames are standard SSE, dispatched on a blank line, and a frame is used
 *    only when it has both an `event:` name and `data:`; `id:` is the
 *    sequence number, the data's own `sequence_num` the fallback;
 *  - `client_event`: data is the durable event (`{event_id, sequence_num,
 *    event_type, source, payload, created_at}`), the same object the history
 *    pages hold; a payload with no `type` is dropped;
 *  - `ephemeral_event`: data `{event_type, payload}`; the payload is a
 *    `stream_event` (partial output), a live-only `control_response`, or a
 *    message; never stored;
 *  - `catch_up_truncated`: the catch-up after `from_sequence_num` was cut,
 *    so the gap must be paged in from history;
 *  - `session_update`: data `{connection_status}`;
 *  - `delivery_update`, `security_update`: read, nothing done with them
 *    here (Claude Code ignores `delivery_update` too).
 *  The Claude app reads the same frame names (lvu.java:37-79) and the same
 *  truncation (eyw.java:18-19).
 *
 * The bytes on the wire were not captured yet: the frames in the tests are
 * built to this description, and `scratchpad/probe/p6-stream.cjs` is the
 * capture that pins them.
 */

export type SseFrame = { event: string; id: string | null; data: string }

/** A standard SSE parser: fed text in any chunking, gives back whole frames. */
export function createSseParser(): { push: (text: string) => SseFrame[]; flush: () => SseFrame[] } {
  let buffer = ''
  let event = ''
  let id: string | null = null
  let data: string[] = []
  const frames: SseFrame[] = []

  const dispatch = () => {
    if (event && data.length > 0) {
      frames.push({ event, id, data: data.join('\n') })
    }
    event = ''
    data = []
    // `id` is kept across frames, as SSE's last-event-id is.
  }
  const line = (text: string) => {
    if (text === '') {
      dispatch()
      return
    }
    if (text.startsWith(':')) {
      return
    }
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) {
      value = value.slice(1)
    }
    if (field === 'event') {
      event = value
    } else if (field === 'data') {
      data.push(value)
    } else if (field === 'id') {
      id = value
    }
  }
  const drain = (final: boolean): SseFrame[] => {
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer)
      if (!match) {
        break
      }
      // A `\r` at the very end may be the first half of a `\r\n` still in flight.
      if (match[0] === '\r' && match.index === buffer.length - 1 && !final) {
        break
      }
      line(buffer.slice(0, match.index))
      buffer = buffer.slice(match.index + match[0].length)
    }
    if (final) {
      if (buffer) {
        line(buffer)
        buffer = ''
      }
      dispatch()
    }
    return frames.splice(0)
  }
  return {
    push: (text) => {
      buffer += text
      return drain(false)
    },
    flush: () => drain(true)
  }
}

export type CcrStreamFrame =
  | { kind: 'event'; event: CcrEvent }
  | { kind: 'ephemeral'; eventType: string | null; payload: Record<string, unknown> }
  | { kind: 'truncated' }
  | { kind: 'connection'; status: string }
  | { kind: 'ignored'; event: string }
  | { kind: 'skipped'; event: string; reason: 'malformed' | 'unknown-event' | 'no-payload-type' }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** One SSE frame as the session stream means it. Never throws: a frame it cannot read is `skipped`. */
export function readCcrStreamFrame(frame: SseFrame): CcrStreamFrame {
  let data: Record<string, unknown> | null = null
  if (frame.event !== 'catch_up_truncated') {
    try {
      data = record(JSON.parse(frame.data))
    } catch {
      return { kind: 'skipped', event: frame.event, reason: 'malformed' }
    }
    if (!data) {
      return { kind: 'skipped', event: frame.event, reason: 'malformed' }
    }
  }
  switch (frame.event) {
    case 'client_event': {
      const event = parseCcrEvent(data, frame.id)
      if (!event) {
        return { kind: 'skipped', event: frame.event, reason: 'malformed' }
      }
      return typeof event.payload.type === 'string' ? { kind: 'event', event } : { kind: 'skipped', event: frame.event, reason: 'no-payload-type' }
    }
    case 'ephemeral_event': {
      const payload = record(data?.payload)
      return payload && typeof payload.type === 'string'
        ? { kind: 'ephemeral', eventType: typeof data?.event_type === 'string' ? data.event_type : null, payload }
        : { kind: 'skipped', event: frame.event, reason: 'no-payload-type' }
    }
    case 'catch_up_truncated':
      return { kind: 'truncated' }
    case 'session_update':
      return typeof data?.connection_status === 'string' ? { kind: 'connection', status: data.connection_status } : { kind: 'ignored', event: frame.event }
    case 'delivery_update':
    case 'security_update':
      return { kind: 'ignored', event: frame.event }
    default:
      return { kind: 'skipped', event: frame.event, reason: 'unknown-event' }
  }
}

/** The streaming fetch: `expo/fetch` on the phone (React Native's own fetch does not stream bodies). */
export type CcrStreamResponse = {
  ok: boolean
  status: number
  body: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel?: () => Promise<void> } } | null
  text?: () => Promise<string>
}
export type CcrStreamFetch = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal }) => Promise<CcrStreamResponse>

export function ccrEventStreamUrl(sessionId: string, fromSequenceNum: number): string {
  const base = `${CCR_API_BASE_URL}/v1/code/sessions/${encodeURIComponent(sessionId)}/events/stream`
  return fromSequenceNum > 0 ? `${base}?from_sequence_num=${fromSequenceNum}` : base
}

export function ccrEventStreamHeaders(token: string, organizationUuid: string, fromSequenceNum: number): Record<string, string> {
  return {
    ...ccrSessionHeaders(token, organizationUuid),
    Accept: 'text/event-stream',
    ...(fromSequenceNum > 0 ? { 'Last-Event-ID': String(fromSequenceNum) } : {})
  }
}

const UNTRUSTED_DEVICE = /trusted[\s_-]?device|device[\s_-]?(?:identity|trust)/i

/**
 * Opens the stream and hands every frame to `onFrame` until the server ends it (resolves
 * `'ended'`) or `signal` aborts (resolves `'aborted'`). A refused connect throws a
 * `CcrApiError` at stage `stream`, as the other requests do: never a header or a body in it.
 */
export async function readCcrEventStream(args: {
  fetch: CcrStreamFetch
  auth: { token: string; organizationUuid: string }
  sessionId: string
  fromSequenceNum: number
  signal: AbortSignal
  onFrame: (frame: CcrStreamFrame) => void
  /** Called once the server has answered 2xx and the body is open. */
  onOpen?: () => void
}): Promise<'ended' | 'aborted'> {
  const { auth, sessionId, fromSequenceNum, signal, onFrame } = args
  if (!isCcrSessionId(sessionId)) {
    throw new CcrApiError('stream', 'malformed')
  }
  let response: CcrStreamResponse
  try {
    response = await args.fetch(ccrEventStreamUrl(sessionId, fromSequenceNum), {
      method: 'GET',
      headers: ccrEventStreamHeaders(auth.token, auth.organizationUuid, fromSequenceNum),
      signal
    })
  } catch {
    if (signal.aborted) {
      return 'aborted'
    }
    throw new CcrApiError('stream', 'network')
  }
  if (!response.ok || !response.body) {
    const status = response.status
    if (status === 401) {
      throw new CcrApiError('stream', 'unauthorized', status)
    }
    if (status === 403) {
      const body = (await response.text?.().catch(() => '')) ?? ''
      throw new CcrApiError('stream', UNTRUSTED_DEVICE.test(body) ? 'untrusted-device' : 'forbidden', status)
    }
    if (status === 404) {
      throw new CcrApiError('stream', 'not-found', status)
    }
    throw new CcrApiError('stream', response.ok ? 'malformed' : 'http', status)
  }
  args.onOpen?.()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  const deliver = (frames: SseFrame[]) => {
    for (const frame of frames) {
      if (signal.aborted) {
        return
      }
      onFrame(readCcrStreamFrame(frame))
    }
  }
  try {
    for (;;) {
      if (signal.aborted) {
        void reader.cancel?.().catch(() => undefined)
        return 'aborted'
      }
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value) {
        deliver(parser.push(decoder.decode(value, { stream: true })))
      }
    }
  } catch {
    if (signal.aborted) {
      return 'aborted'
    }
    throw new CcrApiError('stream', 'network')
  }
  deliver(parser.push(decoder.decode()))
  deliver(parser.flush())
  return signal.aborted ? 'aborted' : 'ended'
}
