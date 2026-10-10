import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as HostReachability from './host-reachability'

/**
 * Troubleshooting under a locked Keychain. loadHosts() drops a host whose credential read throws,
 * so "Paired hosts" failed with "None — scan a QR to pair" on a phone whose only desktop was
 * paired, and the reachability rows skipped that desktop without a word (review, 2026-09-30). The
 * real host store runs; AsyncStorage and the Keychain under it are doubles.
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
vi.mock('../transport/host-credential-cleanup', () => ({
  cancelPendingHostCredentialCleanup: async () => undefined,
  recordHostCredentialCleanupIntent: async () => undefined,
  scheduleHostCredentialCleanup: async () => undefined,
  retryPendingHostCredentialCleanups: async () => undefined
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: {
    OS: 'android',
    Version: 35,
    select: (o: Record<string, unknown>) => o.android ?? o.default
  },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  AlertTriangle: 'AlertTriangle',
  CheckCircle2: 'CheckCircle2',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronUp: 'ChevronUp',
  Clock: 'Clock',
  Globe: 'Globe',
  LayoutTemplate: 'LayoutTemplate',
  Monitor: 'Monitor',
  Package: 'Package',
  ScrollText: 'ScrollText',
  Shield: 'Shield',
  WifiOff: 'WifiOff',
  XCircle: 'XCircle'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }))
vi.mock('../transport/mobile-network-type', () => ({
  readMobileLocalAddress: async () => '192.168.1.40',
  readMobileNetworkType: async () => 'WIFI'
}))
vi.mock('./host-reachability', async (importOriginal) => ({
  ...(await importOriginal<typeof HostReachability>()),
  testHostReachability: async () => true
}))
vi.mock('../transport/client-context', () => ({
  useRpcClientContext: () => ({
    getAllClients: () => [],
    getKnownState: () => null,
    getActivePath: () => 'lan'
  })
}))
vi.mock('../storage/preferences', () => ({
  mobileShellBuildKind: () => 'native'
}))
// Why: the bundle probe row mounts in every development build (the flag that used to gate it with
// the toggle is gone, Orca #26825) and reads the host list itself, which this file's failing-store
// cases would reject into an unhandled rejection. These tests are about the paired-hosts check.
vi.mock('./mobile-web-bundle-probe-row', () => ({ MobileWebBundleProbeRow: () => null }))
// Why: this pulls the shell's file-system store, which needs Expo's native runtime. The update
// failure row is not mounted in a native build.
vi.mock('../mobile-web-shell/process-generation-store', () => ({
  processGenerationStore: () => ({ readUpdateFailures: async () => [] })
}))
vi.mock('./use-mobile-web-bundle-probe', () => ({
  useMobileWebBundleProbe: () => ({ state: { status: 'idle' }, run: vi.fn(), awaitingHost: false })
}))

import TroubleshootScreen from '../../app/troubleshoot'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme, type ThemeScheme } from '../theme/tokens'
import { resetHostStoreForTests } from '../transport/host-store'
import { resetMobileRelayHostOverlayStoreForTests } from '../transport/mobile-relay-host-overlay-store'

const stored = (id: string, name: string) => ({
  id,
  name,
  endpoint: `ws://192.168.1.10:676${id.slice(-1)}`,
  publicKeyB64: `key-${id}`,
  lastConnected: 0
})

type Row = { icon: string; iconColor: unknown; label: string; detail: string }

let renderer: ReactTestRenderer | null = null

function textOf(node: ReactTestInstance): string {
  const children = node.props.children as unknown
  return Array.isArray(children) ? children.join('') : String(children)
}

/** Each check row as drawn: its status icon, label and detail. */
function rows(tree: ReactTestRenderer): Row[] {
  return tree.root
    .findAll((node) => String(node.type) === 'View')
    .filter((node) => {
      const kids = node.children.filter((kid): kid is ReactTestInstance => typeof kid !== 'string')
      return kids.length === 3 && kids.slice(1).every((kid) => String(kid.type) === 'Text')
    })
    .map((node) => {
      const [icon, label, detail] = node.children as ReactTestInstance[]
      const drawn = icon?.findAll((kid) => typeof kid.type === 'string')[0]
      return {
        icon: String(drawn?.type),
        iconColor: drawn?.props.color,
        label: textOf(label as ReactTestInstance),
        detail: textOf(detail as ReactTestInstance)
      }
    })
}

