import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAnsweringClient,
  historySession,
  ok,
  refused
} from '../agent-history/agent-history-panel.test-support'
import {
  HOST_SESSION_LIST_CACHE_MS,
  peekClaudeTranscriptModel,
  requestClaudeTranscriptModelScan,
  resetClaudeTranscriptModelScansForTests
} from './claude-transcript-model-scan'
import { hydrateSessionCaches } from './session-caches-hydrate'

// Reported 2026-10-09: on a hand-typed Claude tab (no beacon, no status line of
// the user's own) the composer's model pill came up blank for seconds after
// every app launch. The scan's reading lived in memory only, so a relaunch
// started from nothing and waited for the host again. The session's RAW reading
// (what the host's list said, and how recent a transcript it speaks for) is now
// kept per session id, and a relaunch states it at once.
const STORE = 'codeui:chat-transcript-models'
const HOST = 'host-mac'
const SESSION = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607'
const WORKTREE = 'repo-1::/Users/alwin/code/app'
const T0 = 1_790_000_000_000

const row = (model: string) =>
  historySession({ sessionId: SESSION, cwd: '/Users/alwin/code/app', model })

/** A killed app, relaunched: memory gone, storage kept, the session caches read at start. */
async function relaunch(): Promise<void> {
  resetClaudeTranscriptModelScansForTests()
  await hydrateSessionCaches()
}

/** The chat that asked shows the reading (which is when it is kept), then the app is killed. */
async function scanOpusAndRelaunch(): Promise<void> {
  const opus = createAnsweringClient(() => ok({ sessions: [row('claude-opus-5-5')], issues: [] }))
  await requestClaudeTranscriptModelScan(opus.client, HOST, WORKTREE, { now: T0 })
  expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
  await vi.advanceTimersByTimeAsync(1_000)
  await relaunch()
}

