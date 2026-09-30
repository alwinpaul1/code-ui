import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostCredentialStatus, HostProfile } from '../transport/types'

type Doubles = {
  store: Map<string, string>
  writes: { key: string; value: string | null }[]
  hostsReject: boolean
  /** How the Keychain answered for host-1: `ready` hands over the profile, anything else drops it. */
  credential: HostCredentialStatus | 'not-listed'
  catalogReads: number
  lastConnectedAt: number | null
  /** Holds every store read open, which is how the two reads are made to answer out of order. */
  holdReads: boolean
  releaseReads: (() => void)[]
}

const doubles = vi.hoisted((): Doubles => ({
  store: new Map(),
  writes: [],
  hostsReject: false,
  credential: 'ready',
  catalogReads: 0,
  lastConnectedAt: null,
  holdReads: false,
  releaseReads: []
}))

const PROFILE: HostProfile = {
  id: 'host-1',
  name: 'Host One',
  endpoint: 'ws://host-1',
  deviceToken: 'token-1',
  publicKeyB64: 'key-1',
  lastConnected: 3
}

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    multiGet: async (keys: readonly string[]) => {
      // Read first, held after: a store answers with what it held when it was asked, which is what
      // makes a write that lands while the read is open something the answer cannot know about.
      const answer = keys.map((key) => [key, doubles.store.get(key) ?? null])
      if (doubles.holdReads) {
        await new Promise<void>((resolve) => doubles.releaseReads.push(resolve))
      }
      return answer
    },
    setItem: async (key: string, value: string) => {
      doubles.writes.push({ key, value })
      doubles.store.set(key, value)
    },
    removeItem: async (key: string) => {
      doubles.writes.push({ key, value: null })
      doubles.store.delete(key)
    },
    // Read back by the mirror after every write it makes, which is how the note follows what the
    // store took rather than what it was handed (ruling 35).
    getItem: async (key: string) => doubles.store.get(key) ?? null
  }
}))
/**
 * One Keychain, read two ways, the way host-store.ts reads it: the catalog keeps listing a host
 * whose credential read threw, with no profile, and loadHosts() is that catalog's ready profiles
 * only, so a locked host is simply absent from it.
 */
vi.mock('../transport/host-store', () => {
  const catalog = async () => {
    doubles.catalogReads += 1
    if (doubles.hostsReject) {
      throw new Error('the keychain would not answer')
    }
    if (doubles.credential === 'not-listed') {
      return []
    }
    const { deviceToken: _token, ...listed } = PROFILE
    const ready = doubles.credential === 'ready'
    return [{ ...listed, credentialStatus: doubles.credential, profile: ready ? PROFILE : null }]
  }
  return {
    loadHostCatalog: catalog,
    loadHosts: async () =>
      (await catalog()).flatMap((entry) => (entry.profile === null ? [] : [entry.profile]))
  }
})
// The connection the snapshot re-reads on: what the client context says for this host.
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => doubles.lastConnectedAt
}))

import { savePinnedIds } from '../storage/preferences'
import { writeLastVisitedWorktree } from '../worktree/last-visited-worktree-repo'
import { PAGE_STORAGE_MAX_VALUE_CHARS } from './page-storage-keys'
import {
  HOST_LOOKUP_FAILED_COPY,
  HOST_MISSING_COPY,
  HOST_UNAVAILABLE_COPY
} from '../transport/host-lookup'
import { usePageHostSnapshot, type PageHostSnapshotView } from './use-page-host-snapshot'

const PINS = 'orca:pins:host-1'
const LAST_VISITED = 'orca:last-visited-worktree'
const CHAT_TABS = 'orca:nativeChatTabs:host-1:wt-1'
const JOURNAL = 'orca:mobileStructuredSendOperations:v1'
/** The route every case below mounts for: the one page route with workspace-scoped keys. */
const SESSION_ROUTE = '/h/host-1/session/wt-1'

