import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { notifyAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import type { CcrFetch } from './ccr-session-api'
import { acquireCcrLink, CCR_LINK_LINGER_MS, foregroundCcrLinks, openCcrLink, pauseCcrLinks, resetCcrLinksForTests, setCcrLinkDepsLoader, setCcrLinkTimerForTests } from './ccr-link-registry'
import { CCR_PERSIST_STREAM_MS, CCR_STREAM_RECONNECT_MS, type CcrLinkDeps, type CcrSessionLink } from './ccr-session-link'
import { ccrToolImage, ccrUserImages, resetCcrCacheForTests } from './ccr-session-cache'
import { CCR_PERSISTED_EVENTS, flushCcrTranscriptsForTests, hydrateCcrTranscripts, readCcrTranscript, resetCcrTranscriptsForTests, restartCcrTranscriptsForTests } from './ccr-transcript-persist'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { PNG_1PX, SESSION_A, SESSION_B, event, eventsReply, imageBlock, pasteEvent, readResultEvent, reply } from './fixtures/ccr-session-api-2026-10-14'
import { sseBody, sseFrame, streamFetch, type StreamReply } from './fixtures/ccr-session-stream'
import type { CcrStreamFetch } from './ccr-event-stream'

const ACCOUNT_A = 'acct-personal'
const ACCOUNT_B = 'acct-work'
const AUTH: Record<string, { token: string; organizationUuid: string }> = {
  [ACCOUNT_A]: { token: 'token-personal', organizationUuid: 'org-personal' },
  [ACCOUNT_B]: { token: 'token-work', organizationUuid: 'org-work' }
}

function text(uuid: string, role: 'user' | 'assistant', words: string) {
  return event({ type: role, uuid, session_id: SESSION_A, parent_tool_use_id: null, message: { role, content: role === 'user' ? words : [{ type: 'text', text: words }] } })
}

/** A history page's answer standing for a 401. */
const UNAUTHORIZED = Symbol('401')

type Timers = { fire: (ms?: number) => void; pending: () => number[] }

/** Timers the test fires by hand: the reconnect waits and the 30 s linger. */
function manualTimers(): Timers & { timer: (run: () => void, ms: number) => () => void } {
  const queue: { run: () => void; ms: number; live: boolean }[] = []
  return {
    timer: (run, ms) => {
      const item = { run, ms, live: true }
      queue.push(item)
      return () => {
        item.live = false
      }
    },
    fire: (ms) => {
      for (const item of queue.splice(0)) {
        if (item.live && (ms === undefined || item.ms === ms)) {
          item.run()
        } else if (item.live) {
          queue.push(item)
        }
      }
    },
    pending: () => queue.filter((item) => item.live).map((item) => item.ms)
  }
}

type World = {
  pages: Record<string, (cursor: string | null) => unknown>
  pageRequests: { url: string; auth: string | undefined; org: string | undefined }[]
  stream: { fetch: CcrStreamFetch; requests: { url: string; headers: Record<string, string> }[] }
  logs: string[]
  authCalls: string[]
  /** The accounts whose sign-in was read afresh (after a 401). */
  freshAuthCalls: string[]
  timers: ReturnType<typeof manualTimers>
  signedOut: Set<string>
  /** The link's clock: each read returns `at`, then moves it on by `step`. */
  clock: { at: number; step: number }
}

function world(streamAnswer: (url: URL, attempt: number) => StreamReply | Promise<StreamReply>): World {
  const w: World = {
    pages: {},
    pageRequests: [],
    stream: streamFetch(streamAnswer),
    logs: [],
    authCalls: [],
    freshAuthCalls: [],
    timers: manualTimers(),
    signedOut: new Set(),
    clock: { at: 0, step: 0 }
  }
  const fetch: CcrFetch = async (url, init) => {
    w.pageRequests.push({ url, auth: init.headers.Authorization, org: init.headers['X-Organization-Uuid'] })
    const parsed = new URL(url)
    const match = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(parsed.pathname)
    const page = match ? w.pages[decodeURIComponent(match[1]!)] : undefined
    if (!page) {
      return reply(404, {})
    }
    const body = await page(parsed.searchParams.get('cursor'))
    return body === UNAUTHORIZED ? reply(401, {}) : reply(200, body)
  }
  const deps: CcrLinkDeps = {
    fetch,
    streamFetch: (url, init) => w.stream.fetch(url, init),
    auth: async (accountId, fresh) => {
      w.authCalls.push(accountId)
      if (fresh) {
        w.freshAuthCalls.push(accountId)
      }
      return w.signedOut.has(accountId) ? null : (AUTH[accountId] ?? null)
    },
    keep: (key) => `file:///cache/${encodeURIComponent(key)}`,
    log: (line) => w.logs.push(line),
    setTimer: w.timers.timer,
    now: () => {
      const at = w.clock.at
      w.clock.at += w.clock.step
      return at
    }
  }
  setCcrLinkDepsLoader(async () => deps)
  setCcrLinkTimerForTests(w.timers.timer)
  return w
}

const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function rowsOf(link: CcrSessionLink): string[] {
  return decodeCcrEvents(link.getState().events).map((row) => `${row.role}:${row.id}`)
}

beforeEach(() => {
  resetCcrLinksForTests()
  resetCcrTranscriptsForTests()
  resetCcrCacheForTests()
})
afterEach(() => {
  resetCcrLinksForTests()
})

describe('one stream per (account, session)', () => {
  it('two tabs from two accounts each read with their own token and organization, on two streams', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'personal')])
    w.pages[SESSION_B] = () => eventsReply([text('u2', 'user', 'work')])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    acquireCcrLink(ACCOUNT_B, SESSION_B)
    await flush()
    expect(w.pageRequests.map((request) => [new URL(request.url).pathname.split('/')[4], request.auth, request.org])).toEqual([
      [SESSION_A, 'Bearer token-personal', 'org-personal'],
      [SESSION_B, 'Bearer token-work', 'org-work']
    ])
    expect(w.stream.requests.map((request) => [request.url.includes(SESSION_A) ? 'A' : 'B', request.headers.Authorization, request.headers['X-Organization-Uuid']])).toEqual([
      ['A', 'Bearer token-personal', 'org-personal'],
      ['B', 'Bearer token-work', 'org-work']
    ])
  })

  it('two views of one tab share one stream: exactly one connect', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'hi')])
    const first = acquireCcrLink(ACCOUNT_A, SESSION_A)
    const second = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(first.link).toBe(second.link)
    expect(w.stream.requests).toHaveLength(1)
  })

  it('a quick tab switch keeps the stream; it closes 30 s after the last view leaves', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([])
    const handle = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    handle.release()
    expect(w.timers.pending()).toContain(CCR_LINK_LINGER_MS)
    const again = acquireCcrLink(ACCOUNT_A, SESSION_A)
    w.timers.fire(CCR_LINK_LINGER_MS)
    expect(openCcrLink(ACCOUNT_A, SESSION_A)).toBe(again.link)
    again.release()
    w.timers.fire(CCR_LINK_LINGER_MS)
    expect(openCcrLink(ACCOUNT_A, SESSION_A)).toBeNull()
    expect(w.stream.requests).toHaveLength(1)
  })

  it('a token re-read for one account does not interrupt the other account’s stream', async () => {
    const w = world((url, attempt) => (url.pathname.includes(SESSION_A) && attempt === 1 ? { status: 401, chunks: [] } : { status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'a')])
    w.pages[SESSION_B] = () => eventsReply([text('u2', 'user', 'b')])
    const a = acquireCcrLink(ACCOUNT_A, SESSION_A)
    const b = acquireCcrLink(ACCOUNT_B, SESSION_B)
    await flush()
    const connects = w.stream.requests.map((request) => (request.url.includes(SESSION_A) ? 'A' : 'B'))
    expect(connects.filter((which) => which === 'A')).toHaveLength(2)
    expect(connects.filter((which) => which === 'B')).toHaveLength(1)
    expect(a.link.getState().phase).toBe('live')
    expect(b.link.getState().phase).toBe('live')
  })

  it('a history page still in flight at sign-out does not bring the wiped transcript back', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    let releasePage: () => void = () => undefined
    w.pages[SESSION_A] = (cursor) => (cursor === 'c1' ? eventsReply([text('u0', 'user', 'older')]) : eventsReply([text('u1', 'user', 'newest')], 'c1'))
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    const held = new Promise<void>((resolve) => {
      releasePage = resolve
    })
    const answer = w.pages[SESSION_A]!
    w.pages[SESSION_A] = (cursor) => held.then(() => answer(cursor))
    const older = link.loadOlder()
    await flush()
    notifyAnthropicAccountsChanged({ signedOut: ACCOUNT_A })
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).toBeNull()
    releasePage()
    await older
    await flush()
    await flushCcrTranscriptsForTests()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).toBeNull()
    restartCcrTranscriptsForTests()
    await hydrateCcrTranscripts()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).toBeNull()
  })

  it('signing one account out stops only its links and wipes only its kept transcript', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'a')])
    w.pages[SESSION_B] = () => eventsReply([text('u2', 'user', 'b')])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    acquireCcrLink(ACCOUNT_B, SESSION_B)
    await flush()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).not.toBeNull()
    notifyAnthropicAccountsChanged({ signedOut: ACCOUNT_A })
    expect(openCcrLink(ACCOUNT_A, SESSION_A)).toBeNull()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).toBeNull()
    expect(openCcrLink(ACCOUNT_B, SESSION_B)?.getState().phase).toBe('live')
    expect(readCcrTranscript(ACCOUNT_B, SESSION_B)).not.toBeNull()
  })
})

