import { CcrApiError, listCcrSessionEvents, type CcrEvent, type CcrEventPage } from './ccr-session-api'
import { readCcrEventStream, type CcrStreamFrame } from './ccr-event-stream'
import { bySequence, CCR_FIRST_PAGE_EVENTS, CCR_OLDER_PAGE_EVENTS, CCR_STREAM_RECONNECT_MS, ccrEventKey, defaultCcrTimer, type CcrLinkAuth, type CcrLinkDeps, type CcrLinkState } from './ccr-session-link-types'
import { CCR_MAX_EVENT_PAGES, reasonOf } from './ccr-session-shared'
import { readCcrTranscript, writeCcrTranscript } from './ccr-transcript-persist'
import { storeCcrImages } from './ccr-session-cache'
import { ccrEventDrawsRow, ccrKeptImages, slimCcrEvent } from './ccr-transcript-decode'

export { CCR_FIRST_PAGE_EVENTS, CCR_OLDER_PAGE_EVENTS, CCR_STREAM_RECONNECT_MS, type CcrLinkAuth, type CcrLinkDeps, type CcrLinkPhase, type CcrLinkState } from './ccr-session-link-types'

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
  private readonly byKey = new Map<string, CcrEvent>()
  private ordered: CcrEvent[] = []
  private lastSequenceNum = 0
  private olderCursor: string | null = null
  private state: CcrLinkState
  private readonly listeners = new Set<() => void>()
  private abort: AbortController | null = null
  private cancelTimer: (() => void) | null = null
  private reconnects = 0
  private stopped = false
  private started = false
  private refreshedAuth = false
  private skippedFrames = 0

  constructor(accountId: string, sessionId: string, deps: CcrLinkDeps) {
    this.accountId = accountId
    this.sessionId = sessionId
    this.deps = deps
    this.state = { events: [], phase: 'idle', error: null, hasOlder: true, loadingOlder: false, connectionStatus: null, version: 0 }
    const kept = readCcrTranscript(accountId, sessionId)
    if (kept) {
      this.add(kept.events, false)
      this.lastSequenceNum = Math.max(this.lastSequenceNum, kept.lastSequenceNum)
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

  /** Adds events (already slim or not); true when any was new. */
  private add(events: readonly CcrEvent[], slim = true): boolean {
    let added = false
    for (const raw of events) {
      const key = ccrEventKey(raw)
      if (!key || this.byKey.has(key)) {
        if (raw.sequenceNum != null && raw.sequenceNum > this.lastSequenceNum) {
          this.lastSequenceNum = raw.sequenceNum
        }
        continue
      }
      const event = slim ? slimCcrEvent(raw, this.deps.keep) : raw
      this.byKey.set(key, event)
      const kept = ccrKeptImages(event)
      if (kept.tool.size + kept.user.size > 0) {
        storeCcrImages(kept.tool, kept.user)
      }
      if (event.sequenceNum != null && event.sequenceNum > this.lastSequenceNum) {
        this.lastSequenceNum = event.sequenceNum
      }
      added = true
    }
    if (added) {
      this.ordered = [...this.byKey.values()].sort(bySequence)
    }
    return added
  }

  private persist(): void {
    writeCcrTranscript({
      accountId: this.accountId,
      sessionId: this.sessionId,
      events: this.ordered.filter(ccrEventDrawsRow),
      lastSequenceNum: this.lastSequenceNum,
      olderCursor: this.olderCursor,
      hasOlder: this.state.hasOlder
    })
  }

  /** Starts reading: the newest page when nothing is held, then the stream. Idempotent. */
  start(): void {
    if (this.started || this.stopped) {
      return
    }
    this.started = true
    void this.open()
  }

  private async open(): Promise<void> {
    if (this.ordered.length === 0) {
      this.set({ phase: 'loading', error: null })
      if (!(await this.readPage(null))) {
        return
      }
      // As the app does: a newest page with nothing to draw (all `system`) pages back until one
      // does, up to CCR_MAX_EVENT_PAGES.
      for (let page = 1; page < CCR_MAX_EVENT_PAGES && this.state.hasOlder && !this.ordered.some(ccrEventDrawsRow); page++) {
        await this.loadOlder()
      }
    }
    this.connect()
  }

  /** One history page, newest first from `cursor`; false when it failed (the state says why). */
  private async readPage(cursor: string | null): Promise<boolean> {
    const auth = await this.auth()
    if (!auth) {
      return false
    }
    try {
      const page = await listCcrSessionEvents(this.deps.fetch, auth, this.sessionId, { cursor, limit: CCR_FIRST_PAGE_EVENTS })
      if (this.stopped) {
        return false
      }
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

  private async auth(): Promise<CcrLinkAuth | null> {
    const auth = await this.deps.auth(this.accountId, false).catch(() => null)
    if (!auth) {
      this.set({ phase: 'error', error: 'This account is signed out on this phone. Sign in to it again in Anthropic accounts.' })
    }
    return this.stopped ? null : auth
  }

  /** Records a failure in the state; false. A 401 re-reads the sign-in once before giving up. */
  private failed(error: unknown, what: string): false {
    // After stop() `set` changes nothing; the line still says what happened.
    this.log(`${what} failed for session …${this.sessionId.slice(-6)}: ${reasonOf(error)}`)
    this.set({ phase: 'error', error: `Anthropic could not be read: ${reasonOf(error)}` })
    return false
  }

  private connect(): void {
    if (this.stopped) {
      return
    }
    const controller = new AbortController()
    this.abort = controller
    void (async () => {
      const auth = await this.deps.auth(this.accountId, this.refreshedAuth).catch(() => null)
      if (controller.signal.aborted || this.stopped) {
        return
      }
      if (!auth) {
        this.set({ phase: 'error', error: 'This account is signed out on this phone. Sign in to it again in Anthropic accounts.' })
        return
      }
      const from = this.lastSequenceNum
      try {
        const end = await readCcrEventStream({
          fetch: this.deps.streamFetch,
          auth,
          sessionId: this.sessionId,
          fromSequenceNum: from,
          signal: controller.signal,
          onOpen: () => {
            this.refreshedAuth = false
            this.set({ phase: 'live', error: null })
          },
          onFrame: (frame) => {
            // The back-off starts over only once the stream has said something: a server that
            // accepts and closes at once would otherwise be redialled every second for ever.
            this.reconnects = 0
            this.onFrame(frame, from)
          }
        })
        if (end === 'aborted' || this.stopped) {
          return
        }
        this.scheduleReconnect('the stream ended')
      } catch (error) {
        if (controller.signal.aborted || this.stopped) {
          return
        }
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
          this.persist()
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
    for (let count = 0; count < CCR_MAX_EVENT_PAGES; count++) {
      const auth = await this.auth()
      if (!auth) {
        return null
      }
      try {
        const page = await listCcrSessionEvents(this.deps.fetch, auth, this.sessionId, { cursor, limit })
        if (this.add(page.events)) {
          this.set({})
          this.persist()
        }
        if (stop(page) || !page.nextCursor) {
          return page
        }
        cursor = page.nextCursor
      } catch (error) {
        this.log(`${what} failed: ${reasonOf(error)}`)
        return null
      }
    }
    return null
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
   *  copy cut to its newest events), walks back from the newest page past what is held. */
  async loadOlder(): Promise<void> {
    if (this.stopped || this.state.loadingOlder || !this.state.hasOlder) {
      return
    }
    this.set({ loadingOlder: true })
    const before = this.ordered.length
    const last = await this.walkBack(this.olderCursor, CCR_OLDER_PAGE_EVENTS, (page) => {
      this.olderCursor = page.nextCursor
      return this.ordered.length > before
    }, 'older page')
    this.set({ loadingOlder: false, ...(last ? { hasOlder: last.nextCursor !== null } : {}) })
    this.persist()
  }

  /** A relay reconnect or the app back in front: a lost stream (or an error) tries again now. */
  retry(): void {
    if (this.stopped || !this.started) {
      return
    }
    if (this.state.phase === 'lost' || this.state.phase === 'error') {
      this.reconnects = 0
      this.refreshedAuth = false
      this.cancelTimer?.()
      this.cancelTimer = null
      this.abort?.abort()
      void this.open()
    }
  }

  /** Stops the stream and timers for good; the registry wipes the kept copy on a sign-out. */
  stop(): void {
    this.stopped = true
    this.abort?.abort()
    this.cancelTimer?.()
    this.cancelTimer = null
    this.listeners.clear()
  }
}
