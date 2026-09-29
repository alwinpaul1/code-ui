import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Accounts under a locked Keychain. loadHosts() drops a host whose credential read throws, so the
 * screen set "Host not found" in the danger colour over a desktop the home screen still listed,
 * and while it had no client it said "Connecting to host…" for a desktop it could not open
 * (review, 2026-09-30). The real host store runs; AsyncStorage and the Keychain are doubles.
 */

const storage = vi.hoisted(() => ({
  hosts: null as string | null,
  hostsRead: null as Error | null,
  locked: new Set<string>(),
  tokens: new Map<string, string>(),
  connection: { state: 'disconnected' as 'connected' | 'connecting' | 'disconnected' }
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (key === 'orca:hosts') {
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
vi.mock('./transport/host-credential-cleanup', () => ({
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
    useLocalSearchParams: () => ({ hostId: 'host-1' }),
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
vi.mock('./platform/haptics', () => ({ triggerSelection: () => {} }))
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  RefreshCw: 'RefreshCw',
  RotateCcw: 'RotateCcw',
  User: 'User'
}))
vi.mock('./components/AgentIcons', () => ({ ClaudeIcon: 'ClaudeIcon', OpenAIIcon: 'OpenAIIcon' }))
// 'disconnected' comes with no client: that is what a desktop whose credential cannot be read
// really gets, because the client opener cannot open it either. 'connected' with no snapshot yet
// is the only state in which the old screen drew its lookup error; 'connecting' is a client that
// the opener did open, reconnecting.
vi.mock('./transport/client-context', () => {
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

import AccountsScreen from '../app/h/[hostId]/accounts'
import { ThemeProvider } from './theme/theme-context'
import { colorsForScheme } from './theme/tokens'
import { resetHostStoreForTests } from './transport/host-store'
import { resetMobileRelayHostOverlayStoreForTests } from './transport/mobile-relay-host-overlay-store'

const stored = (id: string, name: string) => ({
  id,
  name,
  endpoint: `ws://192.168.1.10:676${id.slice(-1)}`,
  publicKeyB64: `key-${id}`,
  lastConnected: 0
})

function texts(tree: ReactTestRenderer): { text: string; color: unknown }[] {
  return tree.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => {
      const children = node.props.children as unknown
      const style = [node.props.style].flat(Infinity) as Record<string, unknown>[]
      return {
        text: Array.isArray(children) ? children.join('') : String(children),
        color: Object.assign({}, ...style.filter(Boolean)).color
      }
    })
}

let renderer: ReactTestRenderer | null = null

async function openAccounts(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <AccountsScreen />
      </ThemeProvider>
    )
  })
  if (renderer === null) {
    throw new Error('Accounts did not render')
  }
  return renderer
}

beforeEach(() => {
  resetHostStoreForTests()
  resetMobileRelayHostOverlayStoreForTests()
  storage.hosts = JSON.stringify([stored('host-1', 'Studio Mac'), stored('host-2', 'Laptop')])
  storage.hostsRead = null
  storage.locked = new Set()
  storage.tokens = new Map([
    ['host-1', 'token-1'],
    ['host-2', 'token-2']
  ])
  storage.connection.state = 'disconnected'
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('Accounts when the desktop cannot be read', () => {
  it.each(['light', 'dark'] as const)(
    'says a Keychain-locked desktop cannot be read instead of "Connecting…", in the %s danger colour',
    async (scheme) => {
      storage.locked.add('host-1')
      const tree = await openAccounts(scheme)

      const lines = texts(tree)
      const line = lines.find(({ text }) => text.includes("can't be read right now"))
      expect(line?.text).toBe(
        "This paired desktop can't be read right now. Reopen this screen in a moment."
      )
      expect(line?.color).toBe(colorsForScheme(scheme).danger)
      expect(lines.some(({ text }) => /not found|removed|^Connecting/i.test(text))).toBe(false)
      // The catalog still has its name, so the header can say which desktop this is.
      expect(lines.map(({ text }) => text)).toContain('Studio Mac')
    }
  )

  it('does not call a Keychain-locked desktop not found once a client for it is connected', async () => {
    storage.locked.add('host-1')
    storage.connection.state = 'connected'
    const tree = await openAccounts()

    const lines = texts(tree).map(({ text }) => text)
    // Connected means the opener has read the credential since; the snapshot is on its way.
    expect(lines).toContain('Loading accounts…')
    expect(lines.some((text) => /not found|removed|can't be read/i.test(text))).toBe(false)
  })

  it('says it is connecting, not that the desktop cannot be read, while its client reconnects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    storage.connection.state = 'connecting'
    const tree = await openAccounts()

    const lines = texts(tree).map(({ text }) => text)
    expect(lines).toContain('Connecting to host…')
    expect(lines.some((text) => /Couldn't read|can't be read/.test(text))).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('says a desktop with no credential needs pairing again', async () => {
    storage.tokens.delete('host-1')
    const tree = await openAccounts()

    expect(texts(tree).map(({ text }) => text)).toContain(
      'This paired desktop needs to be paired again. Scan its code from the home screen.'
    )
  })

  it('says removed only when the host list no longer has the desktop, one host or none', async () => {
    storage.hosts = JSON.stringify([stored('host-2', 'Laptop')])
    let tree = await openAccounts()
    expect(texts(tree).map(({ text }) => text)).toContain(
      'This desktop was removed from this phone.'
    )
    act(() => renderer?.unmount())

    storage.hosts = JSON.stringify([])
    tree = await openAccounts()
    expect(texts(tree).map(({ text }) => text)).toContain(
      'This desktop was removed from this phone.'
    )
  })

  it('says the desktops could not be read, and does not leave the read unhandled, when it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    const tree = await openAccounts()

    expect(texts(tree).map(({ text }) => text)).toContain(
      "Couldn't read your paired desktops. Reopen this screen in a moment."
    )
    expect(warn).toHaveBeenCalled()
  })

  it('still says it is connecting to a readable desktop that has no client yet', async () => {
    const tree = await openAccounts()

    const lines = texts(tree).map(({ text }) => text)
    expect(lines).toContain('Connecting to Studio Mac…')
    expect(lines.some((text) => /can't be read|removed|paired again/.test(text))).toBe(false)
  })
})
