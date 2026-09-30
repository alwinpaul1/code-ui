import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Accounts after its host lookup failed. The screen looked its desktop up once per host id, so a
 * catalog read that rejected at open (a locked Keychain, storage still waking) left the header with
 * no name and "Connecting to host…" for as long as the screen stayed open, over a desktop that had
 * connected since (review, 2026-09-30). The rule it broke is CLAUDE.md "Nothing stays stale once
 * the relay connects": a failed load is read again once per NEW connection, never once per render.
 *
 * The real host store and lookup run; AsyncStorage and the Keychain under them are doubles. The
 * host-list read rejects the way a failing storage read does, and the Keychain the way a locked one
 * does. `useLastConnectedAt` is the connection counter the screen keys its re-read to.
 */

const storage = vi.hoisted(() => ({
  hosts: null as string | null,
  hostsRead: null as Error | null,
  /** How many times the host list was read: one per catalog lookup. */
  hostListReads: 0,
  locked: new Set<string>(),
  tokens: new Map<string, string>(),
  hostId: 'host-1' as string | undefined,
  lastConnectedAt: null as number | null,
  connection: { state: 'disconnected' as 'connected' | 'connecting' | 'disconnected' }
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
  Alert: { alert: vi.fn() },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useFocusEffect(effect: () => void | (() => void)): void {
      React.useEffect(effect, [effect])
    },
    useLocalSearchParams: () => ({ hostId: storage.hostId }),
    useRouter: () => ({ back: vi.fn() })
  }
})
vi.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Path: 'Path' }))
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  withSpring: (to: number) => to,
  withTiming: (to: number) => to
}))
vi.mock('../platform/haptics', () => ({ triggerSelection: () => {} }))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  RefreshCw: 'RefreshCw',
  RotateCcw: 'RotateCcw',
  User: 'User'
}))
vi.mock('../components/AgentIcons', () => ({ ClaudeIcon: 'ClaudeIcon', OpenAIIcon: 'OpenAIIcon' }))
// 'disconnected' comes with no client, which is what a desktop the opener could not read gets.
// The subscription never sends a snapshot, so a connected screen sits on "Loading accounts…".
vi.mock('../transport/client-context', () => {
  const client = {
    sendRequest: async () => ({ id: 'status', ok: true, result: { capabilities: [] } }),
    subscribe: () => () => {}
  }
  return {
    useHostClient: () =>
      storage.connection.state === 'disconnected'
        ? { client: null, state: 'disconnected' }
        : { client, state: storage.connection.state }
  }
})
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => storage.lastConnectedAt
}))

import AccountsScreen from '../../app/h/[hostId]/accounts'
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

function lines(): string[] {
  if (renderer === null) {
    throw new Error('Accounts is not open')
  }
  return renderer.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => {
      const children = node.props.children as unknown
      return Array.isArray(children) ? children.join('') : String(children)
    })
}

let renderer: ReactTestRenderer | null = null
let scheme: 'light' | 'dark' = 'light'

const screen = () => (
  <ThemeProvider initialPreference={scheme}>
    <AccountsScreen />
  </ThemeProvider>
)

async function openAccounts(): Promise<void> {
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
  storage.connection.state = 'connected'
  await rerender()
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
  storage.connection.state = 'disconnected'
  scheme = 'light'
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('Accounts after its host lookup failed', () => {
  it.each(['light', 'dark'] as const)(
    "shows the desktop's name once it connects after a failed catalog read (%s)",
    async (theme) => {
      scheme = theme
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      storage.hostsRead = new Error('database disk image is malformed')
      await openAccounts()
      expect(lines()).toContain(FAILED_READ)
      expect(lines()).not.toContain('Studio Mac')

      // Storage recovers and the opener, reading it, connects the desktop.
      storage.hostsRead = null
      await connectedAt(1_000)
      expect(lines()).toContain('Studio Mac')
      expect(lines()).toContain('Loading accounts…')

      // The connection drops and the client reconnects: the placeholder names the desktop.
      storage.connection.state = 'connecting'
      await rerender()
      expect(lines()).toContain('Connecting to Studio Mac…')
      expect(lines()).not.toContain('Connecting to host…')
    }
  )

  it('reads a desktop that stays unreadable once per new connection, not once per render', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    await openAccounts()
    expect(storage.hostListReads).toBe(1)

    await connectedAt(1_000)
    expect(storage.hostListReads).toBe(2)

    // Failed again on this connection: nothing more until the next one, however often it renders.
    await rerender()
    await rerender()
    expect(storage.hostListReads).toBe(2)

    await connectedAt(2_000)
    expect(storage.hostListReads).toBe(3)
    expect(lines()).not.toContain('Studio Mac')
  })

  it('does not read a desktop it already named again when it reconnects', async () => {
    await openAccounts()
    expect(lines()).toContain('Studio Mac')
    const reads = storage.hostListReads

    storage.hosts = JSON.stringify([stored('host-1', 'Renamed Mac')])
    await connectedAt(1_000)
    await connectedAt(2_000)

    expect(storage.hostListReads).toBe(reads)
    expect(lines()).toContain('Studio Mac')
  })

  it('does not keep the previous desktop in the header when the screen moves to another one', async () => {
    await openAccounts()
    expect(lines()).toContain('Studio Mac')

    // Expo Router reuses the screen for another desktop, whose lookup fails.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    storage.hostId = 'host-2'
    await rerender()

    expect(lines()).toContain(FAILED_READ)
    expect(lines()).not.toContain('Studio Mac')
  })

  it('looks nothing up and names no desktop when the route has no host id', async () => {
    storage.hostId = undefined
    await openAccounts()
    await connectedAt(1_000)

    expect(storage.hostListReads).toBe(0)
    expect(lines().some((text) => /Studio Mac|Laptop|Couldn't read/.test(text))).toBe(false)
  })
})
