import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Edit host after its host lookup failed. The screen looked its desktop up once per host id, so a
 * catalog read that rejected at open (a locked Keychain, storage still waking) left it saying the
 * desktop could not be read for as long as it stayed open, with no way to try again, after that
 * desktop had connected and so proven its credential readable (review, 2026-09-30). CLAUDE.md
 * "Nothing stays stale once the relay connects": a failed load is read again once per NEW
 * connection. A loaded one is never read again, or a reconnect would overwrite what is being typed.
 *
 * The real host store and lookup run; AsyncStorage and the Keychain under them are doubles.
 * `useLastConnectedAt` is the connection counter the screen keys its re-read to.
 */

const storage = vi.hoisted(() => ({
  hosts: null as string | null,
  hostsRead: null as Error | null,
  /** How many times the host list was read: one per catalog lookup. */
  hostListReads: 0,
  locked: new Set<string>(),
  tokens: new Map<string, string>(),
  hostId: 'host-1' as string | undefined,
  lastConnectedAt: null as number | null
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (key === 'orca:hosts') {
        storage.hostListReads += 1
        if (storage.hostsRead) {
          throw storage.hostsRead
        }
        return storage.hosts
      }
      return null
    },
    setItem: async () => undefined,
    removeItem: async () => undefined
  }
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: async (key: string) => {
    const hostId = [...storage.locked, ...storage.tokens.keys()].find((id) => key.endsWith(id))
    if (hostId && storage.locked.has(hostId)) {
      throw new Error('keychain locked')
    }
    return hostId ? (storage.tokens.get(hostId) ?? null) : null
  },
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined
}))
vi.mock('../transport/host-credential-cleanup', () => ({
  cancelPendingHostCredentialCleanup: async () => undefined,
  recordHostCredentialCleanupIntent: async () => undefined,
  scheduleHostCredentialCleanup: async () => undefined,
  retryPendingHostCredentialCleanups: async () => undefined
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: storage.hostId }),
  useRouter: () => ({ back: vi.fn() })
}))
vi.mock('../transport/client-context', () => ({
  useForceReconnect: () => undefined,
  usePrimeHosts: () => () => undefined
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => storage.lastConnectedAt
}))

import EditHostScreen from '../../app/h/[hostId]/edit'
import { ThemeProvider } from '../theme/theme-context'
import { resetHostStoreForTests } from '../transport/host-store'
import { resetMobileRelayHostOverlayStoreForTests } from '../transport/mobile-relay-host-overlay-store'

const stored = (id: string, name: string) => ({
  id,
  name,
  endpoint: `ws://192.168.1.10:676${id.slice(-1)}`,
  publicKeyB64: `key-${id}`,
  lastConnected: 0
})

const FAILED_READ = "Couldn't read your paired desktops. Reopen this screen in a moment."

let renderer: ReactTestRenderer | null = null
let scheme: 'light' | 'dark' = 'light'

function tree(): ReactTestRenderer {
  if (renderer === null) {
    throw new Error('Edit host is not open')
  }
  return renderer
}

function lines(): string[] {
  return tree()
    .root.findAll((node) => String(node.type) === 'Text')
    .map((node) => {
      const children = node.props.children as unknown
      return Array.isArray(children) ? children.join('') : String(children)
    })
}

function input(label: 'Name' | 'Address'): ReactTestInstance | undefined {
  return tree()
    .root.findAll((node) => String(node.type) === 'TextInput')
    .find((node) => node.props.accessibilityLabel === label)
}

const screen = () => (
  <ThemeProvider initialPreference={scheme}>
    <EditHostScreen />
  </ThemeProvider>
)

async function openEdit(): Promise<void> {
  await act(async () => {
    renderer = create(screen())
  })
}

/** A render with nothing new: the parent re-rendered, the connection did not move. */
async function rerender(): Promise<void> {
  await act(async () => {
    renderer?.update(screen())
  })
}

/** The client opener read the credential and the desktop connected (again). */
async function connectedAt(at: number): Promise<void> {
  storage.lastConnectedAt = at
  await rerender()
}

async function typeName(value: string): Promise<void> {
  const field = input('Name')
  if (field === undefined) {
    throw new Error('The Name field is not on screen: the form never loaded')
  }
  await act(async () => {
    ;(field.props.onChangeText as (text: string) => void)(value)
  })
}

beforeEach(() => {
  resetHostStoreForTests()
  resetMobileRelayHostOverlayStoreForTests()
  storage.hosts = JSON.stringify([stored('host-1', 'Studio Mac'), stored('host-2', 'Laptop')])
  storage.hostsRead = null
  storage.hostListReads = 0
  storage.locked = new Set()
  storage.tokens = new Map([
    ['host-1', 'token-1'],
    ['host-2', 'token-2']
  ])
  storage.hostId = 'host-1'
  storage.lastConnectedAt = null
  scheme = 'light'
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('Edit host after its host lookup failed', () => {
  it.each(['light', 'dark'] as const)(
    'reads the desktop again once it connects after a failed catalog read (%s)',
    async (theme) => {
      scheme = theme
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      storage.hostsRead = new Error('database disk image is malformed')
      await openEdit()
      expect(lines()).toContain(FAILED_READ)
      expect(input('Name')).toBeUndefined()

      storage.hostsRead = null
      await connectedAt(1_000)

      expect(lines()).not.toContain(FAILED_READ)
      expect(input('Name')?.props.value).toBe('Studio Mac')
      expect(input('Address')?.props.value).toBe('192.168.1.10:6761')
    }
  )

  it('reads a Keychain-locked desktop again once it connects', async () => {
    storage.locked.add('host-1')
    await openEdit()
    expect(lines().some((text) => text.includes("can't be read right now"))).toBe(true)

    storage.locked.clear()
    await connectedAt(1_000)

    expect(lines().some((text) => text.includes("can't be read right now"))).toBe(false)
    expect(input('Name')?.props.value).toBe('Studio Mac')
  })

  it('keeps what is being typed when the desktop reconnects after a failed read recovered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    await openEdit()
    storage.hostsRead = null
    await connectedAt(1_000)
    await typeName('Studio Mac mini')
    const reads = storage.hostListReads

    // The stored name changes under the form; a re-read would put it over the typed one.
    storage.hosts = JSON.stringify([stored('host-1', 'Renamed Mac')])
    await connectedAt(2_000)
    await connectedAt(3_000)

    expect(storage.hostListReads).toBe(reads)
    expect(input('Name')?.props.value).toBe('Studio Mac mini')
  })

  it('keeps what is being typed when a desktop that loaded at once reconnects', async () => {
    await openEdit()
    await typeName('Studio Mac mini')
    storage.hosts = JSON.stringify([stored('host-1', 'Renamed Mac')])
    await connectedAt(1_000)

    expect(storage.hostListReads).toBe(1)
    expect(input('Name')?.props.value).toBe('Studio Mac mini')
  })

  it('reads a desktop that stays unreadable once per new connection, not once per render', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    await openEdit()
    expect(storage.hostListReads).toBe(1)

    await connectedAt(1_000)
    expect(storage.hostListReads).toBe(2)

    await rerender()
    await rerender()
    expect(storage.hostListReads).toBe(2)

    await connectedAt(2_000)
    expect(storage.hostListReads).toBe(3)
    expect(lines()).toContain(FAILED_READ)
  })

  it('says the host is missing and looks nothing up when the route has no host id', async () => {
    storage.hostId = undefined
    await openEdit()
    await connectedAt(1_000)

    expect(lines()).toContain('Missing host.')
    expect(storage.hostListReads).toBe(0)
  })
})
