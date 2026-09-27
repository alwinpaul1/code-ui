import type {
  ConnectionLogEntry,
  ConnectionState,
  MobileConnectionDiagnosticPath
} from '../transport/types'

/**
 * The Network diagnostics timeline, as rows.
 *
 * Reported 2026-09-27: the header said "connected · healthy via Relay" while the visible tail of
 * the log was nothing but LAN failures. A healthy relay goes quiet after "migrated to relay", and
 * the direct path's retry loop writes four lines a try (closed, a relay deferral, scheduled,
 * reconnecting) for as long as the LAN is unreachable. So the screen pins the live state above the
 * list, and folds each run of direct-path retries into one row that can be opened.
 */

export type LiveConnectionRow = {
  tone: 'success' | 'warning' | 'danger'
  text: string
}

export type TimelineRow =
  | { kind: 'entry'; key: string; entry: ConnectionLogEntry; client: number | null }
  | {
      kind: 'direct-failures'
      key: string
      /** When the first folded failure happened. */
      ts: number
      text: string
      client: number | null
      entries: ConnectionLogEntry[]
    }

/** 24-hour local wall clock, HH:MM:SS. Built by hand: toLocale* follows the browser's locale,
 *  not the app's, and this line is read beside timestamps copied from other devices. */
export function formatClock(ts: number): string {
  const date = new Date(ts)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

/** The clock alone for a time today, and an ISO date before it otherwise: "since 09:12:00" read
 *  on the next morning names the wrong day, and a day-first or month-first date is ambiguous. */
function formatWhen(ts: number, nowMs: number): string {
  const date = new Date(ts)
  const now = new Date(nowMs)
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return formatClock(ts)
  }
  const day = [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
  return `${day} ${formatClock(ts)}`
}

function pathName(path: MobileConnectionDiagnosticPath): string {
  switch (path) {
    case 'relay':
      return 'Relay'
    case 'lan':
      return 'Wi-Fi'
    case 'tailscale':
      return 'Tailscale'
    default: {
      const unhandled: never = path
      return unhandled
    }
  }
}

/** What a client that is not connected is doing instead, for the pinned row. */
function notConnectedActivity(state: Exclude<ConnectionState, 'connected'>): string | null {
  switch (state) {
    case 'disconnected':
      return null
    case 'connecting':
    case 'handshaking':
      return 'connecting'
    case 'reconnecting':
      return 'reconnecting'
    case 'auth-failed':
      return 'the desktop rejected this device'
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

function isDirectPath(entry: ConnectionLogEntry): boolean {
  return entry.path === 'lan' || entry.path === 'tailscale'
}

/** A direct session authenticated. Older entries carry no code, only the message. */
function isDirectConnected(entry: ConnectionLogEntry): boolean {
  return (
    entry.code === 'direct-connected' ||
    (entry.code === undefined && entry.message === 'Authenticated' && isDirectPath(entry))
  )
}

const SESSION_DROP_CODES = new Set<ConnectionLogEntry['code']>([
  'socket-closed',
  'liveness-timeout',
  'relay-session-failed'
])

/**
 * When the current outage began: the first drop, after the last connection in this app session,
 * on the path that connection used. Only that path counts, since LAN closes under a live relay
 * are not the relay dropping; and nothing before `client-session-started` counts, since a drop
 * from yesterday's session is not when today's outage began.
 */
function droppedAt(entries: readonly ConnectionLogEntry[]): number | null {
  const session = entries.slice(
    entries.findLastIndex((entry) => entry.code === 'client-session-started') + 1
  )
  const connectedIndex = session.findLastIndex(
    (entry) => entry.code === 'relay-connected' || isDirectConnected(entry)
  )
  const connected = session[connectedIndex]
  if (connected === undefined) {
    return null
  }
  const path: MobileConnectionDiagnosticPath =
    connected.code === 'relay-connected' ? 'relay' : (connected.path ?? 'lan')
  const drop = session
    .slice(connectedIndex + 1)
    .find((entry) => entry.path === path && SESSION_DROP_CODES.has(entry.code))
  return drop?.ts ?? null
}

/** The row pinned above the timeline: what the host's live client says right now. */
export function liveConnectionRow(args: {
  state: ConnectionState
  activePath: MobileConnectionDiagnosticPath
  lastConnectedAt: number | null
  entries: readonly ConnectionLogEntry[]
  nowMs: number
}): LiveConnectionRow {
  const { state, activePath, lastConnectedAt, entries, nowMs } = args
  if (state === 'connected') {
    const since = lastConnectedAt === null ? '' : ` since ${formatWhen(lastConnectedAt, nowMs)}`
    return { tone: 'success', text: `Connected via ${pathName(activePath)}${since}` }
  }
  const activity = notConnectedActivity(state)
  const tone = activity === 'connecting' || activity === 'reconnecting' ? 'warning' : 'danger'
  const drop = droppedAt(entries)
  const when =
    drop !== null
      ? ` since ${formatWhen(drop, nowMs)}`
      : lastConnectedAt !== null
        ? ` · last connected ${formatWhen(lastConnectedAt, nowMs)}`
        : ''
  return { tone, text: `Not connected${when}${activity === null ? '' : ` · ${activity}`}` }
}

/**
 * Which client wrote an entry: `clientGeneration`, a per-host ordinal from 1 that the transport
 * adds as an optional field. Read defensively, since older entries and older builds lack it.
 */
export function entryClient(entry: ConnectionLogEntry): number | null {
  const generation = (entry as { clientGeneration?: unknown }).clientGeneration
  return typeof generation === 'number' && Number.isInteger(generation) && generation > 0
    ? generation
    : null
}

const DIRECT_FAILURE_CODES = new Set<ConnectionLogEntry['code']>([
  'socket-closed',
  'connect-timeout',
  'handshake-timeout',
  'liveness-timeout'
])

/** A line of the direct path's own retry loop. Anything that succeeded (a socket that opened, an
 *  authentication) is never one, and neither is an error of any other kind. */
function isDirectRetryLine(entry: ConnectionLogEntry): boolean {
  if (!isDirectPath(entry) || entry.level === 'success') {
    return false
  }
  return (
    DIRECT_FAILURE_CODES.has(entry.code) ||
    entry.code === 'retry-scheduled' ||
    (entry.code === undefined && /^(Reconnecting \(attempt|Opening WebSocket)/.test(entry.message))
  )
}

/** The relay's "recovery deferred by cooldown or gate", written after every direct close. While
 *  the relay is up it says only that the relay did not re-dial over a LAN close, so it folds with
 *  the retries; while the relay is down it is the relay's own recovery waiting, and stays in view. */
function isRelayDeferral(entry: ConnectionLogEntry): boolean {
  return (
    entry.path === 'relay' && entry.level === 'info' && /recovery deferred/i.test(entry.message)
  )
}

/** Whether the relay is carrying the session after this entry, as far as the log says. */
function relayUpAfter(up: boolean, entry: ConnectionLogEntry): boolean {
  if (entry.code === 'relay-connected') {
    return true
  }
  if (
    entry.code === 'relay-session-failed' ||
    entry.code === 'relay-dial-failed' ||
    entry.code === 'relay-credential-unavailable' ||
    entry.code === 'client-session-started' ||
    (entry.path === 'relay' && SESSION_DROP_CODES.has(entry.code))
  ) {
    return false
  }
  return up
}

function formatRetry(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`
  }
  const seconds = ms / 1000
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`
}

function retryDelayMs(entry: ConnectionLogEntry): number {
  return Number(/in (\d+)ms/.exec(entry.message)?.[1] ?? Number.NaN)
}

/** What the loop does next: "retrying every N s" once the backoff has settled, "next retry in N s"
 *  while it is still climbing, "stopped retrying" when the last close gave up. */
function nextRetry(run: readonly ConnectionLogEntry[], lastFailure: ConnectionLogEntry): string {
  const delays = run
    .filter((entry) => entry.code === 'retry-scheduled')
    .map((entry) => ({ entry, ms: retryDelayMs(entry) }))
    .filter(({ ms }) => !Number.isNaN(ms))
  const last = delays[delays.length - 1]
  if (last === undefined || run.indexOf(last.entry) < run.indexOf(lastFailure)) {
    return /probe gave up/.test(lastFailure.detail ?? '') ? ', stopped retrying' : ''
  }
  const previous = delays[delays.length - 2]
  return previous?.ms === last.ms
    ? `, retrying every ${formatRetry(last.ms)}`
    : `, next retry in ${formatRetry(last.ms)}`
}

/** An entry's identity in the timeline: its id and time, since ids are not unique on their own. */
export function entryKey(entry: ConnectionLogEntry): string {
  return `${entry.id}@${entry.ts}`
}

function entryRow(entry: ConnectionLogEntry): TimelineRow {
  return { kind: 'entry', key: entryKey(entry), entry, client: entryClient(entry) }
}

/** One client's consecutive retry lines, folded when they hold two failures or more. */
function foldRun(run: readonly ConnectionLogEntry[], client: number | null): TimelineRow[] {
  const direct = run.filter(isDirectPath)
  const closes = direct.filter((entry) => entry.code === 'socket-closed')
  // A timeout closes its socket, which writes its own close; count timeouts only where no close
  // was written at all.
  const failures =
    closes.length > 0 ? closes : direct.filter((entry) => DIRECT_FAILURE_CODES.has(entry.code))
  const first = failures[0]
  const last = failures[failures.length - 1]
  if (failures.length < 2 || first === undefined || last === undefined) {
    return run.map(entryRow)
  }
  const path = direct[0]?.path === 'tailscale' ? 'Tailscale' : 'Wi-Fi'
  return [
    {
      kind: 'direct-failures',
      key: `fold:${client ?? '-'}:${entryKey(first)}`,
      ts: first.ts,
      text: `Direct ${path} path: ${failures.length} failed attempts, ${formatClock(first.ts)}–${formatClock(last.ts)}${nextRetry(run, last)}`,
      client,
      entries: [...run]
    }
  ]
}

/**
 * The timeline rows, oldest first, in the log's own order.
 *
 * Only consecutive retry lines from ONE client fold together; a line from another client ends the
 * run, so two interleaved clients stay in time order, each row labelled with its client. A relay
 * deferral joins whatever run it lands in and never starts or ends one on its client's account.
 *
 * The drop that ends a live direct session is never folded: after a direct authentication, that
 * client's next health-check failure or close (and the close that follows a failed health check)
 * stays in view, and only the retries after it count as failed attempts.
 */
export function buildConnectionTimeline(entries: readonly ConnectionLogEntry[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  let run: ConnectionLogEntry[] = []
  /** The client of the run's first direct line; a deferral alone does not set it. */
  let runClient: number | null | undefined
  let relayUp = false
  const liveDirect = new Set<number | null>()
  const dropping = new Set<number | null>()

  const flush = (): void => {
    if (run.length > 0) {
      rows.push(...foldRun(run, runClient ?? null))
    }
    run = []
    runClient = undefined
  }

  for (const entry of entries) {
    relayUp = relayUpAfter(relayUp, entry)
    const client = entryClient(entry)
    if (isDirectConnected(entry)) {
      liveDirect.add(client)
      dropping.delete(client)
    } else if (
      isDirectPath(entry) &&
      DIRECT_FAILURE_CODES.has(entry.code) &&
      (liveDirect.has(client) || dropping.has(client))
    ) {
      // The end of a working session, not a failed attempt.
      liveDirect.delete(client)
      dropping.add(client)
      flush()
      rows.push(entryRow(entry))
      continue
    } else if (isDirectPath(entry)) {
      dropping.delete(client)
    }

    if (isRelayDeferral(entry) && relayUp) {
      run.push(entry)
      continue
    }
    if (isDirectRetryLine(entry)) {
      if (runClient !== undefined && runClient !== client) {
        flush()
      }
      runClient = client
      run.push(entry)
      continue
    }
    flush()
    rows.push(entryRow(entry))
  }
  flush()
  return withUniqueKeys(rows)
}

/** The log can hold one entry twice (a replayed buffer); each copy still needs its own key. */
function withUniqueKeys(rows: TimelineRow[]): TimelineRow[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const count = seen.get(row.key) ?? 0
    seen.set(row.key, count + 1)
    return count === 0 ? row : { ...row, key: `${row.key}:${count}` }
  })
}
