import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { ConnectionLogEntry, ConnectionState } from '../transport/types'
import {
  localTime,
  REPORTED_LAST_CONNECTED_AT,
  reportedLogTail
} from './connection-diagnostics-timeline.test-fixture'

/**
 * The Network diagnostics screen as the 2026-09-27 report saw it: header "connected", "What this
 * suggests: Connection is healthy via Relay", and under it a timeline whose whole visible tail was
 * LAN failures. It also painted from the static dark palette, so light mode stayed dark.
 */
const doubles = vi.hoisted(() => ({
  entries: [] as ConnectionLogEntry[],
  state: 'connected' as ConnectionState,
  activePath: 'relay' as MobileConnectionPath,
  lastConnectedAt: null as number | null,
  clipboard: [] as string[]
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
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
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy'
}))
vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  useLocalSearchParams: () => ({})
}))
vi.mock('expo-clipboard', () => ({
  setStringAsync: async (text: string) => {
    doubles.clipboard.push(text)
  }
}))
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.9.54' } } }))
vi.mock('expo', () => ({
  requireOptionalNativeModule: () => ({
    phoneVpnStatus: async () => ({ active: true, carriesAppTraffic: true, routesEndpoint: true })
  })
}))
vi.mock('../transport/host-store', () => ({
  loadHostCatalog: async () => {
    const profile = { id: 'host-1', name: 'Host 1', endpoint: 'ws://192.168.137.1:6768' }
    return [{ ...profile, credentialStatus: 'ready', profile }]
  }
}))
vi.mock('../transport/persisted-connection-log-store', () => ({
  connectionLogStore: {
    subscribe: () => () => undefined,
    get: () => doubles.entries,
    hydrate: async () => undefined
  }
}))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: null, state: doubles.state }),
  useRpcClientContext: () => ({
    getState: () => doubles.state,
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => doubles.lastConnectedAt,
    getActivePath: () => doubles.activePath,
    getPendingPath: () => null
  })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useReconnectAttempt: () => 0,
  useLastConnectedAt: () => doubles.lastConnectedAt,
  useConnectionPathStatus: () => ({ activePath: doubles.activePath, pendingPath: null })
}))
vi.mock('../background/background-link', () => ({
  isBackgroundDeliveryAvailable: () => true,
  backgroundDeliveryState: () => ({ serviceRunning: true, unrestricted: true })
}))
vi.mock('../transport/host-status-gates', () => ({
  useHostStatusGates: () => ({ desktopAppVersion: '1.4.215' })
}))
vi.mock('../transport/host-app-version-store', () => ({ loadHostAppVersion: async () => null }))

import ConnectionLogScreen from '../../app/connection-log'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme, type ThemeScheme } from '../theme/tokens'

async function renderScreen(scheme: ThemeScheme): Promise<ReactTestRenderer> {
  const rendered: { tree: ReactTestRenderer | null } = { tree: null }
  await act(async () => {
    rendered.tree = create(
      <ThemeProvider initialPreference={scheme}>{createElement(ConnectionLogScreen)}</ThemeProvider>
    )
  })
  if (rendered.tree === null) {
    throw new Error('the screen did not mount')
  }
  return rendered.tree
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')
}

/** Every Text on screen, in render order. */
function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAll((node) => String(node.type) === 'Text').map(textOf)
}

function pressableWithText(tree: ReactTestRenderer, text: string): ReactTestInstance {
  const found = tree.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.findAll((child) => String(child.type) === 'Text' && textOf(child) === text).length > 0
  )
  const node = found[0]
  if (node === undefined) {
    throw new Error(`no pressable reading ${text}`)
  }
  return node
}

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  if (typeof style === 'function') {
    return [...stylesOf(style({ pressed: false })), ...stylesOf(style({ pressed: true }))]
  }
  return typeof style === 'object' && style !== null ? [style as Record<string, unknown>] : []
}

