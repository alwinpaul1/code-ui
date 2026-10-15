/**
 * The session's answer to the Usage sheet's `get_context_usage` comes back on the session's own
 * stream as a `control_response` (the app: `SdkControlResponseEvent`, j7u.java, matched by
 * `request_id`). Both frame kinds the stream can carry it in reach the request waiting for it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CcrFetch } from './ccr-session-api'
import { resetCcrCacheForTests } from './ccr-session-cache'
import { CcrSessionLink } from './ccr-session-link'
import { resetCcrTranscriptsForTests } from './ccr-transcript-persist'
import { SESSION_A, event, eventsReply, reply } from './fixtures/ccr-session-api-2026-10-14'
import { sseBody, sseFrame, streamFetch } from './fixtures/ccr-session-stream'

const answer = (requestId: string) => ({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { totalTokens: 145_500, rawMaxTokens: 400_000 } } })

function linkWith(frames: string[]): CcrSessionLink {
  const stream = streamFetch(() => ({ status: 200, chunks: sseBody(frames), hold: true }))
  const fetch: CcrFetch = async () => reply(200, eventsReply([], null))
  return new CcrSessionLink('acct-work', SESSION_A, {
    fetch,
    streamFetch: stream.fetch,
    auth: async () => ({ token: 'token-work', organizationUuid: 'org-work' }),
    keep: () => null,
    log: () => undefined,
    setTimer: () => () => undefined
  })
}

const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let link: CcrSessionLink | null = null
beforeEach(() => {
  resetCcrTranscriptsForTests()
  resetCcrCacheForTests()
})
afterEach(() => {
  link?.stop()
  link = null
})

describe('a control response on the session stream', () => {
  it('reaches the request waiting for it as a live-only event', async () => {
    link = linkWith([sseFrame('ephemeral_event', { event_type: 'control_response', payload: answer('req-1') })])
    const wait = link.controlWaiters.wait('req-1', 45_000)
    link.start()
    await flush()
    await expect(wait.reply).resolves.toMatchObject({ response: { request_id: 'req-1' } })
  })

  it('reaches it as a stored event too, and leaves a reply to another request alone', async () => {
    link = linkWith([sseFrame('client_event', event(answer('req-other'))), sseFrame('client_event', event(answer('req-2')))])
    const wait = link.controlWaiters.wait('req-2', 45_000)
    const other = link.controlWaiters.wait('req-3', 45_000)
    link.start()
    await flush()
    await expect(wait.reply).resolves.toMatchObject({ response: { request_id: 'req-2' } })
    link.stop()
    await expect(other.reply).resolves.toBeNull()
  })
})
