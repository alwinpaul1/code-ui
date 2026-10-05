import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  hydrateSessionCommandPairs,
  resetSessionCommandPairCacheForTests,
  sessionCommandPairFor
} from './claude-session-command-pair'

// The user's rule (2026-10-05): a model or effort the session last stated must
// still show after switching to another project, leaving the tab, backgrounding
// the app, or killing and relaunching it, until a newer source replaces it.

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

let clock = 0
const row = (role: 'user' | 'assistant', body: string): NativeChatMessage => ({
  id: `m${(clock += 1)}`,
  role,
  blocks: [{ type: 'text', text: body }],
  timestamp: clock * 1000,
  source: 'transcript'
})
const ran = (name: string, body: string) => [
  row('user', `<command-name>/${name}</command-name>\n<command-args></command-args>`),
  row('user', `<local-command-stdout>${body}</local-command-stdout>`)
]
const written = () => vi.advanceTimersByTimeAsync(1000)
async function relaunch(): Promise<void> {
  resetSessionCommandPairCacheForTests()
  await hydrateSessionCommandPairs()
}

describe("a session's last model command across a leave and a relaunch", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    disk.clear()
    getItem.mockClear()
    await relaunch()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the effort again after the app is killed and relaunched, with no row on the first page', async () => {
    sessionCommandPairFor('s-1', ran('effort', 'Set effort level to high (this session only): Deep'), 'claude-opus-5-5')
    await written()
    await relaunch()
    expect(sessionCommandPairFor('s-1', [])).toMatchObject({ effort: 'high', boundModel: 'claude-opus-5-5' })
  })

  it('keeps the pair of each session apart', async () => {
    sessionCommandPairFor('s-1', ran('effort', 'Set effort level to high (this session only): Deep'))
    sessionCommandPairFor('s-2', ran('effort', 'Set effort level to low (this session only): Quick'))
    await written()
    await relaunch()
    expect(sessionCommandPairFor('s-1', [])?.effort).toBe('high')
    expect(sessionCommandPairFor('s-2', [])?.effort).toBe('low')
    expect(sessionCommandPairFor('s-3', [])).toBeNull()
  })

  it('lets a newer command replace the remembered one, and never an older page replace it', async () => {
    sessionCommandPairFor('s-1', ran('effort', 'Set effort level to high (this session only): Deep'))
    const newer = ran('effort', 'Set effort level to low (this session only): Quick')
    expect(sessionCommandPairFor('s-1', newer)?.effort).toBe('low')
    const older = ran('effort', 'Set effort level to max (this session only): x')
    older.forEach((m, i) => (m.timestamp = 10 + i))
    expect(sessionCommandPairFor('s-1', older)?.effort).toBe('low')
  })

  it('fails open when storage cannot be read: this run still remembers in memory', async () => {
    getItem.mockRejectedValueOnce(new Error('disk gone'))
    await relaunch()
    sessionCommandPairFor('s-1', ran('effort', 'Set effort level to high (this session only): Deep'))
    expect(sessionCommandPairFor('s-1', [])?.effort).toBe('high')
  })

  it('reads a corrupt or foreign blob as nothing rather than throwing', async () => {
    disk.set('codeui:chat-model-command-pairs', '{not json')
    await relaunch()
    expect(sessionCommandPairFor('s-1', [])).toBeNull()
    disk.set('codeui:chat-model-command-pairs', JSON.stringify({ a: 1 }))
    await relaunch()
    expect(sessionCommandPairFor('s-1', [])).toBeNull()
  })
})
