import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAnsweringClient,
  historySession,
  ok,
  refused
} from '../agent-history/agent-history-panel.test-support'
import {
  CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL,
  CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS,
  peekClaudeTranscriptModel,
  requestClaudeTranscriptModelScan,
  resetClaudeTranscriptModelScansForTests,
  watchClaudeTranscriptModelHost
} from './claude-transcript-model-scan'

// 2026-10-09: the budget was one scan per HOST per five minutes, while each
// scan asks for ONE project's folder (20 rows). A scan asked for project A
// therefore held back project B's on the same host for five minutes, and B's
// pill stayed blank. The budget is now per project folder, with a cap per host
// so a phone opening many projects cannot drive the host's scans.
const HOST = 'host-mac'
const T0 = 1_790_000_000_000
const project = (name: string) => ({
  worktreeId: `repo-${name}::/Users/alwin/${name}`,
  folder: `/Users/alwin/${name}`,
  sessionId: `session-${name}`
})
const A = project('a')
const B = project('b')

/** A host that lists only the sessions in the folder it is asked about. */
function folderHost() {
  const projects = new Map<string, ReturnType<typeof project>>()
  const host = createAnsweringClient((method, params) => {
    if (method !== 'aiVault.listSessions') {
      return refused('method_not_found', method)
    }
    const scope = (params as { scopePaths?: string[] }).scopePaths ?? []
    const sessions = [...projects.values()]
      .filter((p) => scope.includes(p.folder))
      .map((p) => historySession({ sessionId: p.sessionId, cwd: p.folder, model: 'claude-opus-5-5' }))
    return ok({ sessions, issues: [] })
  })
  return {
    ...host,
    serve: (...list: ReturnType<typeof project>[]) => list.forEach((p) => projects.set(p.folder, p))
  }
}

describe('the transcript-scan budget, per project folder on a host', () => {
  beforeEach(() => {
    resetClaudeTranscriptModelScansForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("asks for another project's folder at once, inside the first project's five minutes", async () => {
    const host = folderHost()
    host.serve(A, B)
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, A.worktreeId, { now: T0 })).toBe('scanned')
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, B.worktreeId, { now: T0 + 1_000 })).toBe('scanned')
    expect(peekClaudeTranscriptModel(HOST, A.sessionId)?.label).toBe('Opus 5.5')
    expect(peekClaudeTranscriptModel(HOST, B.sessionId)?.label).toBe('Opus 5.5')
  })

  it('still asks one folder at most once per five minutes', async () => {
    const host = folderHost()
    host.serve(A)
    await requestClaudeTranscriptModelScan(host.client, HOST, A.worktreeId, { now: T0 })
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, A.worktreeId, { now: T0 + 1_000 })).toBe('throttled')
    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
  })

  it('holds a host to its cap across many projects, and asks nothing past it', async () => {
    const host = folderHost()
    const projects = Array.from({ length: CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL + 3 }, (_, i) => project(`p${String(i)}`))
    host.serve(...projects)
    const results: string[] = []
    for (const [i, p] of projects.entries()) {
      results.push(await requestClaudeTranscriptModelScan(host.client, HOST, p.worktreeId, { now: T0 + i }))
    }
    expect(results.filter((r) => r === 'scanned')).toHaveLength(CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL)
    expect(host.sent('aiVault.listSessions')).toHaveLength(CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL)
    // Another host is not held by this one's cap.
    expect(await requestClaudeTranscriptModelScan(host.client, 'host-linux', A.worktreeId, { now: T0 + 50 })).toBe('scanned')
  })

  it('runs a capped scan by itself once the host has room, while a chat for it is on screen', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const host = folderHost()
    const projects = Array.from({ length: CLAUDE_TRANSCRIPT_MODEL_HOST_SCANS_PER_INTERVAL }, (_, i) => project(`p${String(i)}`))
    host.serve(...projects, B)
    for (const p of projects) {
      await requestClaudeTranscriptModelScan(host.client, HOST, p.worktreeId)
    }
    const unwatch = watchClaudeTranscriptModelHost(HOST)
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, B.worktreeId)).toBe('throttled')
    expect(peekClaudeTranscriptModel(HOST, B.sessionId)).toBeNull()
    await vi.advanceTimersByTimeAsync(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS)
    expect(peekClaudeTranscriptModel(HOST, B.sessionId)?.label).toBe('Opus 5.5')
    unwatch()
  })

  it("never lets a failed scan of one project hold another's", async () => {
    const down = createAnsweringClient(() => refused('internal_error', 'scan worker exited'))
    expect(await requestClaudeTranscriptModelScan(down.client, HOST, A.worktreeId, { now: T0, connection: 1 })).toBe('failed')
    const host = folderHost()
    host.serve(B)
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, B.worktreeId, { now: T0 + 1_000, connection: 1 })).toBe('scanned')
    expect(peekClaudeTranscriptModel(HOST, B.sessionId)?.label).toBe('Opus 5.5')
  })
})
