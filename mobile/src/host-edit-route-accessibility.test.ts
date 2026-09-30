import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditHostScreen from '../app/h/[hostId]/edit'

const dependencies = vi.hoisted(() => ({
  back: vi.fn(),
  forceReconnectHost: vi.fn(),
  loadHosts: vi.fn(),
  primeHosts: vi.fn(),
  updateHostNameAndEndpoint: vi.fn()
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: 'host-1' }),
  useRouter: () => ({ back: dependencies.back })
}))

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft'
}))

// The screen looks its host up in the catalog (host-lookup.ts); every fixture here is a readable
// desktop, so the catalog is the same list with each entry ready.
vi.mock('./transport/host-store', () => ({
  loadHosts: dependencies.loadHosts,
  loadHostCatalog: async () =>
    ((await dependencies.loadHosts()) as { id: string }[]).map((profile) => ({
      ...profile,
      credentialStatus: 'ready',
      profile
    })),
  updateHostNameAndEndpoint: dependencies.updateHostNameAndEndpoint
}))

// The connection counter the screen re-reads a failed host lookup on; it never moves here.
vi.mock('./transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
vi.mock('./transport/client-context', () => ({
  useForceReconnect: () => dependencies.forceReconnectHost,
  usePrimeHosts: () => dependencies.primeHosts
}))

async function renderEditHostRoute(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(EditHostScreen))
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('Edit host route did not render')
  }
  return renderer
}

describe('edit host route accessibility', () => {
  beforeEach(() => {
    dependencies.loadHosts.mockReset().mockResolvedValue([
      {
        id: 'host-1',
        name: 'Desk',
        endpoint: 'ws://192.168.1.10:6768',
        deviceToken: 'token',
        publicKeyB64: 'public-key',
        lastConnected: 1
      }
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes stable accessible names for both editable fields', async () => {
    const renderer = await renderEditHostRoute()

    const inputs = renderer.root.findAllByType('TextInput')
    expect(inputs).toHaveLength(2)
    expect(inputs.map((input) => input.props.accessibilityLabel)).toEqual(['Name', 'Address'])

    act(() => renderer.unmount())
  })
})
