import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAnsweringClient,
  historySession,
  ok,
  refused,
  type Responder
} from '../agent-history/agent-history-panel.test-support'
import { markRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import {
  CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS,
  HOST_SESSION_LIST_CACHE_MS,
  peekClaudeTranscriptModel,
  requestClaudeTranscriptModelScan,
  resetClaudeTranscriptModelScansForTests,
  watchClaudeTranscriptModelHost
} from './claude-transcript-model-scan'

const HOST = 'host-win'
const SESSION = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607'
const WORKTREE = 'repo-1::C:\\Users\\danny\\code\\app'
const T0 = 1_790_000_000_000

const opusRow = historySession({
  sessionId: SESSION,
  cwd: 'C:\\Users\\danny\\code\\app',
  model: 'claude-opus-5-5',
  previewMessages: [{ role: 'assistant', text: 'Done.', timestamp: '2026-09-27T10:00:30.000Z' }]
})

function answering(responder: Responder) {
  return createAnsweringClient(responder)
}

describe("the host session scan behind a Windows session's model pill", () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    resetClaudeTranscriptModelScansForTests()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  it("asks the history screen's own question, never a forced rescan", async () => {
    const host = answering(() => ok({ sessions: [opusRow], issues: [] }))

    expect(await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })).toBe('scanned')

    const [sent] = host.sent('aiVault.listSessions')
    // The history screen's workspace scope: the same cache key on the host,
    // so a scan either of them ran in the last minute answers the other.
    expect(sent?.params).toEqual({
      limit: 20,
      force: false,
      scopePaths: ['C:\\Users\\danny\\code\\app']
    })
    // The host may have answered from a list it cached up to a minute earlier,
    // so the reading speaks for the transcript as of then, not as of the ask.
    expect(peekClaudeTranscriptModel(HOST, SESSION)).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      freshAsOf: T0 - HOST_SESSION_LIST_CACHE_MS
    })
  })

  it("asks the host to read the transcript again for a scan that must confirm a switch, never its cache", async () => {
    const host = answering(() => ok({ sessions: [opusRow], issues: [] }))

    expect(
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0, force: true })
    ).toBe('scanned')

    expect(host.sent('aiVault.listSessions')[0]?.params).toMatchObject({ force: true })
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.freshAsOf).toBe(T0)
  })

  it('skips a second scan of the same host within five minutes of the first', async () => {
    const host = answering(() => ok({ sessions: [opusRow], issues: [] }))
    await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })

    const soon = T0 + CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS - 1
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: soon })).toBe(
      'throttled'
    )
    // Another worktree on the same host is the same desktop doing the work.
    expect(
      await requestClaudeTranscriptModelScan(host.client, HOST, 'repo-1::C:\\other', { now: soon })
    ).toBe('throttled')
    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
    // What the first scan said still answers while the second waits.
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')

    const later = T0 + CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: later })).toBe(
      'scanned'
    )
    expect(host.sent('aiVault.listSessions')).toHaveLength(2)
  })

  it('keeps each host on its own clock', async () => {
    const host = answering(() => ok({ sessions: [opusRow], issues: [] }))
    await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })
    expect(await requestClaudeTranscriptModelScan(host.client, 'host-mac', WORKTREE, { now: T0 + 1 })).toBe(
      'scanned'
    )
    expect(peekClaudeTranscriptModel('host-mac', SESSION)?.label).toBe('Opus 5.5')
  })

  it('shows nothing, and says why in one log line, when the host refuses the scan', async () => {
    const host = answering(() => refused('method_not_found', 'Unknown method: aiVault.listSessions'))

    expect(await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })).toBe('failed')

    expect(peekClaudeTranscriptModel(HOST, SESSION)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /^\[transcript-model\] aiVault\.listSessions on host-win: .*Unknown method: aiVault\.listSessions/
    )
  })

  it('shows nothing when the scan times out', async () => {
    const host = answering(() =>
      Promise.reject(markRpcDeliveryUnknown(new Error('Request timed out: aiVault.listSessions')))
    )

    expect(await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })).toBe('failed')

    expect(peekClaudeTranscriptModel(HOST, SESSION)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('Request timed out: aiVault.listSessions')
  })

  it('shows nothing when the reply is not a session list', async () => {
    const host = answering(() => ok({ sessions: 'none', issues: [] }))

    expect(await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })).toBe('failed')

    expect(peekClaudeTranscriptModel(HOST, SESSION)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good reading through a failed rescan', async () => {
    let reply: Responder = () => ok({ sessions: [opusRow], issues: [] })
    const host = answering((method, params) => reply(method, params))
    await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })

    reply = () => refused('internal_error', 'scan worker exited')
    const later = T0 + CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS
    expect(await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: later })).toBe(
      'failed'
    )
    // One bad answer does not blank a pill that was right a minute ago.
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('holds a failed scan to the five minutes on the same connection', async () => {
    const host = answering(() => refused('internal_error', 'scan worker exited'))
    await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0, connection: 1 })
    expect(
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 + 1000, connection: 1 })
    ).toBe('throttled')
    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
  })

  it('asks again once on the next connection after a failed scan, inside the five minutes', async () => {
    // The chat opened while the relay was still dialling and the scan failed;
    // the connection came up. Nothing stays stale once it does (CLAUDE.md).
    let reply: Responder = () =>
      Promise.reject(markRpcDeliveryUnknown(new Error('Request timed out: aiVault.listSessions')))
    const host = answering((method, params) => reply(method, params))
    await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0, connection: 1 })
    expect(peekClaudeTranscriptModel(HOST, SESSION)).toBeNull()

    reply = () => ok({ sessions: [opusRow], issues: [] })
    expect(
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 + 5_000, connection: 2 })
    ).toBe('scanned')
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
    // Once per new connection, and a success ends it: the budget holds again.
    expect(
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 + 6_000, connection: 3 })
    ).toBe('throttled')
    expect(host.sent('aiVault.listSessions')).toHaveLength(2)
  })

  it('retries a failed scan only once per new connection while it keeps failing', async () => {
    const host = answering(() => refused('internal_error', 'scan worker exited'))
    await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0, connection: 1 })
    expect(
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 + 1_000, connection: 2 })
    ).toBe('failed')
    expect(
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 + 2_000, connection: 2 })
    ).toBe('throttled')
    expect(host.sent('aiVault.listSessions')).toHaveLength(2)
  })

  describe('by itself, once the five minutes after a failure are up', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(T0)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('asks again while a chat for that host is on screen', async () => {
      let reply: Responder = () => refused('internal_error', 'scan worker exited')
      const host = answering((method, params) => reply(method, params))
      const unwatch = watchClaudeTranscriptModelHost(HOST)
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE)

      reply = () => ok({ sessions: [opusRow], issues: [] })
      await vi.advanceTimersByTimeAsync(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS - 1)
      expect(host.sent('aiVault.listSessions')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(host.sent('aiVault.listSessions')).toHaveLength(2)
      expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
      // A success leaves nothing scheduled.
      await vi.advanceTimersByTimeAsync(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS * 3)
      expect(host.sent('aiVault.listSessions')).toHaveLength(2)
      unwatch()
    })

    it('asks nothing once no chat for that host is on screen', async () => {
      const host = answering(() => refused('internal_error', 'scan worker exited'))
      const unwatch = watchClaudeTranscriptModelHost(HOST)
      await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE)
      unwatch()
      await vi.advanceTimersByTimeAsync(CLAUDE_TRANSCRIPT_MODEL_SCAN_INTERVAL_MS * 3)
      expect(host.sent('aiVault.listSessions')).toHaveLength(1)
    })
  })

  it('scans the whole host when the worktree names no absolute folder', async () => {
    const host = answering(() => ok({ sessions: [opusRow], issues: [] }))
    await requestClaudeTranscriptModelScan(host.client, HOST, 'folder-7', { now: T0 })
    expect(host.sent('aiVault.listSessions')[0]?.params).toMatchObject({ scopePaths: [] })
  })
})
