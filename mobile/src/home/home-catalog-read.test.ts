import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOME_CATALOG_READ_CAP_MS, readHomeCatalog } from './home-catalog-read'

type Deps = Parameters<typeof readHomeCatalog>[0]
function deps(over: Partial<Deps> = {}) {
  return {
    load: async () => [],
    capMs: 50,
    isStale: () => false,
    keptList: false,
    onCatalog: vi.fn(),
    onFailOpen: vi.fn(),
    abandonLoad: vi.fn(),
    warn: vi.fn(),
    ...over
  } as Deps & { warn: ReturnType<typeof vi.fn> }
}

describe('bounded home catalog read', () => {
  afterEach(() => vi.useRealTimers())

  it('caps a stuck read in seconds, not never', () => {
    expect(HOME_CATALOG_READ_CAP_MS).toBeGreaterThanOrEqual(2000)
    expect(HOME_CATALOG_READ_CAP_MS).toBeLessThanOrEqual(10000)
  })

  it('hands a finished list over and stays quiet', async () => {
    const d = deps({ load: async () => [{ id: 'a' } as never] })
    await readHomeCatalog(d)
    expect(d.onCatalog).toHaveBeenCalledWith([{ id: 'a' }])
    expect(d.warn).not.toHaveBeenCalled()
    expect(d.onFailOpen).not.toHaveBeenCalled()
  })

  it('applies a list that lands after the cap, unless the pass went stale', async () => {
    let land: (v: never[]) => void = () => {}
    const d = deps({ load: () => new Promise((r) => (land = r)) })
    await readHomeCatalog(d)
    expect(d.abandonLoad).toHaveBeenCalledTimes(1)
    expect(d.onFailOpen).toHaveBeenCalledTimes(1)
    land([])
    await Promise.resolve()
    await Promise.resolve()
    expect(d.onCatalog).toHaveBeenCalledTimes(1)

    let landStale: (v: never[]) => void = () => {}
    let stale = false
    const s = deps({ load: () => new Promise((r) => (landStale = r)), isStale: () => stale })
    await readHomeCatalog(s)
    stale = true
    landStale([])
    await Promise.resolve()
    await Promise.resolve()
    expect(s.onCatalog).not.toHaveBeenCalled()
  })

  it('does not fail open for a pass that is already stale', async () => {
    const d = deps({ load: () => Promise.reject(new Error('x')), isStale: () => true })
    await readHomeCatalog(d)
    expect(d.onFailOpen).not.toHaveBeenCalled()
  })

  it('words the timeout by whether a list is being kept', async () => {
    const first = deps({ load: () => new Promise(() => {}) })
    await readHomeCatalog(first)
    expect(String(first.warn.mock.calls[0]![0])).toMatch(
      /timed out after 50 ms; showing the pairing/
    )
    const again = deps({ load: () => new Promise(() => {}), keptList: true })
    await readHomeCatalog(again)
    expect(String(again.warn.mock.calls[0]![0])).toMatch(/timed out after 50 ms; keeping the list/)
  })
})
