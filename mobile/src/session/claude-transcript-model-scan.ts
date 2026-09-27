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
 * - never forced: `force: false` answers from the host's cache when it can;
 * - the history screen's own workspace scope, so the two share that cache.
 *
 * The limit is small because only one row is wanted; the host still includes
 * the in-scope sessions up to it, and the session in front of the user is the
 * newest in its own folder. A cached deeper list (the history screen asks for
 * 500) covers this request; the reverse costs that screen one scan.
 *
 * A failure of any kind — refused, timed out, not a session list — shows
 * nothing and leaves one log line naming the host and the reason.
 */
export const CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS = 5 * 60_000
const SCAN_LIMIT = 20
// The scan walks the host's session stores; a cold Windows host with WSL
// homes can take a while, and nothing waits on this but a pill.
const SCAN_TIMEOUT_MS = 30_000

type HostScan = {
  attemptedAt: number
  /** When the scan that produced `rows` was asked for. */
  scannedAt: number
  /** The rows of the last scan that succeeded; empty after a failure. */
  rows: readonly unknown[]
}

const scans = new Map<string, HostScan>()
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

export function resetClaudeTranscriptModelScansForTests(): void {
  scans.clear()
  listeners.clear()
}

/** What the last scan of this host says about one session, with when (the
 *  phone's clock) that scan was asked for, or null. */
export function peekClaudeTranscriptModel(
  hostId: string,
  sessionId: string
): ScannedTranscriptModel | null {
  const scan = scans.get(hostId)
  const reading = scan ? transcriptModelForSession(scan.rows, sessionId) : null
  return reading && scan ? { ...reading, scannedAt: scan.scannedAt } : null
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

export async function requestClaudeTranscriptModelScan(
  client: RpcClient,
  hostId: string,
  worktreeId: string,
  now: number = Date.now()
): Promise<'scanned' | 'throttled' | 'failed'> {
  const last = scans.get(hostId)
  if (last && now - last.attemptedAt < CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS) {
    return 'throttled'
  }
  // Stamped before the request goes out, so a second caller while this one is
  // in flight is held off too. What the last success said stands meanwhile.
  scans.set(hostId, { attemptedAt: now, scannedAt: last?.scannedAt ?? now, rows: last?.rows ?? [] })
  try {
    const reply = await agentHistorySessionScan.request(
      client,
      { limit: SCAN_LIMIT, force: false, scopePaths: scopePathsFor(worktreeId) },
      { timeoutMs: SCAN_TIMEOUT_MS }
    )
    const result = interpretOrThrowRefusalMessage(
      () => agentHistorySessionScan.interpret(reply),
      'the host sent no session list'
    )
    scans.set(hostId, { attemptedAt: now, scannedAt: now, rows: result.sessions })
    notify()
    return 'scanned'
  } catch (error) {
    scans.set(hostId, { attemptedAt: now, scannedAt: now, rows: [] })
    console.warn(
      `[transcript-model] aiVault.listSessions on ${hostId}: ${reasonOf(error)}; the model pill shows nothing until the next scan`
    )
    notify()
    return 'failed'
  }
}
