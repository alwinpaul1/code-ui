import { CcrApiError, type CcrEvent, type CcrEventPage } from './ccr-session-api'
import { readCcrEventStream, type CcrStreamFrame } from './ccr-event-stream'
import { CCR_FIRST_PAGE_EVENTS, CCR_OLDER_PAGE_EVENTS, CCR_STREAM_RECONNECT_MS, CCR_STREAM_STABLE_MS, defaultCcrTimer, type CcrLinkDeps, type CcrLinkState } from './ccr-session-link-types'
import { CCR_MAX_EVENT_PAGES, reasonOf } from './ccr-session-shared'
import { CCR_SIGNED_OUT_LINE, CcrSignedOutError, readCcrHistoryPage, walkCcrHistory } from './ccr-link-history'
import { readCcrTranscript } from './ccr-transcript-persist'
import { ccrEventDrawsRow } from './ccr-transcript-decode'
import { CcrEventStore, CcrKeptCopyWriter } from './ccr-link-store'

export { CCR_FIRST_PAGE_EVENTS, CCR_OLDER_PAGE_EVENTS, CCR_PERSIST_STREAM_MS, CCR_STREAM_RECONNECT_MS, CCR_STREAM_STABLE_MS, type CcrLinkAuth, type CcrLinkDeps, type CcrLinkPhase, type CcrLinkState } from './ccr-session-link-types'

/**
 * One Claude Code session on Anthropic, read with one account: its events, paged back from the
 * newest (`GET …/events?sort_order=desc`, as the Claude app reads them, m4v.java:95-101) and
 * kept current by ONE stream (`…/events/stream`, ccr-event-stream.ts) that resumes after the
 * last sequence number held.
 *
 * The open path makes no request before the first paint: the events kept on the phone for this
 * (account, session) are there at once (ccr-transcript-persist.ts), and the stream asks only for
 * what came after them. With nothing kept, the newest page is read first, then the stream.
 *
 * Events are keyed by the message uuid (`payload.uuid`, on every one of 4,000 observed live on
 * 2026-10-14), else `event_id`: a page and the stream that both carry an event hold it once.
 * Pictures are moved to cache files as each event arrives (`slimCcrEvent`): no base64 is kept.
 */

export class CcrSessionLink {
  readonly accountId: string
  readonly sessionId: string
  private readonly deps: CcrLinkDeps
  private readonly store: CcrEventStore
  private readonly keptCopy: CcrKeptCopyWriter
  private olderCursor: string | null = null
  private state: CcrLinkState
  private readonly listeners = new Set<() => void>()
  private abort: AbortController | null = null
  private cancelTimer: (() => void) | null = null
  private reconnects = 0
  private stopped = false
  private started = false
  private paused = false
  private refreshedAuth = false
  private skippedFrames = 0
  /** Bumped by pause(), restart() and stop(): an open() or connect() begun before it bails after
   *  its next await, so a page in flight across a pause and resume does not dial a second stream
   *  beside the one resume() started (review 2026-10-15). */
  private generation = 0

  constructor(accountId: string, sessionId: string, deps: CcrLinkDeps) {
    this.accountId = accountId
    this.sessionId = sessionId
    this.deps = deps
    this.store = new CcrEventStore(deps.keep)
    this.keptCopy = new CcrKeptCopyWriter(deps.setTimer ?? defaultCcrTimer, () =>
      this.stopped ? null : { accountId, sessionId, events: this.store.drawing(), lastSequenceNum: this.store.lastSequenceNum, olderCursor: this.olderCursor, hasOlder: this.state.hasOlder }
    )
    this.state = { events: [], phase: 'idle', error: null, hasOlder: true, loadingOlder: false, connectionStatus: null, version: 0 }
    const kept = readCcrTranscript(accountId, sessionId)
    if (kept) {
      this.add(kept.events, false)
      this.store.seen(kept.lastSequenceNum)
      this.olderCursor = kept.olderCursor
      this.state = { ...this.state, events: this.ordered, hasOlder: kept.hasOlder }
    }
  }

  getState = (): CcrLinkState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private log(line: string): void {
    ;(this.deps.log ?? ((text: string) => console.log(text)))(`[ccr-link] ${line}`)
  }

  private set(patch: Partial<CcrLinkState>): void {
    if (this.stopped) {
      return
    }
    this.state = { ...this.state, ...patch, events: this.ordered, version: this.state.version + 1 }
    for (const listener of this.listeners) {
      listener()
    }
  }

  private add(events: readonly CcrEvent[], slim = true): boolean {
    return this.store.add(events, slim)
  }

  private get ordered(): CcrEvent[] {
    return this.store.ordered
  }

  /** Writes the kept copy now; a streamed burst waits (persistSoon). A stopped link's account may
   *  have signed out, its copy just wiped: a page landing late must not write it back. */
  private persist(): void {
    this.keptCopy.write()
  }

  private persistSoon(): void {
    this.keptCopy.soon()
  }

