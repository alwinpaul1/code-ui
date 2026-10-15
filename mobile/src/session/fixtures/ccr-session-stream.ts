import type { CcrStreamFetch, CcrStreamResponse } from '../ccr-event-stream'

// ─── The session stream, built to Claude Code 2.1.300's reader ──────────────
//
// NOT A LIVE CAPTURE. No SSE bytes of `v1/code/sessions/{id}/events/stream`
// have been recorded yet. These frames follow what Claude Code 2.1.300's own
// client parses (SessionsV2Client.handleFrame, binary @224229000): `event:`
// name, `id:` sequence number, `data:` one JSON object, a blank line between
// frames; a `client_event`'s data is the same event object a history page
// holds (fixtures/ccr-session-api-2026-10-14.ts `event()`). Replace with the
// capture from scratchpad/probe/p6-stream.cjs once it is run.

/** One SSE frame's text. `id` defaults to the event's own sequence number. */
export function sseFrame(name: string, data: unknown, id?: string | number): string {
  const seq = id ?? (data && typeof data === 'object' && 'sequence_num' in data ? String((data as { sequence_num: unknown }).sequence_num) : undefined)
  return `event: ${name}\n${seq === undefined ? '' : `id: ${seq}\n`}data: ${JSON.stringify(data)}\n\n`
}

/** The frames as the bytes a body would deliver. */
export function sseBody(frames: string[]): Uint8Array[] {
  return [new TextEncoder().encode(frames.join(''))]
}

export type StreamReply = {
  status: number
  /** Body bytes, re-cut into `chunkSize` pieces when given (to split frames and characters). */
  chunks: Uint8Array[]
  chunkSize?: number
  text?: string
  /** Leave the body open after the chunks until the request is aborted. */
  hold?: boolean
}

export type RecordedStreamRequest = { url: string; headers: Record<string, string> }

function recut(chunks: Uint8Array[], size: number | undefined): Uint8Array[] {
  if (!size) {
    return chunks
  }
  const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.length
  }
  const out: Uint8Array[] = []
  for (let at = 0; at < all.length; at += size) {
    out.push(all.slice(at, at + size))
  }
  return out
}

/** A streaming fetch that answers each connect from `answer` and keeps every request. */
export function streamFetch(answer: (url: URL, attempt: number) => StreamReply | Promise<StreamReply>): { fetch: CcrStreamFetch; requests: RecordedStreamRequest[] } {
  const requests: RecordedStreamRequest[] = []
  const fetch: CcrStreamFetch = async (url, init) => {
    requests.push({ url, headers: { ...init.headers } })
    const reply = await answer(new URL(url), requests.length)
    const queue = recut(reply.chunks, reply.chunkSize)
    const response: CcrStreamResponse = {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => reply.text ?? '',
      body: {
        getReader: () => ({
          read: async () => {
            const next = queue.shift()
            if (next) {
              return { done: false, value: next }
            }
            if (reply.hold && !init.signal.aborted) {
              await new Promise<void>((resolve) => init.signal.addEventListener('abort', () => resolve(), { once: true }))
            }
            return { done: true }
          },
          cancel: async () => undefined
        })
      }
    }
    return response
  }
  return { fetch, requests }
}
