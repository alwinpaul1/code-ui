import {
  EMPTY_TRANSCRIPT_TAIL_STATE,
  readTranscriptTailRow,
  reduceTranscriptTail,
  type TranscriptTailState
} from './transcript-tail-records'
import {
  TRANSCRIPT_TAIL_TAB_TITLE,
  transcriptTailCommand,
  transcriptTailFileKey,
  type TranscriptTailFile
} from './transcript-tail-command'
import {
  transcriptTailTerminalCreate,
  transcriptTailTerminalRead,
  transcriptTailTerminalRename,
  type TranscriptTailSender
} from './transcript-tail-operations'
import { closeTerminal, forgetUndeliveredCloses, retryUndeliveredCloses } from './transcript-tail-closes'
import { recordTranscriptTailHandle } from './transcript-tail-ledger'

/**
 * One background host terminal per (host, transcript), shared by every
 * reader on the phone and closed when the last one lets go.
 *
 * Why a registry and not a hook-local terminal: the chat remounts on every
 * tab switch, and a terminal created and closed on each mount would churn
 * the desktop's tab strip and lose the rows between. Readers acquire and
 * release; the terminal outlives a quick switch away and back by
 * `CLOSE_GRACE_MS`.
 *
 * Why polling `terminal.read` with a cursor: the stream read is bounded and
 * pages, and the runtime keeps about a hundred rows behind the cursor
 * (measured 2026-09-19), so a read every `POLL_MS` never falls behind a turn.
 * The rows are what `transcript-tail-records.ts` reads.
 *
 * Two kinds of failure, kept apart on purpose. A request that REJECTS never
 * reached the host — the socket is down, the app is suspended, the client
 * was replaced — and says nothing about the terminal, so it counts for
 * nothing and the next connected client picks up where this one left off. A
 * request the host ANSWERS with a refusal is about the terminal: enough of
 * those in a row and it is presumed gone (the user closed the tab, the host
 * restarted), closed for good measure and reopened. Conflating the two
 * leaked a live `tail -F` tab on the desktop per background/foreground cycle
 * (review, 2026-09-19).
 *
 * A close that cannot be delivered is remembered per host and retried by the
 * next lease taken with a connected client, so a grace period that runs out
 * while the phone is offline still closes the tab later.
 */
export const TRANSCRIPT_TAIL_POLL_MS = 700
export const TRANSCRIPT_TAIL_CLOSE_GRACE_MS = 20_000
/** After a create the host refused, how long before a reader may try again. */
const RETRY_AFTER_FAILURE_MS = 60_000
/** Reads the host refuses in a row before the terminal is presumed gone. */
const READ_FAILURES_BEFORE_RECREATE = 5

export type TranscriptTailTarget = {
  hostId: string
  worktreeId: string
  file: TranscriptTailFile
  platform: 'win32' | 'posix'
}

export type TranscriptTailLease = {
  getState: () => TranscriptTailState
  subscribe: (listener: () => void) => () => void
  release: () => void
}

type Entry = {
  key: string
  target: TranscriptTailTarget
  client: TranscriptTailSender
  refs: number
  state: TranscriptTailState
  listeners: Set<() => void>
  handle: string | null
  cursor: number
  readFailures: number
  starting: Promise<void> | null
  failedAt: number | null
  pollTimer: ReturnType<typeof setTimeout> | null
  closeTimer: ReturnType<typeof setTimeout> | null
  /** A tick is awaiting the host; a re-acquire meanwhile must not start a second loop. */
  ticking: boolean
  closed: boolean
}

const entries = new Map<string, Entry>()
function keyOf(target: TranscriptTailTarget): string {
  return `${target.hostId}\u0000${transcriptTailFileKey(target.file)}`
}

function notify(entry: Entry): void {
  for (const listener of entry.listeners) {
    listener()
  }
}

async function start(entry: Entry): Promise<void> {
  const { target, client } = entry
  let response
  try {
    response = await transcriptTailTerminalCreate.request(client, {
      worktree: `id:${target.worktreeId}`,
      command: transcriptTailCommand(target.file, target.platform),
      title: TRANSCRIPT_TAIL_TAB_TITLE,
      activate: false,
      focus: false
    })
  } catch {
    // Never reached the host: nothing was created, nothing to back off from.
    return
  }
  let created
  try {
    created = transcriptTailTerminalCreate.interpret(response)
  } catch {
    created = null
  }
  if (!created) {
    entry.failedAt = Date.now()
    return
  }
  if (entry.closed) {
    // Released while the create was in flight: nothing reads it, close it.
    void closeTerminal(client, target.hostId, created.handle)
    return
  }
  entry.handle = created.handle
  void recordTranscriptTailHandle(target.hostId, created.handle)
  // The host adopts a phone-created terminal into its strip and names it
  // "Terminal N", dropping the title it was created with (device,
  // 2026-09-19). Name it again once it exists; best effort.
  void transcriptTailTerminalRename
    .request(client, { terminal: created.handle, title: TRANSCRIPT_TAIL_TAB_TITLE })
    .catch(() => undefined)
  // A fresh terminal replays `tail -n` backlog the previous one already
  // applied: the state starts over with it, or every replayed `enqueue`
  // would stand twice (prompts dedupe by uuid; the queue cannot).
  entry.cursor = 0
  entry.state = EMPTY_TRANSCRIPT_TAIL_STATE
  entry.readFailures = 0
  entry.failedAt = null
  notify(entry)
}

/** The queue and live call, forgotten. For when rows were dropped between
 *  reads: a missed `remove` would leave a phantom entry, a missed result a
 *  stale call. Prompts are kept; they are keyed and never retracted. */