  /** Writes a pending streamed burst now (the app leaving, the link closing). */
  flushPersist(): void {
    this.keptCopy.flush()
  }

  /** Starts reading: the newest page when nothing is held, then the stream. Idempotent. */
  start(): void {
    if (this.started || this.stopped) {
      return
    }
    this.started = true
    if (!this.paused) {
      void this.open()
    }
  }

  private async open(): Promise<void> {
    const generation = this.generation
    if (this.ordered.length === 0) {
      this.set({ phase: 'loading', error: null })
      if (!(await this.readPage(null)) || generation !== this.generation) {
        return
      }
      // As the app does: a newest page with nothing to draw (all `system`) pages back until one
      // does, up to CCR_MAX_EVENT_PAGES.
      for (let page = 1; page < CCR_MAX_EVENT_PAGES && this.state.hasOlder && !this.ordered.some(ccrEventDrawsRow); page++) {
        await this.loadOlder()
        if (generation !== this.generation) {
          return
        }
      }
    }
    this.connect()
  }

  /** One history page, newest first from `cursor`; false when it failed (the state says why). */
  private async readPage(cursor: string | null): Promise<boolean> {
    try {
      const page = await this.readHistory(cursor, CCR_FIRST_PAGE_EVENTS)
      // After stop(), `set` and `persist` change nothing and connect() does not dial.
      this.add(page.events)
      // Only the first page is read here: what is older starts at its cursor.
      this.olderCursor = page.nextCursor
      this.set({ hasOlder: page.nextCursor !== null })
      this.persist()
      return true
    } catch (error) {
      return this.failed(error, 'history')
    }
  }

  private readHistory(cursor: string | null, limit: number): Promise<CcrEventPage> {
    return readCcrHistoryPage(this.deps, this.accountId, this.sessionId, cursor, limit)
  }

  /** Records a failure in the state; false. */
  private failed(error: unknown, what: string): false {
    // After stop() `set` changes nothing; the line still says what happened.
    this.log(`${what} failed for session …${this.sessionId.slice(-6)}: ${reasonOf(error)}`)
    this.set({ phase: 'error', error: error instanceof CcrSignedOutError ? CCR_SIGNED_OUT_LINE : `Anthropic could not be read: ${reasonOf(error)}` })
    return false
  }

  private connect(): void {
    if (this.stopped || this.paused) {
      return
    }
    // One stream per link: whatever is still dialled closes before the next one opens.
    this.abort?.abort()
    const controller = new AbortController()
    this.abort = controller
    const generation = this.generation
    void (async () => {
      const auth = await this.deps.auth(this.accountId, this.refreshedAuth).catch(() => null)
      if (controller.signal.aborted || this.stopped || generation !== this.generation) {
        return
      }
      if (!auth) {
        this.set({ phase: 'error', error: CCR_SIGNED_OUT_LINE })
        return
      }
      const from = this.store.lastSequenceNum
      const now = this.deps.now ?? Date.now
      let openedAt: number | null = null
      // The back-off starts over only after a connection that moved the transcript on AND stayed
      // up (CCR_STREAM_STABLE_MS). Any frame was enough before: a server that sent one
      // `session_update` and closed was redialled every second for ever (review 2026-10-15).
      const settle = () => {
        if (openedAt !== null && this.store.lastSequenceNum > from && now() - openedAt >= CCR_STREAM_STABLE_MS) {
          this.reconnects = 0
        }
      }
      try {
        const end = await readCcrEventStream({
          fetch: this.deps.streamFetch,
          auth,
          sessionId: this.sessionId,
          fromSequenceNum: from,
          signal: controller.signal,
          onOpen: () => {
            openedAt = now()
            this.refreshedAuth = false
            this.set({ phase: 'live', error: null })
          },
          onFrame: (frame) => this.onFrame(frame, from)
        })
        if (end === 'aborted' || this.stopped) {
          return
        }
        settle()
        this.scheduleReconnect('the stream ended')
      } catch (error) {
        if (controller.signal.aborted || this.stopped) {
          return
        }
        settle()
        if (error instanceof CcrApiError && error.reason === 'unauthorized' && !this.refreshedAuth) {
          // Read the sign-in afresh once (a token rotated since), then connect again at once.
          this.refreshedAuth = true
          this.connect()
          return
        }
        // Refusals are not retried, as the app does not (ujw: 401, 403 and 404 end the stream).
        if (error instanceof CcrApiError && error.reason !== 'network' && error.reason !== 'http') {
          this.failed(error, 'stream')
          return
        }
        this.scheduleReconnect(reasonOf(error))
      }
    })()
  }

