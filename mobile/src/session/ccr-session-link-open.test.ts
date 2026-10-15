import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCcrEvent, type CcrFetch } from './ccr-session-api'
import { resetCcrCacheForTests } from './ccr-session-cache'
import { CcrSessionLink, type CcrLinkDeps } from './ccr-session-link'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { resetCcrTranscriptsForTests, writeCcrTranscript } from './ccr-transcript-persist'
import { SESSION_A, event, eventsReply, reply } from './fixtures/ccr-session-api-2026-10-14'
import { sseBody, sseFrame, streamFetch } from './fixtures/ccr-session-stream'

/**
 * Opening a session the phone has a kept copy of: the kept rows are the first frame, and what the
 * phone missed lands in ONE change, not a row at a time (the user, 2026-10-15: "it starts to
 * populate and scroll down … see how claude mobile does that and do the same").
 *
 * The Claude app 1.261009.20 (decompiled, R8 names): the session view model seeds its store from
 * an in-memory cache of the last 4 sessions in its constructor (`rs8.b5` reading `tdu`, applied as
 * one `Initialize` with source CacheSeed), then the connect path reads the newest page(s) of
 * `…/events?sort_order=desc` (`xjw.b` "loadLatestPageV2": up to 2 pages of 200) and applies them
 * as ONE `Initialize` that replaces the seed wholesale (`sessions/store/a.d`), before the stream
 * carries single events. Here the stream used to replay everything after the kept copy's last
 * sequence number one event per frame, and the chat re-rendered per row as they trickled in.
 */

const ACCOUNT = 'acct-personal'
const AUTH = { token: 'token-personal', organizationUuid: 'org-personal' }

function text(uuid: string, role: 'user' | 'assistant', words: string) {
  return event({ type: role, uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role, content: role === 'user' ? words : [{ type: 'text', text: words }] } })
}

type Raw = ReturnType<typeof text>

type World = {
  deps: CcrLinkDeps
  pageRequests: string[]
  streamUrls: () => string[]
}

/** `pages(cursor)`: the history's answer for a cursor (null = newest); the stream replays `frames`. */
function world(pages: (cursor: string | null) => unknown, frames: Raw[] = []): World {
  const pageRequests: string[] = []
  const stream = streamFetch(() => ({ status: 200, chunks: sseBody(frames.map((raw) => sseFrame('client_event', raw))), hold: true }))
  const fetch: CcrFetch = async (url) => {
    pageRequests.push(url)
    const body = pages(new URL(url).searchParams.get('cursor'))
    return body instanceof Error ? reply(500, {}) : reply(200, body)
  }
  return {
    deps: {
      fetch,
      streamFetch: stream.fetch,
      auth: async () => AUTH,
      keep: (key) => `file:///cache/${encodeURIComponent(key)}`,
      log: () => undefined,
      setTimer: () => () => undefined
    },
    pageRequests,
    streamUrls: () => stream.requests.map((request) => request.url)
  }
}

function keep(raws: Raw[], extra: { olderCursor?: string | null; hasOlder?: boolean } = {}): void {
  const events = raws.map((raw) => parseCcrEvent(raw)!)
  writeCcrTranscript({ accountId: ACCOUNT, sessionId: SESSION_A, events, lastSequenceNum: events.at(-1)?.sequenceNum ?? 0, olderCursor: extra.olderCursor ?? null, hasOlder: extra.hasOlder ?? true })
}

