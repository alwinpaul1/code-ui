import { deriveMobileAiVaultScopePaths } from '../agent-history/agent-history-scope-paths'
import { agentHistorySessionScan } from '../agent-history/mobile-agent-history-operations'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import type { RpcClient } from '../transport/rpc-client'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import { worktreePathFromId } from './mobile-native-chat-skill-browse'
import { claudeTranscriptModelName, listsClaudeSession, transcriptModelForSession, type ScannedTranscriptModel } from './claude-transcript-model'
import { createPersistedMap } from './session-cache-persistence'

/**
 * The host session scan behind the model pills of a Claude session that states
 * no model itself (claude-transcript-model.ts says why this is the source).
 *
 * `aiVault.listSessions` is not a cheap read. Past the host's 60 s cache it
 * starts a scan of every agent's session store on that machine — WSL homes
 * too, on Windows — and the host keeps ONE cache slot for it
 * (cached-session-list.ts, origin/main 8d6fec597b). So the phone never drives
 * regular scans on the user's desktop:
 *
 * - at most one attempt per project folder per five minutes, failed ones
 *   included, so a failing host is not asked again straight away, and at most
 *   `CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL` attempts per host in any
 *   five minutes across its folders, so a phone opening many projects cannot
 *   drive the host's scans. The budget was per HOST until 2026-10-09, while
 *   each scan asks for one folder: a scan of project A held back project B's
 *   for five minutes and B's pill stayed blank. A scan the host cap holds back
 *   runs by itself once the host has room, if a chat still wants this host;
 * - `force: false`, answering from the host's cache when it can, except for
 *   the one scan that must confirm a model switch (below);
 * - the history screen's own workspace scope, so the two share that cache.
 *
 * The limit is small because only one row is wanted; the host still includes
 * the in-scope sessions up to it, and the session in front of the user is the
 * newest in its own folder. A cached deeper list (the history screen asks for
 * 500) covers this request; the reverse costs that screen one scan.
 *
 * A reading speaks for the transcript as of `freshAsOf`: a forced scan reads
 * the files when asked, while an unforced one may be answered from a list the
 * host cached up to a minute before. The scan that confirms a switch is forced,
 * because a list cached from before the confirming turn would still name the
 * old model; when the budget holds it back, it runs by itself (still forced)
 * once the five minutes are up, if a chat still wants this host.
 *
 * A reading for a session is taken from whichever scan of its host lists it,
 * the freshest if several do.
 *
 * A failure of any kind — refused, timed out, not a session list — leaves one
 * log line naming the host and the reason, and keeps whatever the last good
 * scan said (nothing, if there was none): one bad answer does not blank a pill
 * that was right. The budget does not hold a failure for long. The next NEW
 * connection asks once more even inside the five minutes (CLAUDE.md, "Nothing
 * stays stale once the relay connects", through `shouldRefetchAfterReconnect`),
 * and once the five minutes are up the scan runs by itself, if a chat still
 * wants this host.
 *
 * The scan's rows live in memory, so a relaunched app had nothing to say until
 * the host answered again, and the pill sat blank for those seconds on every
 * launch (2026-10-09). The READING for each session shown is kept on the phone
 * too (`codeui:chat-transcript-models`, 32 sessions, fail-open both ways): the
 * host's model id, its name, and how recent a transcript it speaks for. It is
 * the source reading, never the pill: every tier above it (the live pair, the
 * screen, the command rows, the startup frame) is laid over it exactly as over
 * a reading this run took, and `freshAsOf` keeps its real age, so a reply newer
 * than it still supersedes it. A remembered reading stands until a scan that
 * LISTS the session replaces it: each scan is asked for one folder and 20 rows,
 * so a scan of another project on the same host says nothing about this one
 * (review, 2026-10-09).
 */
export const CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS = 5 * 60_000
/** How old a list the host may answer an unforced scan with: Orca's
 *  AI_VAULT_CACHE_TTL_MS (cached-session-list.ts, origin/main 8d6fec597b). */
export const HOST_SESSION_LIST_CACHE_MS = 60_000
/** Scans one host is asked for in any five minutes, across all its folders. */
export const CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL = 4
const SCAN_LIMIT = 20
// The scan walks the host's session stores; a cold Windows host with WSL
// homes can take a while, and nothing waits on this but a pill.
const SCAN_TIMEOUT_MS = 30_000

type ScopeScan = {
  hostId: string
  attemptedAt: number
  /** The last attempt failed. */
  failed: boolean
  /** How recent a transcript the rows speak for (the phone's clock). */
  freshAsOf: number | null
  /** The rows of the last scan that succeeded, kept through failures. */
  rows: readonly unknown[]
}

