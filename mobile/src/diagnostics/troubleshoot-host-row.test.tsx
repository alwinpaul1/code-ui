import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as HostReachability from './host-reachability'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionState } from '../transport/types'

/**
 * The Troubleshooting host row against the live connection, in both themes. Reported
 * 2026-09-27 from a friend's Pixel: Home said "Host 1 · Connected · Orca Relay" while this
 * row drew a red X over the same host ("Cannot reach 192.168.137.1:6768 — … the desktop is
 * dropping LAN traffic"), because it judged a fresh LAN probe alone. The phone also showed a
 * VPN key in its status bar, which the row could not see.
 */
const doubles = vi.hoisted(() => ({
  live: null as { state: ConnectionState; path: MobileConnectionPath } | null,
  native: null as null | { phoneVpnStatus: (host: string | null) => Promise<unknown> }
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
    Version: 37,
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
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
// The real phone-VPN reader runs; only the native module under it is a double.
vi.mock('expo', () => ({ requireOptionalNativeModule: () => doubles.native }))
vi.mock('../transport/host-store', () => ({
  loadHosts: async () => [{ id: 'host-1', name: 'Host 1', endpoint: 'ws://192.168.137.1:6768' }]
}))
vi.mock('../transport/mobile-network-type', () => ({
  readMobileLocalAddress: async () => '192.168.137.23',
  // expo-network calls a VPN over Wi-Fi plain WIFI, as it did on the reporter's phone.
  readMobileNetworkType: async () => 'WIFI'
}))
vi.mock('../transport/client-context', () => ({
  useRpcClientContext: () => ({
    getAllClients: () => [],
    getKnownState: () => doubles.live?.state ?? null,
    getActivePath: () => doubles.live?.path ?? 'lan'
  })
}))
vi.mock('./host-reachability', async (importOriginal) => ({
  ...(await importOriginal<typeof HostReachability>()),
  // The LAN probe fails, as it did on the reporter's phone.
  testHostReachability: async () => false
}))
vi.mock('../storage/preferences', () => ({
  mobileWebShellFlagCanBeOn: () => false,
  loadMobileWebShellEnabled: async () => false,
  mobileShellBuildKind: () => 'ota',
  saveMobileWebShellEnabled: async () => undefined
}))
// Why: the shell rows are imported statically even with the flag off; their stores reach native
// modules at import.
vi.mock('../mobile-web-shell/process-generation-store', () => ({
  processGenerationStore: () => ({ readUpdateFailures: async () => [] })
}))
vi.mock('./use-mobile-web-bundle-probe', () => ({
  useMobileWebBundleProbe: () => ({ state: { status: 'idle' }, run: vi.fn(), awaitingHost: false })
}))

import TroubleshootScreen from '../../app/troubleshoot'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme, type ThemeScheme } from '../theme/tokens'

async function runChecks(scheme: ThemeScheme): Promise<ReactTestRenderer> {
  const rendered: { tree: ReactTestRenderer | null } = { tree: null }
  await act(async () => {
    rendered.tree = create(
      <ThemeProvider initialPreference={scheme}>{createElement(TroubleshootScreen)}</ThemeProvider>
    )
  })
  const tree = rendered.tree
  if (tree === null) {
    throw new Error('the screen did not mount')
  }
  const run = tree.root.find(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.findAll(
        (child) => String(child.type) === 'Text' && child.props.children === 'Run diagnostics'
      ).length > 0
  )
  await act(async () => {
    await run.props.onPress()
  })
  return tree
}

function hostRow(tree: ReactTestRenderer): { icon: ReactTestInstance; detail: ReactTestInstance } {
  const label = tree.root.find(
    (node) => String(node.type) === 'Text' && node.props.children === 'Host 1'
  )
  const row = label.parent
  if (row === null) {
    throw new Error('the host label has no row')
  }
  const icon = row.find((node) =>
    ['AlertTriangle', 'XCircle', 'CheckCircle2'].includes(String(node.type))
  )
  const texts = row.findAll((node) => String(node.type) === 'Text')
  const detail = texts[texts.length - 1]
  if (detail === undefined) {
    throw new Error('the host row has no detail')
  }
  return { icon, detail }
}

function colours(style: unknown): unknown[] {
  if (Array.isArray(style)) {
    return style.flatMap(colours)
  }
  return typeof style === 'object' && style !== null ? [(style as { color?: unknown }).color] : []
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () => ({ ok: true }))
  doubles.native = {
    phoneVpnStatus: async () => ({ active: true, carriesAppTraffic: true, routesEndpoint: true })
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  doubles.live = null
})

describe('the Troubleshooting host row against the live connection', () => {
  it.each(['light', 'dark'] as const)(
    'warns in %s amber when the relay is live and only the Wi-Fi path is down',
    async (scheme) => {
      const palette = colorsForScheme(scheme)
      doubles.live = { state: 'connected', path: 'relay' }

      const { icon, detail } = hostRow(await runChecks(scheme))

      expect(String(icon.type)).toBe('AlertTriangle')
      expect(icon.props.color).toBe(palette.warning)
      expect(detail.props.children).toBe(
        "Connected via Orca Relay · direct Wi-Fi path unavailable (a VPN on this phone is routing local traffic away from your desktop; allow LAN access in the VPN app or pause it). 192.168.137.x is Windows' Mobile Hotspot network, where Windows Firewall often treats the adapter as Public and blocks port 6768"
      )
      expect(colours(detail.props.style)).not.toContain(palette.danger)
    }
  )

  it.each(['light', 'dark'] as const)(
    'fails in %s red, naming the phone VPN, when there is no live connection at all',
    async (scheme) => {
      const palette = colorsForScheme(scheme)
      doubles.live = null

      const { icon, detail } = hostRow(await runChecks(scheme))

      expect(String(icon.type)).toBe('XCircle')
      expect(icon.props.color).toBe(palette.danger)
      expect(detail.props.children).toMatch(
        /^Cannot reach 192\.168\.137\.1:6768 — a VPN on this phone is routing local traffic away from your desktop/
      )
      expect(detail.props.children).not.toContain('the desktop is dropping LAN traffic')
      expect(colours(detail.props.style)).toContain(palette.danger)
    }
  )

  it.each(['light', 'dark'] as const)(
    'falls back to the old copy in %s when the native VPN check throws',
    async (scheme) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      doubles.native = {
        phoneVpnStatus: async () => {
          throw new Error('SecurityException')
        }
      }

      const { icon, detail } = hostRow(await runChecks(scheme))

      expect(String(icon.type)).toBe('XCircle')
      expect(detail.props.children).toMatch(
        /^Cannot reach 192\.168\.137\.1:6768 — the phone is on that network, so the desktop is dropping LAN traffic/
      )
    }
  )
})