  private onFrame(frame: CcrStreamFrame, from: number): void {
    switch (frame.kind) {
      case 'event':
        if (this.add([frame.event])) {
          this.set({})
          this.persistSoon()
        }
        return
      case 'truncated':
        // The catch-up after `from` was cut: page back from the newest until the gap closes.
        void this.fillGap(from)
        return
      case 'connection':
        this.set({ connectionStatus: frame.status })
        return
      case 'skipped':
        this.skippedFrames += 1
        this.log(`skipped a ${frame.event} frame (${frame.reason}); ${this.skippedFrames} so far`)
        return
      case 'ephemeral':
      case 'ignored':
        return
      default: {
        const unhandled: never = frame
        return unhandled
      }
    }
  }

  /** The catch-up after `from` was cut: pages back from the newest until a page reaches `from`. */
  private async fillGap(from: number): Promise<void> {
    const oldest = (page: CcrEventPage) => page.events.reduce((min, event) => Math.min(min, event.sequenceNum ?? min), Number.MAX_SAFE_INTEGER)
    await this.walkBack(null, CCR_FIRST_PAGE_EVENTS, (page) => oldest(page) <= from, 'filling the gap after a truncated catch-up')
  }

  /** Pages back from `cursor` until `stop(page)`, the history's start or the page cap. The last
   *  page read, or null when one failed (logged, never thrown). */
  private async walkBack(cursor: string | null, limit: number, stop: (page: CcrEventPage) => boolean, what: string): Promise<CcrEventPage | null> {
    try {
      return await walkCcrHistory((at) => this.readHistory(at, limit), cursor, (page) => {
        if (this.add(page.events)) {
          this.set({})
          this.persist()
        }
        return this.stopped || stop(page)
      })
    } catch (error) {
      if (error instanceof CcrSignedOutError) {
        this.set({ phase: 'error', error: CCR_SIGNED_OUT_LINE })
      }
      this.log(`${what} failed: ${reasonOf(error)}`)
      return null
    }
  }

  private scheduleReconnect(why: string): void {
    const wait = CCR_STREAM_RECONNECT_MS[this.reconnects]
    if (wait === undefined) {
      this.log(`stream lost for session …${this.sessionId.slice(-6)} after ${this.reconnects} reconnects: ${why}`)
      this.set({ phase: 'lost', error: 'Lost the connection to Anthropic. It reconnects when the phone is back online.' })
      return
    }
    this.reconnects += 1
    this.set({ phase: 'reconnecting' })
    this.cancelTimer = (this.deps.setTimer ?? defaultCcrTimer)(() => {
      this.cancelTimer = null
      this.connect()
    }, wait)
  }

  /** Older history (scroll to the start): the page before the oldest held. With no cursor kept (a
   *  copy cut to its newest events), walks back from the newest page past what is held. Either
   *  way it stops only once a row OLDER than the oldest drawn is held (or at the start, or the page
   *  cap): a newest page's undrawn system events are new to a kept copy, and stopping on them drew
   *  nothing older on a cold start's first scroll to the top (review 2026-10-15). */
  async loadOlder(): Promise<void> {
    if (this.stopped || this.state.loadingOlder || !this.state.hasOlder) {
      return
    }
    this.set({ loadingOlder: true })
    const oldest = this.store.oldestDrawingSequence()
    const last = await this.walkBack(this.olderCursor, CCR_OLDER_PAGE_EVENTS, (page) => {
      this.olderCursor = page.nextCursor
      return this.store.drawsOlderThan(oldest)
    }, 'older page')
    this.set({ loadingOlder: false, ...(last ? { hasOlder: last.nextCursor !== null } : {}) })
    this.persist()
  }

  /** A relay reconnect: a lost stream (or an error) tries again now. */
  retry(): void {
    if (!this.stopped && this.started && !this.paused && (this.state.phase === 'lost' || this.state.phase === 'error')) {
      this.restart()
    }
  }

  /** The app went to the background: the stream closes, and no redial waits, until `resume()`. */
  pause(): void {
    if (this.stopped || this.paused) {
      return
    }
    this.paused = true
    this.generation += 1
    this.cancelTimer?.()
    this.cancelTimer = null
    this.abort?.abort()
    this.abort = null
    this.flushPersist()
  }

  /** The app is back in front: a paused stream resumes after the last sequence held, and a lost
   *  one (or an error) tries again. */
  resume(): void {
    const wasPaused = this.paused
    this.paused = false
    if (this.stopped || !this.started) {
      return
    }
    if (wasPaused || this.state.phase === 'lost' || this.state.phase === 'error') {
      this.restart()
    }
  }

  private restart(): void {
    this.generation += 1
    this.reconnects = 0
    this.refreshedAuth = false
    this.cancelTimer?.()
    this.cancelTimer = null
    this.abort?.abort()
    void this.open()
  }

  /** Stops the stream and timers for good, a pending write too (flushPersist() first to keep it);
   *  the registry wipes the kept copy on a sign-out. */
  stop(): void {
    this.stopped = true
    this.generation += 1
    this.abort?.abort()
    this.cancelTimer?.()
    this.cancelTimer = null
    this.keptCopy.cancel()
    this.listeners.clear()
  }
}
