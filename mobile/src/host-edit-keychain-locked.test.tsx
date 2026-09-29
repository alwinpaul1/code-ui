import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Edit host under a locked Keychain. loadHosts() drops a host whose credential read throws, so the
 * screen said "This host was removed from this phone." over a desktop the home screen still listed
 * (review, 2026-09-30). The real host store runs here; only AsyncStorage and the Keychain under it
 * are doubles, and the Keychain rejects the way a locked one does.
 */

const storage = vi.hoisted(() => ({
  hosts: null as string | null,
  hostsRead: null as Error | null,
  locked: new Set<string>(),
  tokens: new Map<string, string>()
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
  useLocalSearchParams: () => ({ hostId: 'host-1' }),
  useRouter: () => ({ back: vi.fn() })
}))
vi.mock('./transport/client-context', () => ({
  useForceReconnect: () => undefined,
  usePrimeHosts: () => () => undefined
}))

import EditHostScreen from '../app/h/[hostId]/edit'
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

async function openEdit(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <EditHostScreen />
      </ThemeProvider>
    )
  })
  if (renderer === null) {
    throw new Error('Edit host did not render')
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
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('Edit host when the desktop cannot be read', () => {
  it.each(['light', 'dark'] as const)(
    'does not call a Keychain-locked desktop removed, and says so in the %s danger colour',
    async (scheme) => {
      storage.locked.add('host-1')
      const tree = await openEdit(scheme)

      const lines = texts(tree)
      const line = lines.find(({ text }) => text.includes("can't be read right now"))
      expect(line?.text).toBe(
        "This paired desktop can't be read right now. Reopen this screen in a moment."
      )
      expect(line?.color).toBe(colorsForScheme(scheme).danger)
      expect(lines.some(({ text }) => /removed|not found/i.test(text))).toBe(false)
      expect(tree.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(0)
    }
  )

  it('says a desktop with no credential needs pairing again, not that it was removed', async () => {
    storage.tokens.delete('host-1')
    const tree = await openEdit()

    const lines = texts(tree).map(({ text }) => text)
    expect(lines).toContain(
      'This paired desktop needs to be paired again. Scan its code from the home screen.'
    )
    expect(lines.some((text) => /removed|can't be read/.test(text))).toBe(false)
  })

  it('says removed only when the host list no longer has the desktop', async () => {
    storage.hosts = JSON.stringify([stored('host-2', 'Laptop')])
    const tree = await openEdit()

    expect(texts(tree).map(({ text }) => text)).toContain(
      'This desktop was removed from this phone.'
    )
  })

  it('says removed over an empty host list', async () => {
    storage.hosts = JSON.stringify([])
    const tree = await openEdit()

    expect(texts(tree).map(({ text }) => text)).toContain(
      'This desktop was removed from this phone.'
    )
  })

  it('says the desktops could not be read when the host list read itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    storage.hostsRead = new Error('database disk image is malformed')
    const tree = await openEdit()

    const lines = texts(tree).map(({ text }) => text)
    expect(lines).toContain("Couldn't read your paired desktops. Reopen this screen in a moment.")
    expect(lines.some((text) => /removed|malformed/.test(text))).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('opens the form for the one readable desktop in a one-host list', async () => {
    storage.hosts = JSON.stringify([stored('host-1', 'Studio Mac')])
    const tree = await openEdit()

    const name = tree.root
      .findAll((node) => String(node.type) === 'TextInput')
      .find((node) => node.props.accessibilityLabel === 'Name')
    expect(name?.props.value).toBe('Studio Mac')
  })
})
