import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hydrateStartupFramePairs,
  peekStartupFramePair,
  rememberStartupFramePair,
  resetStartupFramePairsForTests,
  fileStartupFrame,
  subscribeStartupFramePairs,
  withStartupFramePair
} from './claude-startup-frame-pair'
import type { ClaudeModelFallback } from './claude-transcript-model'

const disk = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => disk.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      disk.set(key, value)
    })
  }
}))

const OPUS = { model: 'claude-opus-5', label: 'Opus 5', effort: 'xhigh' }
const frame = (over: { effort?: string | null; readAt?: number } = {}) => ({ ...OPUS, readAt: 1, ...over })
const scan = (model: string, label: string): ClaudeModelFallback => ({ kind: 'transcript', model: { model, label }, freshAsOf: 5 })

describe("a session's startup frame pair across a scroll, a leave and a relaunch", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    disk.clear()
    resetStartupFramePairsForTests()
    await hydrateStartupFramePairs()
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the pair after the frame has scrolled off, until something replaces it', () => {
    rememberStartupFramePair('s-1', OPUS)
    // Later reads find no frame at all: nothing is remembered, nothing is erased.
    rememberStartupFramePair('s-1', null)
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  it('keeps it per session, never under another session id', () => {
    rememberStartupFramePair('s-1', OPUS)
    expect(peekStartupFramePair('s-2')).toBeNull()
    expect(peekStartupFramePair(null)).toBeNull()
    rememberStartupFramePair(null, OPUS)
    expect(peekStartupFramePair(null)).toBeNull()
  })

  it('shows it again after a killed app is relaunched', async () => {
    rememberStartupFramePair('s-1', OPUS)
    await vi.advanceTimersByTimeAsync(1000)
    resetStartupFramePairsForTests()
    expect(peekStartupFramePair('s-1')).toBeNull()
    await hydrateStartupFramePairs()
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  it('shows nothing, rather than failing, when the stored copy is corrupt', async () => {
    disk.set('codeui:chat-startup-frame-pairs', '{not json')
    resetStartupFramePairsForTests()
    await expect(hydrateStartupFramePairs()).resolves.toBeUndefined()
    expect(peekStartupFramePair('s-1')).toBeNull()
  })

  it('lets the newest frame replace the pair (a resume paints a new one)', () => {
    rememberStartupFramePair('s-1', OPUS)
    rememberStartupFramePair('s-1', { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'medium' })
    expect(peekStartupFramePair('s-1')).toMatchObject({ model: 'claude-sonnet-5', effort: 'medium' })
  })

  it('does not let a narrow read of the same model erase the effort a wide read stated', () => {
    rememberStartupFramePair('s-1', OPUS)
    rememberStartupFramePair('s-1', { ...OPUS, effort: null })
    expect(peekStartupFramePair('s-1')).toMatchObject({ effort: 'xhigh' })
  })

  it('does carry no effort to a DIFFERENT model that a narrow read names', () => {
    rememberStartupFramePair('s-1', OPUS)
    rememberStartupFramePair('s-1', { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: null })
    expect(peekStartupFramePair('s-1')).toMatchObject({ model: 'claude-sonnet-5', effort: null })
  })

  it('tells a listener when a pair arrives, and not when nothing changed', () => {
    const listener = vi.fn()
    const off = subscribeStartupFramePairs(listener)
    rememberStartupFramePair('s-1', OPUS)
    rememberStartupFramePair('s-1', OPUS)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    rememberStartupFramePair('s-1', { ...OPUS, effort: 'high' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('the startup frame laid under what the transcript scan says', () => {
  const none: ClaudeModelFallback = { kind: 'none' }

  it('states the frame when nothing else has spoken', () => {
    expect(withStartupFramePair(none, frame())).toEqual({
      kind: 'transcript',
      model: { model: 'claude-opus-5', label: 'Opus 5' },
      effort: 'xhigh'
    })
  })

  it('adds the effort to a scan that names the same model, which records none', () => {
    expect(withStartupFramePair(scan('claude-opus-5', 'Opus 5'), frame())).toMatchObject({ model: { model: 'claude-opus-5' }, effort: 'xhigh' })
  })

  it('lets a scan that names ANOTHER model win, with no effort of the frame carried over', () => {
    const scanned = scan('claude-fable-5-1', 'Fable 5.1')
    expect(withStartupFramePair(scanned, frame())).toBe(scanned)
  })

  it('changes nothing with no frame', () => {
    expect(withStartupFramePair(none, null)).toBe(none)
  })

  it('states the model with no effort when the frame stated none', () => {
    expect(withStartupFramePair(none, frame({ effort: null }))).toMatchObject({ effort: null })
  })
})

describe('filing a frame under the session it appeared with', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    disk.clear()
    resetStartupFramePairsForTests()
    await hydrateStartupFramePairs()
  })
  afterEach(() => vi.useRealTimers())

  it('files a frame seen first with the session known', () => {
    fileStartupFrame('scope', 's-1', OPUS)
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  it('refuses the same frame under another session, however often it is read again', () => {
    fileStartupFrame('scope', 's-1', OPUS)
    fileStartupFrame('scope', 's-2', OPUS)
    fileStartupFrame('scope', 's-2', null)
    fileStartupFrame('scope', 's-2', { ...OPUS })
    expect(peekStartupFramePair('s-2')).toBeNull()
  })

  it('refuses a narrow read of the same frame under another session (the same model, the effort cut)', () => {
    fileStartupFrame('scope', 's-1', OPUS)
    fileStartupFrame('scope', 's-2', { ...OPUS, effort: null })
    expect(peekStartupFramePair('s-2')).toBeNull()
  })

  it('files a different frame under the new session (a second claude with another model)', () => {
    fileStartupFrame('scope', 's-1', OPUS)
    fileStartupFrame('scope', 's-2', { model: 'claude-sonnet-5', label: 'Sonnet 5', effort: 'low' })
    expect(peekStartupFramePair('s-2')).toMatchObject({ model: 'claude-sonnet-5' })
  })

  it('keeps scopes apart: the same frame in another terminal is its own', () => {
    fileStartupFrame('scope-a', 's-1', OPUS)
    fileStartupFrame('scope-b', 's-2', OPUS)
    expect(peekStartupFramePair('s-2')).toMatchObject(OPUS)
  })

  it('files a frame that waited for its session id under the id that arrived', () => {
    fileStartupFrame('scope', null, OPUS)
    expect(peekStartupFramePair('s-1')).toBeNull()
    fileStartupFrame('scope', 's-1', OPUS)
    expect(peekStartupFramePair('s-1')).toMatchObject(OPUS)
  })

  it('drops a waiting frame that left the screen, so a later id inherits nothing', () => {
    fileStartupFrame('scope', null, OPUS)
    fileStartupFrame('scope', null, null)
    fileStartupFrame('scope', 's-9', null)
    expect(peekStartupFramePair('s-9')).toBeNull()
    fileStartupFrame('scope', 's-9', OPUS)
    expect(peekStartupFramePair('s-9')).toMatchObject(OPUS)
  })

  it('does not drop a filed frame when it leaves the screen: the record that refuses its re-read stays', () => {
    fileStartupFrame('scope', 's-1', OPUS)
    fileStartupFrame('scope', 's-1', null)
    fileStartupFrame('scope', 's-2', OPUS)
    expect(peekStartupFramePair('s-2')).toBeNull()
  })
})