const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Every distinct row list the link handed its listeners, in order: what the chat drew. */
function watch(link: CcrSessionLink): string[][] {
  const drawn: string[][] = [decodeCcrEvents(link.getState().events).map((row) => row.id)]
  link.subscribe(() => {
    const ids = decodeCcrEvents(link.getState().events).map((row) => row.id)
    if (ids.join() !== drawn.at(-1)!.join()) {
      drawn.push(ids)
    }
  })
  return drawn
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

describe('opening a session from the phone’s kept copy', () => {
  it('lands what the phone missed in one change, not a row at a time', async () => {
    const kept = [text('u1', 'user', 'Fix the parser'), text('a1', 'assistant', 'On it')]
    const missed = [text('u2', 'user', 'And the tests'), text('a2', 'assistant', 'Done'), text('u3', 'user', 'Thanks'), text('a3', 'assistant', 'Any time')]
    keep(kept)
    // The newest page holds everything; the stream, asked from the kept copy's end, replays the
    // missed events one frame each.
    const w = world(() => eventsReply([...missed].toReversed().concat([...kept].toReversed()), null), missed)
    link = new CcrSessionLink(ACCOUNT, SESSION_A, w.deps)
    const drawn = watch(link)
    link.start()
    await flush()
    expect(drawn).toEqual([
      ['u1', 'a1'],
      ['u1', 'a1', 'u2', 'a2', 'u3', 'a3']
    ])
    // The stream resumes after the page, so it replays nothing already drawn.
    expect(w.streamUrls()[0]).toContain(`from_sequence_num=${missed.at(-1)!.sequence_num}`)
  })

  it('opens a one-row kept copy and adds the reply that came while away in the same change', async () => {
    const kept = [text('u1', 'user', 'Fix the parser')]
    const reply1 = text('a1', 'assistant', 'Fixed')
    keep(kept)
    const w = world(() => eventsReply([reply1, kept[0]!], null), [reply1])
    link = new CcrSessionLink(ACCOUNT, SESSION_A, w.deps)
    const drawn = watch(link)
    link.start()
    await flush()
    expect(drawn).toEqual([['u1'], ['u1', 'a1']])
  })

  it('an empty newest page leaves the kept rows drawn, and the stream asks from the kept end', async () => {
    const kept = [text('u1', 'user', 'Fix the parser'), text('a1', 'assistant', 'On it')]
    keep(kept)
    const w = world(() => eventsReply([], null))
    link = new CcrSessionLink(ACCOUNT, SESSION_A, w.deps)
    const drawn = watch(link)
    link.start()
    await flush()
    expect(drawn).toEqual([['u1', 'a1']])
    expect(w.streamUrls()[0]).toContain(`from_sequence_num=${kept[1]!.sequence_num}`)
  })

  it('a newest page that fails keeps the kept rows and still opens the stream from the kept end', async () => {
    const kept = [text('u1', 'user', 'Fix the parser'), text('a1', 'assistant', 'On it')]
    keep(kept)
    const w = world(() => new Error('500'))
    link = new CcrSessionLink(ACCOUNT, SESSION_A, w.deps)
    const drawn = watch(link)
    link.start()
    await flush()
    expect(drawn).toEqual([['u1', 'a1']])
    expect(link.getState().phase).not.toBe('error')
    expect(w.streamUrls()[0]).toContain(`from_sequence_num=${kept[1]!.sequence_num}`)
  })

  it('more missed than two newest pages reach: the pages replace the kept copy in one change, as the app’s Initialize does', async () => {
    const kept = [text('u1', 'user', 'old'), text('a1', 'assistant', 'old reply')]
    keep(kept, { olderCursor: 'kept-cursor' })
    // Never reaches back to the kept copy: each page is full and points further back.
    // A sequence number between the kept copy and the pages that the open never reads.
    text('gap', 'user', 'never read on open')
    const page2 = [text('u5', 'user', 'five'), text('a5', 'assistant', 'five reply')]
    const page1 = [text('u6', 'user', 'six'), text('a6', 'assistant', 'six reply')]
    const w = world((cursor) => (cursor === null ? eventsReply([...page1].toReversed(), 'p2') : cursor === 'p2' ? eventsReply([...page2].toReversed(), 'p3') : eventsReply([], null)))
    link = new CcrSessionLink(ACCOUNT, SESSION_A, w.deps)
    const drawn = watch(link)
    link.start()
    await flush()
    expect(drawn).toEqual([
      ['u1', 'a1'],
      ['u5', 'a5', 'u6', 'a6']
    ])
    expect(w.pageRequests).toHaveLength(2)
    expect(link.getState().hasOlder).toBe(true)
    // Older history continues from the second page's cursor, not the dropped copy's.
    await link.loadOlder()
    expect(new URL(w.pageRequests[2]!).searchParams.get('cursor')).toBe('p3')
  })
})
