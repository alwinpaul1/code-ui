import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hydrateScreenModelRecords,
  noteScreenModelStatement,
  peekScreenModelRecord,
  resetScreenModelRecordsForTests,
  withScreenModelStatements
} from './claude-screen-model-pair'
import { readClaudeScreenModelStatement } from './claude-screen-model-statement'
import { WIDE_TOAST_OPUS } from './fixtures/claude-model-toast-2.1.294'
import { WIDE_IDLE_AFTER_TURN, WIDE_SPINNER_XHIGH } from './fixtures/claude-spinner-effort-2.1.294'

const disk = new Map<string, string>()
const getItem = vi.fn(async (key: string) => disk.get(key) ?? null)
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => getItem(key),
    setItem: vi.fn(async (key: string, value: string) => {
      disk.set(key, value)
    })
  }
}))

// Claude Code 2.1.294 captures (fixtures/claude-spinner-effort-2.1.294.ts, claude-model-toast-2.1.294.ts).
const NOTHING = { commandKey: null, frame: null, transcript: null, messages: [] }
const seeOpusXhigh = (sessionId: string) => {
  noteScreenModelStatement(sessionId, readClaudeScreenModelStatement(WIDE_TOAST_OPUS), { commandKey: null, model: null, replyAt: null }, 1)
  noteScreenModelStatement(sessionId, readClaudeScreenModelStatement(WIDE_IDLE_AFTER_TURN), { commandKey: null, model: 'claude-opus-5-5', replyAt: null }, 2)
  noteScreenModelStatement(sessionId, readClaudeScreenModelStatement(WIDE_SPINNER_XHIGH), { commandKey: null, model: 'claude-opus-5-5', replyAt: null }, 3)
}

describe('what the screen said about the model and effort, across a leave and a relaunch', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    disk.clear()
    getItem.mockImplementation(async (key: string) => disk.get(key) ?? null)
    resetScreenModelRecordsForTests()
    await hydrateScreenModelRecords()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the pair again after a killed app is relaunched', async () => {
    seeOpusXhigh('s-1')
    await vi.advanceTimersByTimeAsync(1000)
    resetScreenModelRecordsForTests()
    expect(peekScreenModelRecord('s-1')).toBeNull()
    await hydrateScreenModelRecords()
    expect(withScreenModelStatements({ kind: 'none' }, peekScreenModelRecord('s-1'), NOTHING)).toEqual({
      kind: 'transcript',
      model: { model: 'claude-opus-5-5', label: 'Opus 5.5' },
      effort: 'xhigh'
    })
  })

  it('keeps it per session, and never under no session', () => {
    seeOpusXhigh('s-1')
    expect(peekScreenModelRecord('s-2')).toBeNull()
    seeOpusXhigh(null as unknown as string)
    expect(peekScreenModelRecord(null)).toBeNull()
  })

  it('shows nothing, rather than failing, when the stored copy is corrupt', async () => {
    disk.set('codeui:chat-screen-model-statements', '{not json')
    resetScreenModelRecordsForTests()
    await expect(hydrateScreenModelRecords()).resolves.toBeUndefined()
    expect(peekScreenModelRecord('s-1')).toBeNull()
  })

  it('still follows the screen in memory when storage cannot be read at all', async () => {
    getItem.mockRejectedValue(new Error('storage unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    resetScreenModelRecordsForTests()
    await expect(hydrateScreenModelRecords()).resolves.toBeUndefined()
    seeOpusXhigh('s-1')
    expect(peekScreenModelRecord('s-1')).toMatchObject({ effort: { effort: 'xhigh' }, toast: { model: 'claude-opus-5-5' } })
  })

  it('lays nothing over the fallback when the session has no record', () => {
    const fallback = { kind: 'transcript' as const, model: { model: 'claude-opus-5', label: 'Opus 5' }, effort: 'low' }
    expect(withScreenModelStatements(fallback, null, NOTHING)).toBe(fallback)
  })
})
