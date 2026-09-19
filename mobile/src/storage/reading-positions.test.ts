import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why a local mock: the shared in-memory one cannot be made to throw, and the
// module's fail-open contract is what these tests are for.
const memory = new Map<string, string>()
const storage = {
  failReads: false,
  failWrites: false,
  setItemCalls: 0,
  getItem: vi.fn(async (key: string) => {
    if (storage.failReads) {
      throw new Error('storage unavailable')
    }
    return memory.get(key) ?? null
  }),
  setItem: vi.fn(async (key: string, value: string) => {
    storage.setItemCalls += 1
    if (storage.failWrites) {
      throw new Error('disk full')
    }
    memory.set(key, value)
  })
}
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storage,
  ...storage
}))

const { KEY, module } = await (async () => {
  const module = await import('./reading-positions')
  return { KEY: 'orca:readingPositions', module }
})()
const {
  READING_POSITION_CAP,
  clearReadingPosition,
  flushReadingPositions,
  loadReadingPosition,
  readingPositionKey,
  resetReadingPositionMemoryForTests,
  saveReadingPosition
} = module

function stored(): Record<string, unknown> {
  const raw = memory.get(KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

beforeEach(() => {
  memory.clear()
  storage.failReads = false
  storage.failWrites = false
  storage.setItemCalls = 0
  resetReadingPositionMemoryForTests()
})

afterEach(() => {
  resetReadingPositionMemoryForTests()
})

describe('reading positions survive a process death', () => {
  it('round-trips a PDF page and a scroll offset through storage', async () => {
    const pdf = readingPositionKey('h', 'w', 'a.pdf')
    const md = readingPositionKey('h', 'w', 'a.md')
    await loadReadingPosition(pdf)
    saveReadingPosition(pdf, { kind: 'pdf', page: 47, pageCount: 200 })
    saveReadingPosition(md, { kind: 'scroll', offset: 1234.5, contentHeight: 5000 })
    await flushReadingPositions()
    resetReadingPositionMemoryForTests()

    expect(await loadReadingPosition(pdf)).toMatchObject({ kind: 'pdf', page: 47, pageCount: 200 })
    expect(await loadReadingPosition(md)).toMatchObject({
      kind: 'scroll',
      offset: 1234.5,
      contentHeight: 5000
    })
  })

  it('coalesces a burst of saves into one write', async () => {
    vi.useFakeTimers()
    try {
      const key = readingPositionKey('h', 'w', 'a.md')
      await loadReadingPosition(key)
      for (let y = 100; y < 3000; y += 100) {
        saveReadingPosition(key, { kind: 'scroll', offset: y, contentHeight: 5000 })
      }
      await vi.advanceTimersByTimeAsync(1000)
      expect(storage.setItemCalls).toBe(1)
      expect(stored()[key]).toMatchObject({ offset: 2900 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a save before hydration finishes is not lost to the read that lands after it', async () => {
    memory.set(
      KEY,
      JSON.stringify({
        [readingPositionKey('h', 'w', 'old.pdf')]: {
          kind: 'pdf',
          page: 3,
          pageCount: 9,
          savedAt: 1
        }
      })
    )
    const key = readingPositionKey('h', 'w', 'a.pdf')
    // No await: the read is in flight when the save arrives.
    const loading = loadReadingPosition(key)
    saveReadingPosition(key, { kind: 'pdf', page: 5, pageCount: 10 })
    await loading
    await flushReadingPositions()
    expect(stored()[key]).toMatchObject({ page: 5 })
    expect(stored()[readingPositionKey('h', 'w', 'old.pdf')]).toMatchObject({ page: 3 })
  })
})

describe('the top of a document is not a position', () => {
  it('forgets a document paged back to page 1', async () => {
    const key = readingPositionKey('h', 'w', 'a.pdf')
    await loadReadingPosition(key)
    saveReadingPosition(key, { kind: 'pdf', page: 47, pageCount: 200 })
    saveReadingPosition(key, { kind: 'pdf', page: 1, pageCount: 200 })
    await flushReadingPositions()
    expect(stored()).toEqual({})
  })

  it('treats a few pixels of scroll as the top', async () => {
    const key = readingPositionKey('h', 'w', 'a.md')
    await loadReadingPosition(key)
    saveReadingPosition(key, { kind: 'scroll', offset: 900, contentHeight: 5000 })
    saveReadingPosition(key, { kind: 'scroll', offset: 12, contentHeight: 5000 })
    await flushReadingPositions()
    expect(stored()).toEqual({})
  })

  it('ignores a position that cannot be one', async () => {
    const key = readingPositionKey('h', 'w', 'a.md')
    await loadReadingPosition(key)
    saveReadingPosition(key, { kind: 'scroll', offset: Number.NaN, contentHeight: 5000 })
    saveReadingPosition(key, { kind: 'scroll', offset: 300, contentHeight: 0 })
    await flushReadingPositions()
    expect(stored()).toEqual({})
    expect(await loadReadingPosition(key)).toBeNull()
  })
})

describe('a clear that lands before the blob is read', () => {
  it('is not undone by the read', async () => {
    // Review 2026-09-19: scrolling back to the top in the first ms of an
    // open cleared memory only, and hydration put the stored entry back.
    const key = readingPositionKey('h', 'w', 'a.md')
    memory.set(
      KEY,
      JSON.stringify({ [key]: { kind: 'scroll', offset: 900, contentHeight: 5000, savedAt: 1 } })
    )
    clearReadingPosition(key)
    expect(await loadReadingPosition(key)).toBeNull()
    await flushReadingPositions()
    expect(stored()).toEqual({})
  })
})

describe('the blob stays bounded', () => {
  it('drops the oldest entries past the cap on the next write', async () => {
    await loadReadingPosition('warm')
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now')
    for (let i = 0; i < READING_POSITION_CAP + 20; i += 1) {
      spy.mockReturnValue(now + i)
      saveReadingPosition(readingPositionKey('h', 'w', `doc-${i}.pdf`), {
        kind: 'pdf',
        page: 2,
        pageCount: 3
      })
    }
    spy.mockRestore()
    await flushReadingPositions()
    const keys = Object.keys(stored())
    expect(keys).toHaveLength(READING_POSITION_CAP)
    expect(keys).not.toContain(readingPositionKey('h', 'w', 'doc-0.pdf'))
    expect(keys).not.toContain(readingPositionKey('h', 'w', 'doc-19.pdf'))
    expect(keys).toContain(readingPositionKey('h', 'w', 'doc-20.pdf'))
    expect(keys).toContain(readingPositionKey('h', 'w', `doc-${READING_POSITION_CAP + 19}.pdf`))
  })
})

describe('storage trouble fails open', () => {
  it('reads a corrupt blob as empty and replaces it on the next save', async () => {
    memory.set(KEY, '{not json')
    const key = readingPositionKey('h', 'w', 'a.pdf')
    expect(await loadReadingPosition(key)).toBeNull()
    saveReadingPosition(key, { kind: 'pdf', page: 2, pageCount: 3 })
    await flushReadingPositions()
    expect(stored()[key]).toMatchObject({ page: 2 })
  })

  it('skips entries of the wrong shape and keeps the rest', async () => {
    const good = readingPositionKey('h', 'w', 'good.pdf')
    memory.set(
      KEY,
      JSON.stringify({
        [good]: { kind: 'pdf', page: 4, pageCount: 8, savedAt: 1 },
        bad1: { kind: 'pdf', page: 'four', pageCount: 8, savedAt: 1 },
        bad2: { kind: 'scroll', offset: -5, contentHeight: 100, savedAt: 1 },
        bad3: 'nope'
      })
    )
    expect(await loadReadingPosition(good)).toMatchObject({ page: 4 })
    expect(await loadReadingPosition('bad1')).toBeNull()
    expect(await loadReadingPosition('bad2')).toBeNull()
    expect(await loadReadingPosition('bad3')).toBeNull()
  })

  it('starts at the top when storage cannot be read, and does not overwrite it', async () => {
    memory.set(
      KEY,
      JSON.stringify({
        [readingPositionKey('h', 'w', 'other.pdf')]: {
          kind: 'pdf',
          page: 9,
          pageCount: 9,
          savedAt: 1
        }
      })
    )
    storage.failReads = true
    const key = readingPositionKey('h', 'w', 'a.pdf')
    expect(await loadReadingPosition(key)).toBeNull()
    saveReadingPosition(key, { kind: 'pdf', page: 2, pageCount: 3 })
    await flushReadingPositions()
    // Nothing written: a write over an unread blob would drop other.pdf.
    expect(storage.setItemCalls).toBe(0)
    expect(stored()[readingPositionKey('h', 'w', 'other.pdf')]).toMatchObject({ page: 9 })

    // Storage comes back: the next read hydrates, and the position saved
    // meanwhile lands beside the old one.
    storage.failReads = false
    expect(await loadReadingPosition(key)).toMatchObject({ page: 2 })
    await flushReadingPositions()
    expect(stored()[key]).toMatchObject({ page: 2 })
    expect(stored()[readingPositionKey('h', 'w', 'other.pdf')]).toMatchObject({ page: 9 })
  })

  it('a failed write does not stop the next one', async () => {
    const key = readingPositionKey('h', 'w', 'a.pdf')
    await loadReadingPosition(key)
    storage.failWrites = true
    saveReadingPosition(key, { kind: 'pdf', page: 2, pageCount: 3 })
    await expect(flushReadingPositions()).rejects.toThrow('disk full')
    storage.failWrites = false
    saveReadingPosition(key, { kind: 'pdf', page: 3, pageCount: 3 })
    await flushReadingPositions()
    expect(stored()[key]).toMatchObject({ page: 3 })
  })

  it('clearing a document nobody stored writes nothing', async () => {
    await loadReadingPosition('warm')
    clearReadingPosition(readingPositionKey('h', 'w', 'never.pdf'))
    await flushReadingPositions()
    expect(storage.setItemCalls).toBe(0)
  })
})
