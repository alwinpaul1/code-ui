import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The native splash stays up until the first host-catalog read settles, so a paired phone goes
 * from splash to the host list with no blank body between (2026-09-29). Capped at 1 s so a slow
 * Keychain cannot hold it open.
 */
const store = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('./host-store', () => ({ loadHostCatalog: store.load }))

import {
  HOST_CATALOG_SPLASH_CAP_MS,
  shouldHideSplash,
  useHostCatalogWarmup
} from './use-host-catalog-warmup'

describe('splash hold on the first host-catalog read', () => {
  let renderer: ReactTestRenderer | null = null
  let seen: boolean[] = []
  function Probe() {
    seen.push(useHostCatalogWarmup())
    return null
  }
  async function mount() {
    seen = []
    await act(async () => {
      renderer = create(createElement(Probe))
    })
  }
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    store.load.mockReset()
    vi.useRealTimers()
  })

  it('caps the hold at about a second', () => {
    expect(HOST_CATALOG_SPLASH_CAP_MS).toBeGreaterThanOrEqual(500)
    expect(HOST_CATALOG_SPLASH_CAP_MS).toBeLessThanOrEqual(1500)
  })

  it('is not ready while the read is in flight, and ready once it settles', async () => {
    let release: (v: unknown[]) => void = () => {}
    store.load.mockReturnValue(new Promise((r) => (release = r)))
    await mount()
    expect(seen.at(-1)).toBe(false)
    await act(async () => release([]))
    expect(seen.at(-1)).toBe(true)
  })

  it('is ready when the read rejects, so a failed read cannot pin the splash', async () => {
    store.load.mockRejectedValue(new Error('keychain'))
    await mount()
    expect(seen.at(-1)).toBe(true)
  })

  it('stops holding the splash at the cap when the read never settles', async () => {
    vi.useFakeTimers()
    store.load.mockReturnValue(new Promise(() => {}))
    await mount()
    expect(seen.at(-1)).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOST_CATALOG_SPLASH_CAP_MS - 1)
    })
    expect(seen.at(-1)).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(seen.at(-1)).toBe(true)
  })

  it('hides the splash only when layout, fonts and the catalog are all ready', () => {
    expect(shouldHideSplash({ layoutReady: true, fontsReady: true, catalogReady: true })).toBe(true)
    expect(shouldHideSplash({ layoutReady: true, fontsReady: true, catalogReady: false })).toBe(
      false
    )
    expect(shouldHideSplash({ layoutReady: false, fontsReady: true, catalogReady: true })).toBe(
      false
    )
    expect(shouldHideSplash({ layoutReady: true, fontsReady: false, catalogReady: true })).toBe(
      false
    )
  })

  it('is wired into the root layout: the splash decision goes through shouldHideSplash', () => {
    const src = readFileSync(join(import.meta.dirname, '../../app/_layout.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(src).toContain('useHostCatalogWarmup()')
    expect(src).toMatch(/shouldHideSplash\(\{[^}]*catalogReady/)
    expect(src).not.toMatch(/layoutReadyRef\.current && fontsReady\)/)
  })
})