/** A scan the budget held back — one that must confirm a switch, the retry
 *  after a failure, or one the host cap held — run by itself when the budget
 *  allows. */
type DeferredScan = {
  timer: ReturnType<typeof setTimeout>
  client: RpcClient
  hostId: string
  worktreeId: string
  force: boolean
}

/** Per host and project folder (`scopeKeyFor`). */
const scans = new Map<string, ScopeScan>()
/** Per host, when each attempt in the last five minutes went out. */
const hostAttempts = new Map<string, number[]>()

/** What the host last said about one session, kept across launches. */
type RememberedReading = { hostId: string; model: string; label: string; freshAsOf: number }

const remembered = createPersistedMap<RememberedReading>({
  storageKey: 'codeui:chat-transcript-models',
  maxEntries: 32
})

/** A stored entry is read back only when it has every field a reading has; a
 *  malformed one is skipped, as if nothing were kept. */
function rememberedReading(hostId: string, sessionId: string): ScannedTranscriptModel | null {
  const entry = remembered.get(sessionId) as Partial<RememberedReading> | null | undefined
  if (
    entry == null ||
    typeof entry !== 'object' ||
    entry.hostId !== hostId ||
    typeof entry.model !== 'string' ||
    typeof entry.label !== 'string' ||
    typeof entry.freshAsOf !== 'number' ||
    !Number.isFinite(entry.freshAsOf) ||
    claudeTranscriptModelName(entry.model) === null
  ) {
    return null
  }
  return { model: entry.model, label: entry.label, freshAsOf: entry.freshAsOf }
}

function remember(hostId: string, sessionId: string, reading: ScannedTranscriptModel): void {
  const held = remembered.get(sessionId)
  if (
    held?.hostId === hostId &&
    held.model === reading.model &&
    held.label === reading.label &&
    held.freshAsOf === reading.freshAsOf
  ) {
    return
  }
  remembered.set(sessionId, { hostId, model: reading.model, label: reading.label, freshAsOf: reading.freshAsOf })
}