describe('an account entry merged into another', () => {
  // Review 2026-10-15: only a sign-out closed an account's links. An entry merged away (or replaced
  // by a new sign-in) left its stream open and its kept transcript on the phone under a dead id.
  it('closes that entry’s links and wipes its kept transcript, and only that entry’s', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'a')])
    w.pages[SESSION_B] = () => eventsReply([text('u2', 'user', 'b')])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    acquireCcrLink(ACCOUNT_B, SESSION_B)
    await flush()
    notifyAnthropicAccountsChanged({ removed: [ACCOUNT_A] })
    expect(openCcrLink(ACCOUNT_A, SESSION_A)).toBeNull()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).toBeNull()
    expect(openCcrLink(ACCOUNT_B, SESSION_B)?.getState().phase).toBe('live')
    expect(readCcrTranscript(ACCOUNT_B, SESSION_B)).not.toBeNull()
  })

  it('a change that removed nobody closes nothing', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'a')])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    notifyAnthropicAccountsChanged({ removed: [] })
    notifyAnthropicAccountsChanged()
    expect(openCcrLink(ACCOUNT_A, SESSION_A)?.getState().phase).toBe('live')
  })
})

describe('the transcript a link holds', () => {
  it('an event on both the newest page and the stream draws one row, not two', async () => {
    const one = text('u1', 'user', 'hello')
    const two = text('a1', 'assistant', 'hi there')
    const w = world(() => ({ status: 200, chunks: sseBody([sseFrame('client_event', one), sseFrame('client_event', two)]), hold: true }))
    w.pages[SESSION_A] = () => eventsReply([one])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toEqual(['user:u1', 'assistant:a1'])
  })

  it('the stream resumes after the newest sequence number the page held', async () => {
    const one = text('u1', 'user', 'hello')
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([one])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(w.stream.requests[0]!.url).toContain(`from_sequence_num=${one.sequence_num}`)
  })

  it('the tab paints its last transcript before any network, and asks only for what came after', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    const held = [text('u1', 'user', 'hello'), text('a1', 'assistant', 'hi')]
    w.pages[SESSION_A] = () => eventsReply(held)
    acquireCcrLink(ACCOUNT_A, SESSION_A).release()
    await flush()
    await flushCcrTranscriptsForTests()
    // A cold start: memory gone, the kept copy read back from storage.
    resetCcrLinksForTests()
    restartCcrTranscriptsForTests()
    await hydrateCcrTranscripts()
    const w2 = world(() => new Promise<StreamReply>(() => undefined))
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    expect(rowsOf(link)).toEqual(['user:u1', 'assistant:a1'])
    await flush()
    expect(w2.pageRequests).toHaveLength(0)
    expect(w2.stream.requests[0]!.url).toContain(`from_sequence_num=${held[1]!.sequence_num}`)
  })

  it('a truncated catch-up pages history back until the gap is closed', async () => {
    const old = text('u1', 'user', 'old')
    const missed = text('a1', 'assistant', 'missed while away')
    const w = world((_url, attempt) => (attempt === 1 ? { status: 200, chunks: sseBody([sseFrame('catch_up_truncated', {})]), hold: true } : { status: 200, chunks: [], hold: true }))
    let pageCalls = 0
    w.pages[SESSION_A] = () => {
      pageCalls += 1
      return pageCalls === 1 ? eventsReply([old]) : eventsReply([missed, old])
    }
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toEqual(['user:u1', 'assistant:a1'])
  })

  it('scrolling to the start loads the page before the oldest held, by its cursor', async () => {
    const older = text('u0', 'user', 'first ever')
    const newer = text('u1', 'user', 'latest')
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = (cursor) => (cursor === 'c2' ? eventsReply([older], null) : eventsReply([newer], 'c2'))
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(link.getState().hasOlder).toBe(true)
    await link.loadOlder()
    expect(rowsOf(link)).toEqual(['user:u0', 'user:u1'])
    expect(link.getState().hasOlder).toBe(false)
    expect(new URL(w.pageRequests[1]!.url).searchParams.get('cursor')).toBe('c2')
  })

  // Review 2026-10-15: a kept copy cut to its newest 200 rows knows no older cursor, so the first
  // scroll to the top walked from the newest page and stopped as soon as anything new was held,
  // which that page's undrawn system events always were: nothing older was drawn (200 > 200).
  it('cold start from a cut kept copy: the first scroll to the top draws rows older than it held', async () => {
    const oldest = text('u-old', 'user', 'from before the kept copy')
    const kept = Array.from({ length: CCR_PERSISTED_EVENTS + 20 }, (_row, index) => text(`k${index}`, index % 2 ? 'assistant' : 'user', `row ${index}`))
    const status = Array.from({ length: 30 }, (_row, index) => event({ type: 'system', subtype: 'status', uuid: `s${index}`, session_id: SESSION_A }))
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    // Everything once, newest first: the copy is written cut to its newest 200 rows.
    w.pages[SESSION_A] = () => eventsReply([...kept, ...status])
    acquireCcrLink(ACCOUNT_A, SESSION_A).release()
    await flush()
    await flushCcrTranscriptsForTests()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).toMatchObject({ olderCursor: null, hasOlder: true })
    resetCcrLinksForTests()
    restartCcrTranscriptsForTests()
    await hydrateCcrTranscripts()
    const w2 = world(() => ({ status: 200, chunks: [], hold: true }))
    w2.pages[SESSION_A] = (cursor) => (cursor === 'c2' ? eventsReply([oldest, ...kept.slice(0, 20)], null) : eventsReply([...kept.slice(20), ...status], 'c2'))
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toHaveLength(CCR_PERSISTED_EVENTS)
    await link.loadOlder()
    expect(rowsOf(link)).toHaveLength(CCR_PERSISTED_EVENTS + 21)
    expect(rowsOf(link)[0]).toBe('user:u-old')
    expect(link.getState().hasOlder).toBe(false)
  })

  it('cold start from a cut copy whose history holds nothing older stops at the start, drawing nothing new', async () => {
    const kept = Array.from({ length: CCR_PERSISTED_EVENTS + 1 }, (_row, index) => text(`k${index}`, 'user', `row ${index}`))
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply(kept)
    acquireCcrLink(ACCOUNT_A, SESSION_A).release()
    await flush()
    await flushCcrTranscriptsForTests()
    resetCcrLinksForTests()
    restartCcrTranscriptsForTests()
    await hydrateCcrTranscripts()
    const w2 = world(() => ({ status: 200, chunks: [], hold: true }))
    w2.pages[SESSION_A] = () => eventsReply(kept.slice(1), null)
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    await link.loadOlder()
    expect(rowsOf(link)).toHaveLength(CCR_PERSISTED_EVENTS)
    expect(link.getState().hasOlder).toBe(false)
  })

  // Review 2026-10-15: each streamed event wrote the whole kept copy (a trim and a JSON size check
  // of up to 200 rows) at once; a burst of events now writes once.
  it('events streamed in a burst are kept once, after the burst', async () => {
    const one = text('u1', 'user', 'hello')
    const burst = Array.from({ length: 5 }, (_row, index) => text(`a${index}`, 'assistant', `part ${index}`))
    const w = world(() => ({ status: 200, chunks: sseBody(burst.map((raw) => sseFrame('client_event', raw))), hold: true }))
    w.pages[SESSION_A] = () => eventsReply([one])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toHaveLength(6)
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)?.events).toHaveLength(1)
    expect(w.timers.pending()).toEqual([CCR_PERSIST_STREAM_MS])
    w.timers.fire(CCR_PERSIST_STREAM_MS)
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)?.events).toHaveLength(6)
  })

  it('the app going to the background keeps what streamed in at once', async () => {
    const two = text('a1', 'assistant', 'streamed')
    const w = world(() => ({ status: 200, chunks: sseBody([sseFrame('client_event', two)]), hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'hello')])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    pauseCcrLinks()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)?.events).toHaveLength(2)
    expect(w.timers.pending()).toEqual([])
  })

  it('a sign-out with a write pending writes nothing back', async () => {
    const two = text('a1', 'assistant', 'streamed')
    const w = world(() => ({ status: 200, chunks: sseBody([sseFrame('client_event', two)]), hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'hello')])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    notifyAnthropicAccountsChanged({ signedOut: ACCOUNT_A })
    w.timers.fire()
    expect(readCcrTranscript(ACCOUNT_A, SESSION_A)).toBeNull()
  })

  it('pictures arrive as files, are drawn from the image cache, and no base64 is held or kept', async () => {
    const paste = pasteEvent('u-paste', [imageBlock(PNG_1PX)], '[Image #1] look')
    const read = readResultEvent('u-read', 'toolu_1', [imageBlock(PNG_1PX)])
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([paste, read])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(ccrUserImages('u-paste')).toEqual([`file:///cache/${encodeURIComponent('ccr\0user\0u-paste\0' + '0')}`])
    expect(ccrToolImage('toolu_1')).toBe(`file:///cache/${encodeURIComponent('ccr\0tool\0toolu_1')}`)
    expect(JSON.stringify(link.getState().events)).not.toContain(PNG_1PX)
    expect(JSON.stringify(readCcrTranscript(ACCOUNT_A, SESSION_A))).not.toContain(PNG_1PX)
  })
})