async function runDiagnostics(scheme: ThemeScheme = 'light'): Promise<Row[]> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>{createElement(TroubleshootScreen)}</ThemeProvider>
    )
  })
  const tree = renderer as ReactTestRenderer | null
  if (tree === null) {
    throw new Error('Troubleshoot did not render')
  }
  const button = tree.root.find(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.findAll((kid) => String(kid.type) === 'Text' && kid.props.children === 'Run diagnostics')
        .length > 0
  )
  await act(async () => {
    await button.props.onPress()
  })
  return rows(tree)
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
  vi.stubGlobal('fetch', async () => ({ ok: true }))
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Troubleshooting when a paired desktop cannot be read', () => {
  it.each(['light', 'dark'] as const)(
    'does not tell a phone whose only desktop is Keychain-locked to scan a QR to pair (%s)',
    async (scheme) => {
      storage.hosts = JSON.stringify([stored('host-1', 'Studio Mac')])
      storage.locked.add('host-1')
      const paired = (await runDiagnostics(scheme)).find((row) => row.label === 'Paired hosts')

      expect(paired).toEqual({
        icon: 'AlertTriangle',
        iconColor: colorsForScheme(scheme).warning,
        label: 'Paired hosts',
        detail: "1 paired, 1 can't be read right now"
      })
    }
  )

  it('counts a Keychain-locked desktop as paired and warns that it cannot be read', async () => {
    storage.locked.add('host-1')
    const paired = (await runDiagnostics()).find((row) => row.label === 'Paired hosts')

    expect(paired).toMatchObject({
      icon: 'AlertTriangle',
      detail: "2 paired, 1 can't be read right now"
    })
  })

  it('keeps a Keychain-locked desktop in the reachability rows instead of skipping it', async () => {
    storage.locked.add('host-1')
    const drawn = await runDiagnostics()

    expect(drawn.find((row) => row.label === 'Studio Mac')).toMatchObject({
      icon: 'AlertTriangle',
      detail: "Not tested: it can't be read right now. Run again in a moment."
    })
    expect(drawn.find((row) => row.label === 'Laptop')).toMatchObject({ icon: 'CheckCircle2' })
  })

  it('says a desktop with no credential needs pairing again, in the count and in its row', async () => {
    storage.tokens.delete('host-1')
    const drawn = await runDiagnostics()

    expect(drawn.find((row) => row.label === 'Paired hosts')).toMatchObject({
      icon: 'AlertTriangle',
      detail: '2 paired, 1 needs pairing again'
    })
    expect(drawn.find((row) => row.label === 'Studio Mac')).toMatchObject({
      icon: 'XCircle',
      detail: 'Not tested: it needs pairing again. Scan its code from the home screen.'
    })
  })

  it('fails with "None" only when nothing is paired', async () => {
    storage.hosts = JSON.stringify([])
    const drawn = await runDiagnostics()

    expect(drawn.find((row) => row.label === 'Paired hosts')).toMatchObject({
      icon: 'XCircle',
      detail: 'None — scan a QR to pair'
    })
  })

  it('passes a one-desktop phone whose desktop reads', async () => {
    storage.hosts = JSON.stringify([stored('host-2', 'Laptop')])
    const drawn = await runDiagnostics()

    expect(drawn.find((row) => row.label === 'Paired hosts')).toMatchObject({
      icon: 'CheckCircle2',
      detail: '1 paired'
    })
  })

  it('says the host data could not be read when the host list read itself fails', async () => {
    storage.hostsRead = new Error('database disk image is malformed')
    const drawn = await runDiagnostics()

    expect(drawn.find((row) => row.label === 'Paired hosts')).toMatchObject({
      icon: 'AlertTriangle',
      detail: 'Could not read host data'
    })
    expect(drawn.find((row) => row.label === 'Hosts')).toMatchObject({ detail: 'Could not test' })
  })
})
