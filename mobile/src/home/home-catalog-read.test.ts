import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOME_CATALOG_READ_CAP_MS, readHomeCatalog } from './home-catalog-read'

type Deps = Parameters<typeof readHomeCatalog>[0]
function deps(over: Partial<Deps> = {}) {
  return {
    load: async () => [],
    capMs: 50,
    isStale: () => false,
    readBefore: false,
    keptList: false,
    retry: false,
    onCatalog: vi.fn(),
    onReadFailed: vi.fn(),
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
    expect(d.onReadFailed).not.toHaveBeenCalled()
  })

  it('applies a list that lands after the cap, unless the pass went stale', async () => {
    let land: (v: never[]) => void = () => {}
    const d = deps({ load: () => new Promise((r) => (land = r)) })
    await readHomeCatalog(d)
    expect(d.abandonLoad).toHaveBeenCalledTimes(1)
    expect(d.onReadFailed).toHaveBeenCalledTimes(1)
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

  it('does not mark the read failed for a pass that is already stale', async () => {
    const d = deps({ load: () => Promise.reject(new Error('x')), isStale: () => true })
    await readHomeCatalog(d)
    expect(d.onReadFailed).not.toHaveBeenCalled()
  })

  it('says a rejected first read could not read the desktops, not that it shows the pairing screen', async () => {
    const d = deps({ load: () => Promise.reject(new Error('keychain locked')) })
    await readHomeCatalog(d)
    expect(d.onReadFailed).toHaveBeenCalledTimes(1)
    expect(d.onCatalog).not.toHaveBeenCalled()
    const line = String(d.warn.mock.calls[0]![0])
    expect(line).toMatch(/first read failed; showing that the paired desktops could not be read/)
    expect(line).not.toMatch(/pairing screen/)
  })

  it('names a failed retry as a retry, not as the first read', async () => {
    const d = deps({ load: () => Promise.reject(new Error('keychain locked')), retry: true })
    await readHomeCatalog(d)
    expect(String(d.warn.mock.calls[0]![0])).toMatch(/host catalog retry failed/)
  })

  it('words the timeout by whether a list is being kept', async () => {
    const first = deps({ load: () => new Promise(() => {}) })
    await readHomeCatalog(first)
    expect(String(first.warn.mock.calls[0]![0])).toMatch(
      /timed out after 50 ms; showing that the paired desktops could not be read/
    )
    expect(String(first.warn.mock.calls[0]![0])).not.toMatch(/pairing screen/)
    const again = deps({ load: () => new Promise(() => {}), keptList: true })
    await readHomeCatalog(again)
    expect(String(again.warn.mock.calls[0]![0])).toMatch(/timed out after 50 ms; keeping the list/)
  })
})