/** Every colour the screen paints: a style's text, fill and border, and an icon's `color`. */
function paints(tree: ReactTestRenderer): { where: string; colour: string }[] {
  return tree.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => {
      const where = String(node.type)
      const fromStyles = stylesOf(node.props.style).flatMap((style) =>
        (['color', 'backgroundColor', 'borderColor'] as const).flatMap((key) =>
          typeof style[key] === 'string'
            ? [{ where: `${where}.${key}`, colour: style[key] as string }]
            : []
        )
      )
      const fromProp =
        typeof node.props.color === 'string'
          ? [{ where: `${where} icon`, colour: node.props.color as string }]
          : []
      return [...fromStyles, ...fromProp]
    })
}

const FOLDED = 'Direct Wi-Fi path: 7 failed attempts, 14:20:16–14:21:47, next retry in 30 s'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(localTime(14, 21, 1))
  doubles.entries = reportedLogTail()
  doubles.state = 'connected'
  doubles.activePath = 'relay'
  doubles.lastConnectedAt = REPORTED_LAST_CONNECTED_AT
  doubles.clipboard = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the Network diagnostics screen, as reported', () => {
  it.each(['light', 'dark'] as const)(
    'pins the live relay connection above a timeline that folds the LAN retry loop (%s)',
    async (scheme) => {
      const tree = await renderScreen(scheme)
      const shown = texts(tree)

      const live = shown.indexOf('Connected via Relay since 14:20:09')
      const firstEntry = shown.indexOf('Android paused the app')
      expect(live).toBeGreaterThanOrEqual(0)
      expect(live).toBeLessThan(firstEntry)
      expect(shown).toContain(FOLDED)
      // The seven closes are folded, not listed.
      expect(shown.filter((text) => text === 'WebSocket closed')).toEqual([])
    }
  )

  it.each(['light', 'dark'] as const)(
    'opens the folded row to show its lines (%s)',
    async (scheme) => {
      const tree = await renderScreen(scheme)

      await act(async () => {
        pressableWithText(tree, FOLDED).props.onPress()
      })

      expect(texts(tree).filter((text) => text === 'WebSocket closed')).toHaveLength(7)
    }
  )

  it.each(['light', 'dark'] as const)(
    'says in "What this suggests" that Android paused the phone, while connected (%s)',
    async (scheme) => {
      const shown = texts(await renderScreen(scheme))

      expect(shown).toContain('Connection is healthy via Relay.')
      expect(shown).toContain('Phone was paused by Android for 27m of the last hour (1 pause)')
    }
  )

  it.each(['light', 'dark'] as const)('paints every colour from the %s palette', async (scheme) => {
    const palette = new Set(Object.values(colorsForScheme(scheme)))
    const tree = await renderScreen(scheme)
    await act(async () => {
      pressableWithText(tree, FOLDED).props.onPress()
    })

    const painted = paints(tree)
    expect(painted.length).toBeGreaterThan(20)
    expect(painted.filter((paint) => !palette.has(paint.colour))).toEqual([])
  })

  it.each(['light', 'dark'] as const)('puts the %s page behind it all', async (scheme) => {
    const tree = await renderScreen(scheme)
    const page = tree.root.findAll((node) => String(node.type) === 'View')[0]

    expect(stylesOf(page?.props.style).map((style) => style.backgroundColor)).toContain(
      colorsForScheme(scheme).bg
    )
  })

  it('copies a report that names the phone VPN and the pauses', async () => {
    const tree = await renderScreen('dark')

    await act(async () => {
      await pressableWithText(tree, 'Copy report').props.onPress()
    })

    expect(doubles.clipboard).toHaveLength(1)
    expect(doubles.clipboard[0]).toContain(
      'Phone VPN: active · carries this app · routes 192.168.137.1'
    )
    expect(doubles.clipboard[0]).toContain(
      'Phone was paused by Android for 27m of the last hour (1 pause)'
    )
  })
})

describe('the Network diagnostics screen with an empty log', () => {
  it.each(['light', 'dark'] as const)(
    'still pins the live state, over an empty-log line (%s)',
    async (scheme) => {
      doubles.entries = []
      doubles.state = 'disconnected'
      doubles.lastConnectedAt = null

      const shown = texts(await renderScreen(scheme))

      expect(shown).toContain('Not connected')
      expect(shown).toContain('No connection events yet. Events appear as the app dials this host.')
      expect(shown.some((text) => text.startsWith('Phone was paused'))).toBe(false)
    }
  )
})