function withoutLiveState(state: TranscriptTailState): TranscriptTailState {
  if (state.queue.length === 0 && state.pendingCalls.length === 0) {
    return state
  }
  return { ...state, queue: [], liveCall: null, pendingCalls: [] }
}

async function readOnce(entry: Entry): Promise<void> {
  const handle = entry.handle
  if (!handle) {
    return
  }
  let response
  try {
    response = await transcriptTailTerminalRead.request(entry.client, {
      terminal: handle,
      cursor: entry.cursor,
      limit: 200
    })
  } catch {
    // Never reached the host; the terminal is as it was.
    return
  }
  let read
  try {
    read = transcriptTailTerminalRead.interpret(response)
  } catch {
    entry.readFailures += 1
    if (entry.readFailures >= READ_FAILURES_BEFORE_RECREATE && entry.handle === handle) {
      entry.handle = null
      entry.readFailures = 0
      void closeTerminal(entry.client, entry.target.hostId, handle)
    }
    return
  }
  entry.readFailures = 0
  let state = entry.state
  if (read.oldestCursor !== null && read.oldestCursor > entry.cursor) {
    state = withoutLiveState(state)
  }
  for (const row of read.rows) {
    state = reduceTranscriptTail(state, readTranscriptTailRow(row))
  }
  entry.cursor = read.nextCursor ?? entry.cursor + read.rows.length
  if (state !== entry.state) {
    entry.state = state
    notify(entry)
  }
}

function schedule(entry: Entry): void {
  if (entry.closed || entry.pollTimer || entry.refs === 0) {
    return
  }
  entry.pollTimer = setTimeout(() => {
    entry.pollTimer = null
    void tick(entry)
  }, TRANSCRIPT_TAIL_POLL_MS)
}

async function tick(entry: Entry): Promise<void> {
  if (entry.closed || entry.ticking) {
    return
  }
  entry.ticking = true
  try {
    if (!entry.handle) {
      const canRetry =
        entry.failedAt === null || Date.now() - entry.failedAt >= RETRY_AFTER_FAILURE_MS
      if (canRetry) {
        entry.starting ??= start(entry).finally(() => {
          entry.starting = null
        })
        await entry.starting
      }
    } else {
      await readOnce(entry)
    }
  } finally {
    entry.ticking = false
    schedule(entry)
  }
}

function close(entry: Entry): void {
  entry.closed = true
  if (entry.pollTimer) {
    clearTimeout(entry.pollTimer)
    entry.pollTimer = null
  }
  entries.delete(entry.key)
  if (entry.handle) {
    const handle = entry.handle
    entry.handle = null
    void closeTerminal(entry.client, entry.target.hostId, handle)
  }
}

/** Take a lease on the tail of one transcript. The first lease opens the
 *  terminal; the last release closes it after a grace period. */
export function acquireTranscriptTail(
  client: TranscriptTailSender,
  target: TranscriptTailTarget
): TranscriptTailLease {
  retryUndeliveredCloses(client, target.hostId)
  const key = keyOf(target)
  let entry = entries.get(key)
  if (!entry) {
    entry = {
      key,
      target,
      client,
      refs: 0,
      state: EMPTY_TRANSCRIPT_TAIL_STATE,
      listeners: new Set(),
      handle: null,
      cursor: 0,
      readFailures: 0,
      starting: null,
      failedAt: null,
      pollTimer: null,
      closeTimer: null,
      ticking: false,
      closed: false
    }
    entries.set(key, entry)
  }
  // A newer client (a reconnect) replaces the one the terminal was opened
  // with; the handle is the host's and survives the socket. Whatever the old
  // client failed at says nothing about this one.
  if (entry.client !== client) {
    entry.client = client
    entry.failedAt = null
    entry.readFailures = 0
  }
  entry.refs += 1
  if (entry.closeTimer) {
    clearTimeout(entry.closeTimer)
    entry.closeTimer = null
  }
  if (entry.refs === 1) {
    void tick(entry)
  }
  const held = entry
  let released = false
  return {
    getState: () => held.state,
    subscribe: (listener) => {
      held.listeners.add(listener)
      return () => {
        held.listeners.delete(listener)
      }
    },
    release: () => {
      if (released) {
        return
      }
      released = true
      held.refs -= 1
      if (held.refs > 0) {
        return
      }
      // Nobody reads: stop polling now, keep the terminal for the grace.
      if (held.pollTimer) {
        clearTimeout(held.pollTimer)
        held.pollTimer = null
      }
      held.closeTimer = setTimeout(() => {
        held.closeTimer = null
        if (held.refs === 0) {
          close(held)
        }
      }, TRANSCRIPT_TAIL_CLOSE_GRACE_MS)
    }
  }
}

/** Close every tail now, whatever its refs. For a sign-out or a test. */
export function closeAllTranscriptTails(): void {
  // Snapshot first: close() deletes from the map being walked.
  const open = Array.from(entries.values())
  for (const entry of open) {
    if (entry.closeTimer) {
      clearTimeout(entry.closeTimer)
      entry.closeTimer = null
    }
    close(entry)
  }
}

export function resetTranscriptTailsForTests(): void {
  closeAllTranscriptTails()
  forgetUndeliveredCloses()
}

export function transcriptTailEntryCountForTests(): number {
  return entries.size
}

/** A read-only view of the registry for the ownership helpers
 *  (`transcript-tail-ownership.ts`). */
export function transcriptTailEntriesForOwnership(): Iterable<{
  handle: string | null
  starting: Promise<void> | null
}> {
  return entries.values()
}