describe('when reading fails', () => {
  it('a stream that ends reconnects after 1, 3, 7, 15 and 31 s, then says the connection is lost', async () => {
    const w = world(() => ({ status: 200, chunks: [] }))
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    for (const wait of CCR_STREAM_RECONNECT_MS) {
      expect(link.getState().phase).toBe('reconnecting')
      expect(w.timers.pending()).toContain(wait)
      w.timers.fire(wait)
      await flush()
    }
    expect(link.getState().phase).toBe('lost')
    expect(link.getState().error).toMatch(/Lost the connection to Anthropic/)
    expect(w.stream.requests).toHaveLength(CCR_STREAM_RECONNECT_MS.length + 1)
    link.retry()
    await flush()
    expect(w.stream.requests).toHaveLength(CCR_STREAM_RECONNECT_MS.length + 2)
  })

  /** Fires every reconnect wait until the link is lost (or 30 firings): the waits it asked for. */
  async function fireUntilLost(w: World, link: CcrSessionLink): Promise<number[]> {
    const waits: number[] = []
    for (let firing = 0; firing < 30 && link.getState().phase !== 'lost'; firing++) {
      waits.push(...w.timers.pending().filter((ms) => ms !== CCR_PERSIST_STREAM_MS))
      w.timers.fire()
      await flush()
    }
    return waits
  }

  // Review 2026-10-15: any frame reset the back-off, so a server that answers with one frame and
  // closes was redialled every second for ever (31 requests in 30 firings, never `lost`).
  it('a server that sends one session_update and closes backs off 1/3/7/15/31 s, then is lost', async () => {
    const w = world(() => ({ status: 200, chunks: sseBody([sseFrame('session_update', { connection_status: 'connected' })]) }))
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(await fireUntilLost(w, link)).toEqual([...CCR_STREAM_RECONNECT_MS])
    expect(link.getState().phase).toBe('lost')
    expect(w.stream.requests).toHaveLength(CCR_STREAM_RECONNECT_MS.length + 1)
  })

  it('a server that hands over a new event and closes at once still backs off, then is lost', async () => {
    let seq = 0
    const w = world(() => {
      seq += 1
      return { status: 200, chunks: sseBody([sseFrame('client_event', text(`u${seq}`, 'user', `again ${seq}`))]) }
    })
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(await fireUntilLost(w, link)).toEqual([...CCR_STREAM_RECONNECT_MS])
    expect(link.getState().phase).toBe('lost')
  })

  it('a stream that delivered new events and stayed up starts the back-off over at 1 s', async () => {
    let seq = 0
    const w = world(() => {
      seq += 1
      return { status: 200, chunks: sseBody([sseFrame('client_event', text(`u${seq}`, 'user', `turn ${seq}`))]) }
    })
    // Every connection lasts a minute by the link's clock.
    w.clock.step = 60_000
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    for (let firing = 0; firing < 8; firing++) {
      expect(w.timers.pending().filter((ms) => ms !== CCR_PERSIST_STREAM_MS)).toEqual([CCR_STREAM_RECONNECT_MS[0]])
      w.timers.fire()
      await flush()
    }
    expect(link.getState().phase).toBe('reconnecting')
  })

  // Review 2026-10-15: only a connection that moved the transcript on reset the back-off, so a
  // healthy stream up for minutes on an idle session, dropped by the network now and then, was
  // `lost` after its fifth drop over hours.
  it('an idle stream that stayed up a minute before each drop starts the back-off over, never lost', async () => {
    const w = world(() => ({ status: 200, chunks: [] }))
    // Every connection lasts a minute by the link's clock, and carries no event.
    w.clock.step = 60_000
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    for (let drop = 0; drop < CCR_STREAM_RECONNECT_MS.length + 1; drop++) {
      expect(w.timers.pending().filter((ms) => ms !== CCR_PERSIST_STREAM_MS)).toEqual([CCR_STREAM_RECONNECT_MS[0]])
      w.timers.fire()
      await flush()
    }
    expect(link.getState().phase).toBe('reconnecting')
    expect(w.stream.requests).toHaveLength(CCR_STREAM_RECONNECT_MS.length + 2)
  })

  it('a stream refused for this sign-in stops and says why, with no redial, as the app does', async () => {
    const w = world(() => ({ status: 403, chunks: [], text: '{"error":{"type":"permission_error"}}' }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'hi')])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(link.getState().phase).toBe('error')
    expect(link.getState().error).toMatch(/forbidden \(HTTP 403\)/)
    expect(w.timers.pending()).toEqual([])
    expect(w.stream.requests).toHaveLength(1)
    // What was read stays on screen.
    expect(rowsOf(link)).toEqual(['user:u1'])
  })

  it('a newest page of only system events pages back until it holds a row to draw', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    const prompt = text('u1', 'user', 'the last thing said')
    const status = event({ type: 'system', subtype: 'status', uuid: 's1', session_id: SESSION_A })
    w.pages[SESSION_A] = (cursor) => (cursor === 'c2' ? eventsReply([prompt], null) : eventsReply([status], 'c2'))
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toEqual(['user:u1'])
    expect(w.pageRequests.map((request) => new URL(request.url).searchParams.get('limit'))).toEqual(['200', '500'])
  })

  it('a frame it cannot read is skipped and counted, and the rest still draw', async () => {
    const good = text('a1', 'assistant', 'fine')
    const w = world(() => ({ status: 200, chunks: sseBody(['event: client_event\ndata: {broken\n\n', sseFrame('client_event', good)]), hold: true }))
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toEqual(['assistant:a1'])
    expect(w.logs.some((line) => line.includes('skipped a client_event frame (malformed); 1 so far'))).toBe(true)
  })

  it('a history page that fails says so on the link instead of spinning', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => {
      throw new Error('unreachable')
    }
    // No route answers: the page is a 404.
    delete w.pages[SESSION_A]
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(link.getState().phase).toBe('error')
    expect(link.getState().error).toMatch(/not found \(HTTP 404\)/)
    expect(w.stream.requests).toHaveLength(0)
  })

  it('a history page refused with 401 reads the sign-in afresh once and reads the page again', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    let calls = 0
    w.pages[SESSION_A] = () => {
      calls += 1
      return eventsReply([text('u1', 'user', 'hi')])
    }
    const pages = w.pages[SESSION_A]!
    let refused = false
    w.pages[SESSION_A] = (cursor) => {
      if (!refused) {
        refused = true
        return UNAUTHORIZED
      }
      return pages(cursor)
    }
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(w.freshAuthCalls).toEqual([ACCOUNT_A])
    expect(calls).toBe(1)
    expect(rowsOf(link)).toEqual(['user:u1'])
    expect(link.getState().phase).toBe('live')
  })

  it('a history page refused with 401 twice says so, after one fresh read', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => UNAUTHORIZED
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(w.freshAuthCalls).toEqual([ACCOUNT_A])
    expect(link.getState().phase).toBe('error')
    expect(link.getState().error).toMatch(/HTTP 401/)
  })

  it('a stream refused with 401 connects again with a sign-in read afresh', async () => {
    const w = world((_url, attempt) => (attempt === 1 ? { status: 401, chunks: [] } : { status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'hi')])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(w.freshAuthCalls).toEqual([ACCOUNT_A])
    expect(link.getState().phase).toBe('live')
  })

  it('an account signed out under a link says so rather than reading with nothing', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.signedOut.add(ACCOUNT_A)
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(link.getState().phase).toBe('error')
    expect(link.getState().error).toMatch(/signed out/)
  })
})

