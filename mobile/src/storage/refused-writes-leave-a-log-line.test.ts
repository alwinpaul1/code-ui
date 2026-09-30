import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { NativeChatSessionOptionRecord } from '../../../src/shared/native-chat-session-option-state'
import type { MobileNativeChatPendingMessage } from '../session/mobile-native-chat-pending-echo'

// A store that refuses writes the way a full phone does. Every per-scope
// writer here kept a barrier, `write.catch(() => undefined)`, so a failed
// write could not fail the read or the write queued behind it. That same
// catch marked the rejection handled, and every caller dropped or swallowed
// it, so a refused write left nothing at all: no warning, no unhandled
// rejection. The draft's erase after a send is the case that matters. When
// it is refused the sent text stays on disk and comes back as the draft
// (use-debounced-persist.ts has the 2026-09-13 report), and nothing said why.
const store = new Map<string, string>()
const refusal = new Error('Database or disk is full (code 13 SQLITE_FULL)')
let failWrites = false
let failReads = false

vi.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async (key: string) => {
      if (failReads) {
        throw new Error('storage unavailable')
      }
      return store.get(key) ?? null
    },
    setItem: async (key: string, value: string) => {
      if (failWrites) {
        throw refusal
      }
      store.set(key, value)
    },
    removeItem: async (key: string) => {
      if (failWrites) {
        throw refusal
      }
      store.delete(key)
    }
  }
  return { default: storage, ...storage }
})

import { readNativeChatDraft, writeNativeChatDraft } from './native-chat-drafts'
import { readNativeChatImagePreviews, writeNativeChatImagePreviews } from './native-chat-image-previews'
import { readNativeChatPendingEchoes, writeNativeChatPendingEchoes } from './native-chat-pending-echoes'
import {
  flushReadingPositions,
  loadReadingPosition,
  READING_POSITION_WRITE_DELAY_MS,
  readingPositionKey,
  resetReadingPositionMemoryForTests,
  saveReadingPosition
} from './reading-positions'
import { readSessionOptionRecord, writeSessionOptionRecord } from './session-option-records'
import {
  resetSessionViewPreferenceMemoryForTests,
  saveChatFocusView,
  saveDefaultSessionView,
  updateSessionViewOverride
} from './session-view-preferences'

let warn: MockInstance<typeof console.warn>

beforeEach(() => {
  store.clear()
  failWrites = false
  failReads = false
  resetReadingPositionMemoryForTests()
  resetSessionViewPreferenceMemoryForTests()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
})

/** The one line a refused write left: it names the store and what was being
 *  done, and carries the store's own error. */
function expectOneLine(store: string, operation: 'save' | 'erase'): void {
  expect(warn).toHaveBeenCalledOnce()
  const [message, ...rest] = warn.mock.calls[0]!
  expect(message).toContain('[storage]')
  expect(message).toContain(store)
  expect(message).toContain(operation)
  expect(rest).toContain(refusal)
}

function logged(): string {
  return JSON.stringify(warn.mock.calls.map((call) => call.map(String)))
}