async function mount(routePathname = SESSION_ROUTE): Promise<{
  view: () => PageHostSnapshotView
  /** Renders again with whatever `doubles.lastConnectedAt` says now, as a connection would. */
  rerender: () => Promise<void>
}> {
  const held: { view: PageHostSnapshotView | null } = { view: null }
  function Probe(): null {
    held.view = usePageHostSnapshot('host-1', routePathname)
    return null
  }
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(Probe))
  })
  return {
    view: () => {
      if (held.view === null) {
        throw new Error('the hook did not mount')
      }
      return held.view
    },
    rerender: async () => {
      await act(async () => {
        renderer?.update(createElement(Probe))
      })
    }
  }
}

beforeEach(() => {
  doubles.store.clear()
  doubles.writes.length = 0
  doubles.hostsReject = false
  doubles.credential = 'ready'
  doubles.catalogReads = 0
  doubles.lastConnectedAt = null
  doubles.holdReads = false
  doubles.releaseReads.length = 0
})

function releaseReads(): void {
  for (const release of doubles.releaseReads.splice(0)) {
    release()
  }
}

describe('what the shell puts on every init', () => {
  it('carries the write the page just made, not the map it was primed with', async () => {
    doubles.store.set(PINS, '["one"]')
    const mounted = await mount()
    expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["one"]' })
    // The device repro: the page writes, its document reloads inside this same mount, and the
    // `init` that primes the new document has to carry the write rather than what came before it.
    await act(async () => {
      mounted.view().writeStorage(PINS, '["one","two"]')
    })
    expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["one","two"]' })
    expect(doubles.writes).toEqual([{ key: PINS, value: '["one","two"]' }])
  })

  it('drops a key the page removed', async () => {
    doubles.store.set(PINS, '["one"]')
    const mounted = await mount()
    await act(async () => {
      mounted.view().writeStorage(PINS, null)
    })
    expect(mounted.view().readStorage().storage).toEqual({})
  })

  it('carries what the app wrote from its own screens on the next init, not the one after', async () => {
    const mounted = await mount()
    expect(mounted.view().readStorage().storage).toEqual({})
    // The device repro: the session screen writes while the page is open, the document reloads,
    // and the `init` answering its ready is built from this map with no read in between. A mirror
    // only the store read refreshed would hand the drawer the repo the user left, an `init` late.
    writeLastVisitedWorktree({ hostId: 'host-1', worktreeId: 'host-1/repo/wt' })
    await savePinnedIds('host-1', new Set(['one']))
    expect(mounted.view().readStorage().storage).toEqual({
      [LAST_VISITED]: JSON.stringify({ hostId: 'host-1', worktreeId: 'host-1/repo/wt' }),
      [PINS]: '["one"]'
    })
  })

  it('keeps a write that landed while the store read was still open', async () => {
    doubles.store.set(PINS, '["stored"]')
    const mounted = await mount()
    doubles.holdReads = true
    await act(async () => {
      const seated = mounted.view().refreshStorage()
      mounted.view().writeStorage(PINS, '["just-written"]')
      releaseReads()
      await seated
    })
    // The read was already behind the write when it answered, so putting it back would undo a pin
    // the page has been told is set.
    expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["just-written"]' })
  })

  it('picks up what the app changed underneath, on the next ask', async () => {
    const mounted = await mount()
    expect(mounted.view().readStorage().storage).toEqual({})
    doubles.store.set(PINS, '["set-by-the-app"]')
    await act(async () => {
      mounted.view().refreshStorage()
    })
    expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["set-by-the-app"]' })
  })

  it('never carries another host key, whatever the store holds', async () => {
    doubles.store.set(PINS, '["mine"]')
    doubles.store.set('orca:pins:host-2', '["theirs"]')
    const mounted = await mount()
    await act(async () => {
      mounted.view().refreshStorage()
    })
    expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["mine"]' })
    // And a write for one is refused rather than mirrored, so a later read cannot answer with it.
    await act(async () => {
      mounted.view().writeStorage('orca:pins:host-2', '["theirs"]')
    })
    expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["mine"]' })
  })

  it("carries the session route's own workspace, and never the workspace beside it", async () => {
    doubles.store.set(CHAT_TABS, '{"tab-1":"chat"}')
    doubles.store.set('orca:nativeChatTabs:host-1:wt-2', '{"tab-9":"chat"}')
    const mounted = await mount()
    await act(async () => {
      mounted.view().refreshStorage()
    })
    expect(mounted.view().readStorage().storage).toEqual({ [CHAT_TABS]: '{"tab-1":"chat"}' })
    await act(async () => {
      mounted.view().writeStorage('orca:nativeChatTabs:host-1:wt-2', '{}')
    })
    expect(mounted.view().readStorage().storage).toEqual({ [CHAT_TABS]: '{"tab-1":"chat"}' })
  })

  it('hands a route that names no workspace neither of the two, so the line above is the route', async () => {
    doubles.store.set(CHAT_TABS, '{"tab-1":"chat"}')
    const mounted = await mount('/h/host-1')
    await act(async () => {
      mounted.view().refreshStorage()
    })
    expect(mounted.view().readStorage().storage).toEqual({})
  })

  it('leaves out a value the page would refuse the whole frame over, and says which', async () => {
    // The send journal is the real one: 48 unsettled sends put it past the cap, and `init` is
    // refined on that bound — so handing it over takes the session screen down rather than one key.
    const warned: unknown[][] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => warned.push(args)
    try {
      doubles.store.set(PINS, '["one"]')
      doubles.store.set(JOURNAL, 'x'.repeat(PAGE_STORAGE_MAX_VALUE_CHARS + 1))
      const mounted = await mount()
      await act(async () => {
        mounted.view().refreshStorage()
      })
      expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["one"]' })
    } finally {
      console.warn = warn
    }
    expect(JSON.stringify(warned)).toContain(JOURNAL)
  })

  it('carries the same journal at exactly the bound, so the drop above discriminates', async () => {
    const atBound = 'x'.repeat(PAGE_STORAGE_MAX_VALUE_CHARS)
    doubles.store.set(JOURNAL, atBound)
    const mounted = await mount()
    await act(async () => {
      mounted.view().refreshStorage()
    })
    expect(mounted.view().readStorage().storage).toEqual({ [JOURNAL]: atBound })
  })
})