describe('degenerate sizes', () => {
  it('a session with no events is live and empty, with nothing older', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(link.getState()).toMatchObject({ phase: 'live', hasOlder: false })
    expect(rowsOf(link)).toEqual([])
    expect(w.stream.requests[0]!.url).not.toContain('from_sequence_num')
  })

  it('a session of exactly one event draws exactly one row', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'only')])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toEqual(['user:u1'])
  })

  it('a catch-up truncated at the very first event still fills from history', async () => {
    const first = text('u1', 'user', 'first')
    const w = world((_url, attempt) => (attempt === 1 ? { status: 200, chunks: sseBody([sseFrame('catch_up_truncated', {})]), hold: true } : { status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([first])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(rowsOf(link)).toEqual(['user:u1'])
  })
})

// Review 2026-10-15: retryCcrLinks() had no production caller, so a lost stream stayed lost until
// the relay reconnected, and the streams kept running with the app in the background.
describe('the app in the background and back in front', () => {
  it('a lost stream reconnects when the app comes back to the foreground', async () => {
    const w = world(() => ({ status: 200, chunks: [] }))
    w.pages[SESSION_A] = () => eventsReply([])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    for (const wait of CCR_STREAM_RECONNECT_MS) {
      w.timers.fire(wait)
      await flush()
    }
    expect(link.getState().phase).toBe('lost')
    const before = w.stream.requests.length
    foregroundCcrLinks()
    await flush()
    expect(w.stream.requests).toHaveLength(before + 1)
  })

  it('the background closes the stream and schedules no redial', async () => {
    const signals: AbortSignal[] = []
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    const recorded = w.stream.fetch
    w.stream.fetch = (url, init) => {
      signals.push(init.signal)
      return recorded(url, init)
    }
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'hi')])
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(false)
    pauseCcrLinks()
    await flush()
    expect(signals[0]!.aborted).toBe(true)
    expect(w.timers.pending()).toEqual([])
    expect(signals).toHaveLength(1)
  })

  it('back in front, a paused stream resumes after the last sequence number it held', async () => {
    const one = text('u1', 'user', 'hello')
    const two = text('a1', 'assistant', 'streamed before the pause')
    const w = world((_url, attempt) => (attempt === 1 ? { status: 200, chunks: sseBody([sseFrame('client_event', two)]), hold: true } : { status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([one])
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    pauseCcrLinks()
    await flush()
    expect(w.stream.requests).toHaveLength(1)
    foregroundCcrLinks()
    await flush()
    expect(w.stream.requests).toHaveLength(2)
    expect(w.stream.requests[1]!.url).toContain(`from_sequence_num=${two.sequence_num}`)
    expect(w.pageRequests).toHaveLength(1)
    expect(link.getState().phase).toBe('live')
  })

  // Review 2026-10-15: the open from before the pause still awaited its page, then dialled beside
  // the one resume() started, and both wrote `this.abort`: the older stream was never closed.
  it('a pause and resume while the first page is in flight dial one stream, not two', async () => {
    const signals: AbortSignal[] = []
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    const recorded = w.stream.fetch
    w.stream.fetch = (url, init) => {
      signals.push(init.signal)
      return recorded(url, init)
    }
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    w.pages[SESSION_A] = async () => {
      await held
      return eventsReply([text('u1', 'user', 'hi')])
    }
    const { link } = acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(w.pageRequests).toHaveLength(1)
    pauseCcrLinks()
    foregroundCcrLinks()
    release()
    await flush()
    expect(w.stream.requests).toHaveLength(1)
    expect(signals.filter((signal) => !signal.aborted)).toHaveLength(1)
    expect(link.getState().phase).toBe('live')
  })

  it('a tab opened while the app is in the background waits for the foreground to read', async () => {
    const w = world(() => ({ status: 200, chunks: [], hold: true }))
    w.pages[SESSION_A] = () => eventsReply([text('u1', 'user', 'hi')])
    pauseCcrLinks()
    acquireCcrLink(ACCOUNT_A, SESSION_A)
    await flush()
    expect(w.pageRequests).toHaveLength(0)
    expect(w.stream.requests).toHaveLength(0)
    foregroundCcrLinks()
    await flush()
    expect(w.pageRequests).toHaveLength(1)
    expect(w.stream.requests).toHaveLength(1)
  })
})