describe('a refused chat draft write', () => {
  it('leaves one line when the erase after a send is refused, so the sent text coming back has a cause', async () => {
    await writeNativeChatDraft('scope', 'the message just sent')
    failWrites = true
    await expect(writeNativeChatDraft('scope', '')).rejects.toBe(refusal)
    expectOneLine('chat draft', 'erase')
    // The failure the line explains: the sent text is still what a reopen reads.
    await expect(readNativeChatDraft('scope')).resolves.toBe('the message just sent')
  })

  it('leaves one line for a refused save, and never logs the draft itself', async () => {
    failWrites = true
    await expect(writeNativeChatDraft('scope', 'a private half-typed note')).rejects.toBe(refusal)
    expectOneLine('chat draft', 'save')
    expect(logged()).not.toContain('private half-typed')
  })

  it('leaves one line per refused write, not one per write queued behind it', async () => {
    failWrites = true
    const first = writeNativeChatDraft('scope', 'one')
    const second = writeNativeChatDraft('scope', 'two')
    await expect(first).rejects.toBe(refusal)
    await expect(second).rejects.toBe(refusal)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('still lands the next write after a refused one, and logs nothing for it', async () => {
    failWrites = true
    await expect(writeNativeChatDraft('scope', 'lost')).rejects.toBe(refusal)
    failWrites = false
    await writeNativeChatDraft('scope', 'kept')
    await expect(readNativeChatDraft('scope')).resolves.toBe('kept')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('logs nothing when the store takes the write', async () => {
    await writeNativeChatDraft('scope', 'fine')
    await writeNativeChatDraft('scope', '')
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('a refused chat photo preview write', () => {
  it('leaves one line for a refused save', async () => {
    failWrites = true
    await expect(writeNativeChatImagePreviews('session', { 'row-1': ['file:///a1.jpg'] })).rejects.toBe(refusal)
    expectOneLine('chat photo previews', 'save')
    expect(logged()).not.toContain('a1.jpg')
  })

  it('leaves one line for a refused erase, and a reopen still answers', async () => {
    await writeNativeChatImagePreviews('session', { 'row-1': ['file:///a1.jpg'] })
    failWrites = true
    await expect(writeNativeChatImagePreviews('session', {})).rejects.toBe(refusal)
    expectOneLine('chat photo previews', 'erase')
    await expect(readNativeChatImagePreviews('session')).resolves.toEqual({ 'row-1': ['file:///a1.jpg'] })
  })
})

describe('a refused queued-message echo write', () => {
  const echo: MobileNativeChatPendingMessage = {
    id: 'send-1',
    text: 'queued behind a busy agent',
    expectedOccurrence: 1,
    baselineTailMessageId: 'row-1',
    baselineResolved: true
  }

  it('leaves one line for a refused save, and never logs the message', async () => {
    failWrites = true
    await expect(writeNativeChatPendingEchoes('session', [echo])).rejects.toBe(refusal)
    expectOneLine('chat pending echoes', 'save')
    expect(logged()).not.toContain('busy agent')
  })

  it('leaves one line for a refused erase, and a reopen still answers', async () => {
    await writeNativeChatPendingEchoes('session', [echo])
    failWrites = true
    await expect(writeNativeChatPendingEchoes('session', [])).rejects.toBe(refusal)
    expectOneLine('chat pending echoes', 'erase')
    expect((await readNativeChatPendingEchoes('session'))?.map((item) => item.id)).toEqual(['send-1'])
  })
})

describe('a refused reading position write', () => {
  const key = readingPositionKey('host', 'worktree', 'docs/a.pdf')

  it('leaves one line when the flush on leaving a document is refused', async () => {
    await loadReadingPosition(key)
    failWrites = true
    saveReadingPosition(key, { kind: 'pdf', page: 47, pageCount: 200 })
    await expect(flushReadingPositions()).rejects.toBe(refusal)
    expectOneLine('reading positions', 'save')
  })

  it('leaves one line, not two, when the debounced write is refused, and the next save still lands', async () => {
    await loadReadingPosition(key)
    failWrites = true
    saveReadingPosition(key, { kind: 'pdf', page: 47, pageCount: 200 })
    await new Promise((resolve) => setTimeout(resolve, READING_POSITION_WRITE_DELAY_MS + 50))
    await flushReadingPositions()
    expectOneLine('reading positions', 'save')

    failWrites = false
    saveReadingPosition(key, { kind: 'pdf', page: 48, pageCount: 200 })
    await flushReadingPositions()
    expect(store.get('orca:readingPositions')).toContain('"page":48')
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('a refused session option write', () => {
  const record: NativeChatSessionOptionRecord = {
    agent: 'claude',
    valuesByModel: { opus: { effort: { value: 'max', source: 'dispatched' } } }
  }

  it('leaves one line for a refused save, and a reopen still answers', async () => {
    await writeSessionOptionRecord('scope', { ...record, valuesByModel: { opus: { effort: { value: 'high', source: 'dispatched' } } } })
    failWrites = true
    await expect(writeSessionOptionRecord('scope', record)).rejects.toBe(refusal)
    expectOneLine('session options', 'save')
    const reopened = await readSessionOptionRecord('scope')
    expect(reopened.status === 'record' ? reopened.record.valuesByModel.opus?.effort?.value : reopened).toBe('high')
  })

  // The read's refusal is not a write's, but it decides whether the hook may
  // write at all: told apart from "nothing stored", the hook holds its writes
  // instead of saving its live record over the picks it could not read.
  it('hands a refused read back as refused, not as nothing stored', async () => {
    await writeSessionOptionRecord('scope', record)
    failReads = true
    expect(await readSessionOptionRecord('scope')).toEqual({
      status: 'refused',
      error: new Error('storage unavailable')
    })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('a refused session view preference write', () => {
  it('leaves one line when the Focus view switch cannot be saved', async () => {
    failWrites = true
    await expect(saveChatFocusView(true)).rejects.toBe(refusal)
    expectOneLine('Focus view', 'save')
  })

  it('leaves one line when the default session view cannot be saved', async () => {
    failWrites = true
    await expect(saveDefaultSessionView('terminal')).rejects.toBe(refusal)
    expectOneLine('default session view', 'save')
  })

  it("leaves one line when a tab's chat or terminal choice cannot be saved", async () => {
    failWrites = true
    await expect(updateSessionViewOverride('host', 'worktree', 'tab', 'chat')).rejects.toBe(refusal)
    expectOneLine('session view overrides', 'save')
  })

  it("leaves one line naming the read when a tab's choice is refused because the saved ones cannot be read", async () => {
    failReads = true
    await expect(updateSessionViewOverride('host', 'worktree', 'tab', 'chat')).rejects.toThrow('could not be read')
    expect(warn).toHaveBeenCalledOnce()
    const [message, error] = warn.mock.calls[0]!
    expect(message).toContain('session view overrides')
    expect(String(error)).toContain('could not be read')
  })
})