/** Read at app start with the other session caches; never rejects. */
export function hydrateClaudeTranscriptModelReadings(): Promise<void> {
  return remembered.hydrate().then(notify)
}
const deferred = new Map<string, DeferredScan>()
const watchers = new Map<string, number>()
const listeners = new Set<() => void>()
/** Which connection each host's failed scan happened on. */
const failedOn = createStaleAfterReconnectLedger()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribeClaudeTranscriptModelScans(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A chat that may show this host's reading is on screen. A deferred scan runs
 *  only while one is: with none, the next chat to open asks for itself. */
export function watchClaudeTranscriptModelHost(hostId: string): () => void {
  watchers.set(hostId, (watchers.get(hostId) ?? 0) + 1)
  return () => {
    const left = (watchers.get(hostId) ?? 1) - 1
    if (left > 0) {
      watchers.set(hostId, left)
    } else {
      watchers.delete(hostId)
    }
  }
}

export function resetClaudeTranscriptModelScansForTests(): void {
  for (const pending of deferred.values()) {
    clearTimeout(pending.timer)
  }
  scans.clear()
  hostAttempts.clear()
  remembered.reset()
  deferred.clear()
  watchers.clear()
  listeners.clear()
  failedOn.clear()
}

/** What the last scan of this host says about one session, with how recent a
 *  transcript it speaks for, or null. When no scan of the host has succeeded in
 *  this run, or the last one does not list the session, the reading kept from
 *  an earlier one (this run or before the app was last closed). */
export function peekClaudeTranscriptModel(
  hostId: string,
  sessionId: string
): ScannedTranscriptModel | null {
  // A scan that does not list the session (another folder, past its 20 rows)
  // says nothing about it; one that lists it replaces what was kept.
  let scan: ScopeScan | null = null
  for (const candidate of scans.values()) {
    if (
      candidate.hostId === hostId &&
      candidate.freshAsOf !== null &&
      (scan === null || candidate.freshAsOf > (scan.freshAsOf ?? -Infinity)) &&
      listsClaudeSession(candidate.rows, sessionId)
    ) {
      scan = candidate
    }
  }
  if (scan?.freshAsOf == null) {
    return rememberedReading(hostId, sessionId)
  }
  const reading = transcriptModelForSession(scan.rows, sessionId)
  if (reading === null) {
    return null
  }
  const scanned = { ...reading, freshAsOf: scan.freshAsOf }
  remember(hostId, sessionId, scanned)
  return scanned
}

/** The history screen's workspace scope for this worktree: its folder, or no
 *  scope (the host's recency list) when the id names no absolute folder. */
function scopePathsFor(worktreeId: string): string[] {
  const path = worktreePathFromId(worktreeId)
  return path
    ? deriveMobileAiVaultScopePaths('workspace', { worktreeId, path, repoId: '' }, [])
    : []
}

/** The budget's key: the host and the folder the scan asks for. */
function scopeKeyFor(hostId: string, worktreeId: string): string {
  return `${hostId}\u0000${JSON.stringify(scopePathsFor(worktreeId))}`
}

/** The attempts this host has had in the five minutes before `now`. */
function recentHostAttempts(hostId: string, now: number): number[] {
  const recent = (hostAttempts.get(hostId) ?? []).filter(
    (at) => now - at < CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS
  )
  hostAttempts.set(hostId, recent)
  return recent
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One scan waiting per host and folder; a forced one is never downgraded. */
function deferScan(
  client: RpcClient,
  hostId: string,
  worktreeId: string,
  delayMs: number,
  force: boolean
): void {
  const key = scopeKeyFor(hostId, worktreeId)
  const waiting = deferred.get(key)
  if (waiting) {
    waiting.force ||= force
    return
  }
  const entry: DeferredScan = {
    client,
    hostId,
    worktreeId,
    force,
    timer: setTimeout(() => {
      deferred.delete(key)
      if ((watchers.get(hostId) ?? 0) > 0) {
        void requestClaudeTranscriptModelScan(entry.client, hostId, entry.worktreeId, {
          force: entry.force
        })
      }
    }, Math.max(0, delayMs))
  }
  deferred.set(key, entry)
}

export async function requestClaudeTranscriptModelScan(
  client: RpcClient,
  hostId: string,
  worktreeId: string,
  options: {
    force?: boolean
    /** The host's `lastConnectedAt`: a failed scan is asked again once per new one. */
    connection?: number | null
    now?: number
  } = {}
): Promise<'scanned' | 'throttled' | 'failed'> {
  const now = options.now ?? Date.now()
  const connection = options.connection ?? null
  const key = scopeKeyFor(hostId, worktreeId)
  const last = scans.get(key)
  const retryOnNewConnection =
    last?.failed === true && shouldRefetchAfterReconnect(failedOn, key, 'error', connection)
  if (last && now - last.attemptedAt < CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS && !retryOnNewConnection) {
    if (options.force) {
      deferScan(client, hostId, worktreeId, last.attemptedAt + CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS - now, true)
    }
    return 'throttled'
  }
  // The host's cap, across its folders: held back, the scan runs by itself
  // once the oldest attempt in the window has aged out, if a chat still wants it.
  const recent = recentHostAttempts(hostId, now)
  if (recent.length >= CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL) {
    deferScan(client, hostId, worktreeId, recent[0]! + CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS - now, options.force === true)
    return 'throttled'
  }
  // A forced scan still waiting is served by this one, which reads fresh too.
  const waiting = deferred.get(key)
  if (waiting) {
    clearTimeout(waiting.timer)
    deferred.delete(key)
  }
  const force = options.force === true || waiting?.force === true
  recent.push(now)
  // Stamped before the request goes out, so a second caller while this one is
  // in flight is held off too. What the last success said stands meanwhile.
  scans.set(key, {
    hostId,
    attemptedAt: now,
    failed: last?.failed ?? false,
    freshAsOf: last?.freshAsOf ?? null,
    rows: last?.rows ?? []
  })
  try {
    const reply = await agentHistorySessionScan.request(
      client,
      { limit: SCAN_LIMIT, force, scopePaths: scopePathsFor(worktreeId) },
      { timeoutMs: SCAN_TIMEOUT_MS }
    )
    const result = interpretOrThrowRefusalMessage(
      () => agentHistorySessionScan.interpret(reply),
      'the host sent no session list'
    )
    scans.set(key, {
      hostId,
      attemptedAt: now,
      failed: false,
      freshAsOf: force ? now : now - HOST_SESSION_LIST_CACHE_MS,
      rows: result.sessions
    })
    shouldRefetchAfterReconnect(failedOn, key, 'ready', connection)
    notify()
    return 'scanned'
  } catch (error) {
    scans.set(key, {
      hostId,
      attemptedAt: now,
      failed: true,
      freshAsOf: last?.freshAsOf ?? null,
      rows: last?.rows ?? []
    })
    // Records the connection this failed on (a no-op when it already has).
    shouldRefetchAfterReconnect(failedOn, key, 'error', connection)
    deferScan(client, hostId, worktreeId, CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS, force)
    console.warn(
      `[transcript-model] aiVault.listSessions on ${hostId}: ${reasonOf(error)}; the model pill keeps its last reading, and asks again on the next connection or in five minutes`
    )
    notify()
    return 'failed'
  }
}
