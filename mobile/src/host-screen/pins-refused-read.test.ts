import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('../host-route-exit', () => ({ leaveHostRoute: vi.fn() }))
vi.mock('../transport/host-removal-lifecycle', () => ({ removeHostAndCloseClient: vi.fn() }))

import { useRouter } from 'expo-router'
import { loadPinnedIds, savePinnedIds } from '../storage/preferences'
import type { Worktree } from '../worktree/workspace-list-sections'
import { useHostWorktreeActions } from './use-host-worktree-actions'
import type { HostScreenState } from './use-host-screen-state'

// A host's pinned worktrees sit under one key, so each save is the whole set.
// A read AsyncStorage refused came back as no pins, the host screen took that
// for the host's pins, and the next pin toggle wrote a one-entry set over
// every pin stored before (2026-09-30). The catalog heals it from the host's
// own pins on its next load; this pins that the toggle no longer erases them.
// The refusal is driven for real: getItem rejects.

const HOST = 'host-a'

describe('a pin toggled after the stored pins could not be read', () => {
  let renderer: ReactTestRenderer | null = null
  let toggle: (worktreeId: string) => void = () => undefined
  let shown = new Set<string>()
  let warn: MockInstance<typeof console.warn>

  function Probe({ loaded }: { loaded: Set<string> }): null {
    const [pinnedIds, setPinnedIds] = useState(loaded)
    const [worktrees, setWorktrees] = useState<Worktree[]>([])
    shown = pinnedIds
    const actions = useHostWorktreeActions({
      client: null,
      connState: 'connected',
      embedded: false,
      fetchWorktrees: () => Promise.resolve(),
      forgetHostClient: () => undefined,
      hostId: HOST,
      pathname: `/h/${HOST}`,
      router: useRouter(),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: togglePin reads exactly these members of the state; no other one is reachable from it.
      state: {
        pinnedIds,
        setPinnedIds,
        worktrees,
        setWorktrees,
        setLastKnownWorktrees: () => undefined
      } as unknown as HostScreenState
    })
    toggle = actions.togglePin
    return null
  }
  async function showHost(): Promise<void> {
    const loaded = await loadPinnedIds(HOST)
    await act(async () => {
      renderer = create(createElement(Probe, { loaded }))
    })
  }
  async function pin(worktreeId: string): Promise<void> {
    await act(async () => {
      toggle(worktreeId)
    })
    for (let round = 0; round < 5; round += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }
  const refuseReads = (): MockInstance =>
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('storage unavailable'))
  const storedPins = async (): Promise<string[]> => [...(await loadPinnedIds(HOST))].sort()

  beforeEach(async () => {
    await AsyncStorage.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await savePinnedIds(HOST, new Set(['w1', 'w2']))
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  it('keeps every stored pin when the store still cannot be read, and says why', async () => {
    const reads = refuseReads()
    await showHost()
    expect(shown).toEqual(new Set())
    await pin('w3')
    expect(shown).toEqual(new Set(['w3']))
    reads.mockRestore()
    expect(await storedPins()).toEqual(['w1', 'w2'])
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.some((line) => line.includes('could not read the pinned worktrees'))).toBe(true)
    expect(lines.some((line) => line.includes('could not save a pin'))).toBe(true)
  })

  it('adds the pin to the stored ones once the store reads again', async () => {
    const reads = refuseReads()
    await showHost()
    reads.mockRestore()
    await pin('w3')
    expect(await storedPins()).toEqual(['w1', 'w2', 'w3'])
  })

  it('takes one pin out of the stored ones, and keeps the rest', async () => {
    const reads = refuseReads()
    await showHost()
    reads.mockRestore()
    await pin('w3')
    await pin('w3')
    expect(await storedPins()).toEqual(['w1', 'w2'])
  })

  // Nothing to keep: no pins stored, or a value that will not parse, is
  // written over with the pins the screen shows, as before.
  it('stores a first pin for a host with none, and the shown pins over a value it cannot parse', async () => {
    await AsyncStorage.clear()
    await showHost()
    await pin('w1')
    expect(await storedPins()).toEqual(['w1'])
    await AsyncStorage.setItem(`orca:pins:${HOST}`, '{not json')
    await pin('w2')
    expect(await storedPins()).toEqual(['w1', 'w2'])
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('could not save a pin'))).toEqual([])
  })
})