describe('the model reading a relaunched app shows before it asks the host again', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await AsyncStorage.removeItem(STORE)
    resetClaudeTranscriptModelScansForTests()
    await hydrateSessionCaches()
  })
  afterEach(() => {
    resetClaudeTranscriptModelScansForTests()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the last reading at once when the app is relaunched, before the host is asked again', async () => {
    const host = createAnsweringClient(() => ok({ sessions: [row('claude-opus-5-5')], issues: [] }))
    await requestClaudeTranscriptModelScan(host.client, HOST, WORKTREE, { now: T0 })
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
    await vi.advanceTimersByTimeAsync(1_000)

    await relaunch()

    // The reading as the host gave it, with its own age: the superseded rule
    // (a reply newer than the reading) still compares against when it was read.
    expect(peekClaudeTranscriptModel(HOST, SESSION)).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      freshAsOf: T0 - HOST_SESSION_LIST_CACHE_MS
    })
    expect(host.sent('aiVault.listSessions')).toHaveLength(1)
  })

  it('lets a fresh scan replace the remembered reading', async () => {
    await scanOpusAndRelaunch()

    const sonnet = createAnsweringClient(() => ok({ sessions: [row('claude-sonnet-5-5')], issues: [] }))
    await requestClaudeTranscriptModelScan(sonnet.client, HOST, WORKTREE, { now: T0 + 2_000, force: true })
    expect(peekClaudeTranscriptModel(HOST, SESSION)).toEqual({
      model: 'claude-sonnet-5-5',
      label: 'Sonnet 5.5',
      freshAsOf: T0 + 2_000
    })
    // And that is what the next relaunch remembers.
    await vi.advanceTimersByTimeAsync(1_000)
    await relaunch()
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.model).toBe('claude-sonnet-5-5')
  })

  // Review, 2026-10-09: a scan is asked for ONE folder and 20 rows, so a scan
  // of another project on the same host says nothing about this session, and
  // the five-minute budget then holds this chat's own scan back.
  it('keeps the remembered reading when a scan of another folder does not list the session', async () => {
    await scanOpusAndRelaunch()

    const otherFolder = createAnsweringClient(() =>
      ok({ sessions: [historySession({ sessionId: 'other-session', cwd: '/Users/alwin/other', model: 'claude-sonnet-5-5' })], issues: [] })
    )
    await requestClaudeTranscriptModelScan(otherFolder.client, HOST, 'repo-2::/Users/alwin/other', { now: T0 + 2_000 })
    expect(await requestClaudeTranscriptModelScan(otherFolder.client, HOST, WORKTREE, { now: T0 + 3_000 })).toBe('throttled')
    expect(peekClaudeTranscriptModel(HOST, SESSION)).toEqual({
      model: 'claude-opus-5-5',
      label: 'Opus 5.5',
      freshAsOf: T0 - HOST_SESSION_LIST_CACHE_MS
    })
  })

  it('lets a scan that lists the session with no Claude model replace the remembered reading', async () => {
    await scanOpusAndRelaunch()

    const synthetic = createAnsweringClient(() => ok({ sessions: [row('<synthetic>')], issues: [] }))
    await requestClaudeTranscriptModelScan(synthetic.client, HOST, WORKTREE, { now: T0 + 2_000 })
    expect(peekClaudeTranscriptModel(HOST, SESSION)).toBeNull()
  })

  it('keeps the remembered reading through a scan that fails after the relaunch', async () => {
    await scanOpusAndRelaunch()

    const down = createAnsweringClient(() => refused('internal_error', 'scan worker exited'))
    expect(await requestClaudeTranscriptModelScan(down.client, HOST, WORKTREE, { now: T0 + 2_000 })).toBe('failed')
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
  })

  it('never states a reading under another host', async () => {
    await scanOpusAndRelaunch()
    expect(peekClaudeTranscriptModel('host-other', SESSION)).toBeNull()
  })

  it.each([
    ['not JSON at all', '{not json'],
    ['an empty list', '[]'],
    ['an object, not a list', '{"a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607":{"model":"claude-opus-5-5"}}'],
    [
      'entries of the wrong shape',
      JSON.stringify([
        [SESSION, 5],
        [SESSION, null],
        [SESSION, { hostId: HOST, model: 3, label: 'Opus 5.5', freshAsOf: T0 }],
        [SESSION, { hostId: HOST, model: 'claude-opus-5-5', label: 'Opus 5.5', freshAsOf: 'soon' }],
        [SESSION, { hostId: HOST, model: 'claude-opus-5-5', label: 'Opus 5.5', freshAsOf: null }],
        [SESSION, { model: 'claude-opus-5-5', label: 'Opus 5.5', freshAsOf: T0 }],
        [SESSION, { hostId: HOST, model: '<synthetic>', label: '<synthetic>', freshAsOf: T0 }]
      ])
    ]
  ])('starts with no reading, and still scans, when the stored copy is %s', async (_shape, payload) => {
    await AsyncStorage.setItem(STORE, payload)
    resetClaudeTranscriptModelScansForTests()
    await expect(hydrateSessionCaches()).resolves.toBeUndefined()

    expect(peekClaudeTranscriptModel(HOST, SESSION)).toBeNull()
    const opus = createAnsweringClient(() => ok({ sessions: [row('claude-opus-5-5')], issues: [] }))
    expect(await requestClaudeTranscriptModelScan(opus.client, HOST, WORKTREE, { now: T0 })).toBe('scanned')
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
  })

  it('starts with no reading, and still scans, when storage cannot be read at all', async () => {
    const getItem = vi.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('disk I/O error'))
    resetClaudeTranscriptModelScansForTests()
    await expect(hydrateSessionCaches()).resolves.toBeUndefined()
    getItem.mockRestore()

    expect(peekClaudeTranscriptModel(HOST, SESSION)).toBeNull()
    const opus = createAnsweringClient(() => ok({ sessions: [row('claude-opus-5-5')], issues: [] }))
    expect(await requestClaudeTranscriptModelScan(opus.client, HOST, WORKTREE, { now: T0 })).toBe('scanned')
    expect(peekClaudeTranscriptModel(HOST, SESSION)?.label).toBe('Opus 5.5')
  })
})