describe('the host the page is handed', () => {
  it('is not built until the store has answered as well as the keychain', async () => {
    // Two unordered reads: the host is built from the snapshot and answers the page's pending
    // `ready` at once, so a profile that beat the store would prime the page from an empty map and
    // the list would paint unpinned until the catalog reply reconciled it.
    doubles.store.set(PINS, '["one"]')
    doubles.holdReads = true
    const mounted = await mount()
    expect(mounted.view().snapshot).toBeNull()
    await act(async () => {
      releaseReads()
    })
    expect(mounted.view().snapshot?.host.id).toBe('host-1')
    expect(mounted.view().readStorage().storage).toEqual({ [PINS]: '["one"]' })
  })
})

describe('a desktop the Keychain would not hand over', () => {
  // Review 2026-09-30: loadHosts() drops a host whose Keychain read throws, so the snapshot stayed
  // null with nothing said, the bridge never built a host, and the page never got `init` over a
  // desktop Home listed and the client had connected to. The catalog keeps listing it.
  it('says the desktop cannot be read right now, instead of leaving the page waiting on it', async () => {
    doubles.credential = 'temporarily-unavailable'
    const mounted = await mount('/h/host-1')
    expect(mounted.view().snapshot).toBeNull()
    expect(mounted.view().unavailable).toBe(HOST_UNAVAILABLE_COPY)
  })

  it('hands the page its host once the desktop connects after a locked Keychain read', async () => {
    doubles.credential = 'temporarily-unavailable'
    const mounted = await mount('/h/host-1')
    // The Keychain has woken: the client opener read it and connected.
    doubles.credential = 'ready'
    doubles.lastConnectedAt = 1_000
    await mounted.rerender()
    expect(mounted.view().snapshot?.host).toEqual({
      id: 'host-1',
      name: 'Host One',
      endpoint: 'ws://host-1',
      lastConnected: 3
    })
    expect(mounted.view().unavailable).toBeNull()
  })

  it('reads a locked desktop again once per new connection, never once per render', async () => {
    doubles.credential = 'temporarily-unavailable'
    doubles.lastConnectedAt = 500
    const mounted = await mount('/h/host-1')
    expect(doubles.catalogReads).toBe(1)
    await mounted.rerender()
    expect(doubles.catalogReads).toBe(1)
    doubles.lastConnectedAt = 1_000
    await mounted.rerender()
    expect(doubles.catalogReads).toBe(2)
    await mounted.rerender()
    expect(doubles.catalogReads).toBe(2)
    doubles.lastConnectedAt = 2_000
    await mounted.rerender()
    expect(doubles.catalogReads).toBe(3)
    expect(mounted.view().unavailable).toBe(HOST_UNAVAILABLE_COPY)
  })

  it('keeps saying so while the re-read is in flight, rather than flashing an empty page', async () => {
    doubles.credential = 'temporarily-unavailable'
    const mounted = await mount('/h/host-1')
    doubles.holdReads = true
    doubles.credential = 'ready'
    doubles.lastConnectedAt = 1_000
    await mounted.rerender()
    // The Keychain has answered; the store re-seat it waits on has not.
    expect(doubles.catalogReads).toBe(2)
    expect(mounted.view().unavailable).toBe(HOST_UNAVAILABLE_COPY)
    await act(async () => {
      releaseReads()
    })
    expect(mounted.view().snapshot?.host.id).toBe('host-1')
    expect(mounted.view().unavailable).toBeNull()
  })

  it('never reads a desktop that opened again when the connection comes back', async () => {
    // A live page is keyed on this snapshot's identity: reading again would rebuild its host.
    const mounted = await mount('/h/host-1')
    const opened = mounted.view().snapshot
    expect(opened?.host.id).toBe('host-1')
    doubles.lastConnectedAt = 1_000
    await mounted.rerender()
    doubles.lastConnectedAt = 2_000
    await mounted.rerender()
    expect(doubles.catalogReads).toBe(1)
    expect(mounted.view().snapshot).toBe(opened)
  })

  it('says the paired list could not be read when the catalog read rejects, then recovers', async () => {
    doubles.hostsReject = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const mounted = await mount('/h/host-1')
      expect(mounted.view().snapshot).toBeNull()
      expect(mounted.view().unavailable).toBe(HOST_LOOKUP_FAILED_COPY)
      doubles.hostsReject = false
      doubles.lastConnectedAt = 1_000
      await mounted.rerender()
      expect(mounted.view().snapshot?.host.id).toBe('host-1')
      expect(mounted.view().unavailable).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  it('words a desktop with no credential at all as one to pair again', async () => {
    doubles.credential = 'missing'
    const mounted = await mount('/h/host-1')
    expect(mounted.view().snapshot).toBeNull()
    expect(mounted.view().unavailable).toBe(HOST_MISSING_COPY)
  })

  it('leaves a desktop that is not in the catalog at all as the silent null', async () => {
    // The empty catalog: nothing paired, so nothing to say it cannot be read.
    doubles.credential = 'not-listed'
    const mounted = await mount('/h/host-1')
    expect(mounted.view().snapshot).toBeNull()
    expect(mounted.view().unavailable).toBeNull()
  })

  it('builds the host with nothing to say when the Keychain answers', async () => {
    const mounted = await mount()
    expect(mounted.view().snapshot?.host.id).toBe('host-1')
    expect(mounted.view().unavailable).toBeNull()
  })
})
