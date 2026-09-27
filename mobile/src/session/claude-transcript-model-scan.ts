import { deriveMobileAiVaultScopePaths } from '../agent-history/agent-history-scope-paths'
import { agentHistorySessionScan } from '../agent-history/mobile-agent-history-operations'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import type { RpcClient } from '../transport/rpc-client'
import { worktreePathFromId } from './mobile-native-chat-skill-browse'
import { transcriptModelForSession, type ScannedTranscriptModel } from './claude-transcript-model'

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
 * - at most one attempt per host per five minutes, failed ones included, so a
 *   failing host is not asked again straight away;
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
 * A failure of any kind — refused, timed out, not a session list — shows
 * nothing and leaves one log line naming the host and the reason.
 */
export const CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS = 5 * 60_000
/** How old a list the host may answer an unforced scan with: Orca's
 *  AI_VAULT_CACHE_TTL_MS (cached-session-list.ts, origin/main 8d6fec597b). */
export const HOST_SESSION_LIST_CACHE_MS = 60_000
const SCAN_LIMIT = 20
// The scan walks the host's session stores; a cold Windows host with WSL
// homes can take a while, and nothing waits on this but a pill.
const SCAN_TIMEOUT_MS = 30_000

type HostScan = {
  attemptedAt: number
  /** How recent a transcript the rows speak for (the phone's clock). */
  freshAsOf: number | null
  /** The rows of the last scan that succeeded; empty after a failure. */
  rows: readonly unknown[]
}

/** A forced scan the budget held back, run by itself when it allows. */
type DeferredScan = {
  timer: ReturnType<typeof setTimeout>
  client: RpcClient
  worktreeId: string
}

const scans = new Map<string, HostScan>()
const deferred = new Map<string, DeferredScan>()
const watchers = new Map<string, number>()
const listeners = new Set<() => void>()

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
  deferred.clear()
  watchers.clear()
  listeners.clear()
}

/** What the last scan of this host says about one session, with how recent a
 *  transcript it speaks for, or null. */
export function peekClaudeTranscriptModel(
  hostId: string,
  sessionId: string
): ScannedTranscriptModel | null {
  const scan = scans.get(hostId)
  const reading = scan ? transcriptModelForSession(scan.rows, sessionId) : null
  return reading && scan?.freshAsOf != null ? { ...reading, freshAsOf: scan.freshAsOf } : null
}

/** The history screen's workspace scope for this worktree: its folder, or no
 *  scope (the host's recency list) when the id names no absolute folder. */
function scopePathsFor(worktreeId: string): string[] {
  const path = worktreePathFromId(worktreeId)
  return path
    ? deriveMobileAiVaultScopePaths('workspace', { worktreeId, path, repoId: '' }, [])
    : []
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function deferForcedScan(client: RpcClient, hostId: string, worktreeId: string, delayMs: number): void {
  if (deferred.has(hostId)) {
    return
  }
  const timer = setTimeout(() => {
    deferred.delete(hostId)
    if ((watchers.get(hostId) ?? 0) > 0) {
      void requestClaudeTranscriptModelScan(client, hostId, worktreeId, { force: true })
    }
  }, delayMs)
  deferred.set(hostId, { timer, client, worktreeId })
}

export async function requestClaudeTranscriptModelScan(
  client: RpcClient,
  hostId: string,
  worktreeId: string,
  options: { force?: boolean; now?: number } = {}
): Promise<'scanned' | 'throttled' | 'failed'> {
  const now = options.now ?? Date.now()
  const last = scans.get(hostId)
  if (last && now - last.attemptedAt < CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS) {
    if (options.force) {
      deferForcedScan(client, hostId, worktreeId, last.attemptedAt + CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS - now)
    }
    return 'throttled'
  }
  // A forced scan still waiting is served by this one, which reads fresh too.
  const waiting = deferred.get(hostId)
  if (waiting) {
    clearTimeout(waiting.timer)
    deferred.delete(hostId)
  }
  const force = options.force === true || waiting !== undefined
  // Stamped before the request goes out, so a second caller while this one is
  // in flight is held off too. What the last success said stands meanwhile.
  scans.set(hostId, { attemptedAt: now, freshAsOf: last?.freshAsOf ?? null, rows: last?.rows ?? [] })
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
    scans.set(hostId, {
      attemptedAt: now,
      freshAsOf: force ? now : now - HOST_SESSION_LIST_CACHE_MS,
      rows: result.sessions
    })
    notify()
    return 'scanned'
  } catch (error) {
    scans.set(hostId, { attemptedAt: now, freshAsOf: null, rows: [] })
    console.warn(
      `[transcript-model] aiVault.listSessions on ${hostId}: ${reasonOf(error)}; the model pill shows nothing until the next scan`
    )
    notify()
    return 'failed'
  }
}
