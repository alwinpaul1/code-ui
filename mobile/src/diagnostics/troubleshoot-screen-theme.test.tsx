import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebShellUpdateFailure } from '../mobile-web-shell/mobile-web-shell-update-failure'
import type { MobileWebBundleProbeState } from './use-mobile-web-bundle-probe'

/**
 * The Troubleshoot screen in both themes. It painted from the static dark palette, so in light
 * mode it stayed dark, and the workspace-updates row v1.4.211 added there (#22321) was dark with
 * it. Theming the row alone would have put dark text on the screen's dark panel, so the whole
 * screen reads the live theme (2026-09-25 port review).
 */
const doubles = vi.hoisted(() => ({
  failures: [] as MobileWebShellUpdateFailure[],
  probe: { status: 'idle' } as MobileWebBundleProbeState
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', Version: 35, select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
// Why: lucide's entry pulls React Native internals that the host-tag mock above removed.
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
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined }
}))
vi.mock('../transport/host-store', () => ({
  loadHosts: async () => [
    { id: 'host-1', name: 'Studio Mac', endpoint: 'ws://192.168.1.20:6768' }
  ]
}))
vi.mock('../transport/mobile-network-type', () => ({
  readMobileLocalAddress: async () => '192.168.1.40'
}))
vi.mock('./host-reachability', () => ({
  formatEndpoint: (endpoint: string) => endpoint,
  testHostReachability: async () => false,
  unreachableHostDetail: () => 'Not answering'
}))
vi.mock('../storage/preferences', () => ({
  mobileWebShellFlagCanBeOn: () => true,
  loadMobileWebShellEnabled: async () => true,
  mobileShellBuildKind: () => 'ota',
  saveMobileWebShellEnabled: async () => undefined
}))
vi.mock('../mobile-web-shell/process-generation-store', () => ({
  processGenerationStore: () => ({ readUpdateFailures: async () => doubles.failures })
}))
// Why: the probe dials the host through the whole transport stack, which pulls native modules. Its
// row is mounted only in a development build, so it is rendered on its own below.
vi.mock('./use-mobile-web-bundle-probe', () => ({
  useMobileWebBundleProbe: () => ({ state: doubles.probe, run: vi.fn(), awaitingHost: false })
}))

import TroubleshootScreen from '../../app/troubleshoot'
import { MobileWebBundleProbeRow } from './mobile-web-bundle-probe-row'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme, type ThemeScheme } from '../theme/tokens'

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0)

function recordedFailure(): MobileWebShellUpdateFailure {
  return {
    hostId: 'host-1',
    at: NOW - 5 * 60_000,
    reason: 'asset-checksum-mismatch',
    hostCode: null,
    offeredBuildId: `3f2a${'0'.repeat(60)}`,
    cachedBuildId: `9e8d${'1'.repeat(60)}`,
    outcome: 'opened-cached',
    wall: null
  }
}

async function renderScreen(
  scheme: ThemeScheme,
  screen: () => ReturnType<typeof createElement> = () => createElement(TroubleshootScreen)
): Promise<ReactTestRenderer> {
  const rendered: { tree: ReactTestRenderer | null } = { tree: null }
  await act(async () => {
    rendered.tree = create(createElement(ThemeProvider, { initialPreference: scheme }, screen()))
  })
  if (rendered.tree === null) {
    throw new Error('the screen did not mount')
  }
  return rendered.tree
}

function pressableLabelled(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAll(
    (node) =>
      node.type === 'Pressable' &&
      node.findAll((child) => child.type === 'Text' && child.props.children === label).length > 0
  )
  const node = found[0]
  if (node === undefined) {
    throw new Error(`no pressable labelled ${label}`)
  }
  return node
}

/** Run the checks and open one accordion, so the pass and fail icons, the failed detail, the
 *  separators and the step text are all on screen with the rows. */
async function everythingOnScreen(scheme: ThemeScheme): Promise<ReactTestRenderer> {
  const tree = await renderScreen(scheme)
  await act(async () => {
    await pressableLabelled(tree, 'Run diagnostics').props.onPress()
  })
  await act(async () => {
    pressableLabelled(tree, 'Different WiFi Networks').props.onPress()
  })
  return tree
}

type Paint = { readonly where: string; readonly colour: string }

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
function paints(tree: ReactTestRenderer): Paint[] {
  return tree.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => {
      const where = String(node.type)
      const fromStyles = stylesOf(node.props.style).flatMap((style) =>
        (['color', 'backgroundColor', 'borderColor'] as const).flatMap((key) =>
          typeof style[key] === 'string' ? [{ where: `${where}.${key}`, colour: style[key] as string }] : []
        )
      )
      const fromProp =
        typeof node.props.color === 'string' ? [{ where: `${where} icon`, colour: node.props.color as string }] : []
      return [...fromStyles, ...fromProp]
    })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  doubles.failures = [recordedFailure()]
  doubles.probe = { status: 'idle' }
  vi.stubGlobal('fetch', async () => ({ ok: true }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the Troubleshoot screen in both themes', () => {
  it.each(['light', 'dark'] as const)(
    'paints every colour from the %s palette, the page and its rows alike',
    async (scheme) => {
      const palette = new Set(Object.values(colorsForScheme(scheme)))
      const tree = await everythingOnScreen(scheme)

      const painted = paints(tree)
      expect(painted.length).toBeGreaterThan(20)
      expect(painted.filter((paint) => !palette.has(paint.colour))).toEqual([])
    }
  )

  it.each(['light', 'dark'] as const)(
    "draws the workspace-updates line in the %s theme's muted text on its panel",
    async (scheme) => {
      const palette = colorsForScheme(scheme)
      const tree = await renderScreen(scheme)

      const block = tree.root.find((node) => node.props.testID === 'mobile-web-shell-update-failures')
      const line = block.find(
        (node) => node.type === 'Text' && node.props.testID === 'mobile-web-shell-update-failure'
      )
      const panels = block
        .findAll((node) => node.type === 'View')
        .flatMap((node) => stylesOf(node.props.style))
        .map((style) => style.backgroundColor)
        .filter((colour) => colour !== undefined)
      expect(stylesOf(line.props.style).map((style) => style.color)).toContain(palette.textMuted)
      expect(panels).toEqual([palette.bgPanel])
    }
  )

  it.each(['light', 'dark'] as const)('puts the %s page behind it all', async (scheme) => {
    const tree = await renderScreen(scheme)
    const page = tree.root.findAll((node) => node.type === 'View')[0]

    expect(stylesOf(page?.props.style).map((style) => style.backgroundColor)).toContain(
      colorsForScheme(scheme).bg
    )
  })

  it.each(['light', 'dark'] as const)(
    'paints the development bundle probe from the %s palette, a failed fetch and a finished one',
    async (scheme) => {
      const palette = new Set(Object.values(colorsForScheme(scheme)))
      const probeRow = () => createElement(MobileWebBundleProbeRow)
      doubles.probe = { status: 'failed', detail: 'unsupported-protocol' }
      const failed = paints(await renderScreen(scheme, probeRow))
      doubles.probe = { status: 'done', buildId: 'b'.repeat(64), assetCount: 3, totalBytes: 9, elapsedMs: 5 }
      const done = paints(await renderScreen(scheme, probeRow))

      expect(failed.map((paint) => paint.colour)).toContain(colorsForScheme(scheme).danger)
      expect([...failed, ...done].filter((paint) => !palette.has(paint.colour))).toEqual([])
    }
  )
})
