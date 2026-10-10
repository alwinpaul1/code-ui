import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

// The 2026-10-10 redesign of the update card and its install flow ("not
// glass, premium and modern"), rendered in BOTH schemes: the version as the
// hero, the notes in sections with markers, the action bar pinned under the
// scroller, each install phase, and Home's download card. Every colour is
// asserted against the scheme's token, so a literal colour, which would pass
// in one scheme and be wrong in the other, fails here.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 0.5 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 })
}))
vi.mock('lucide-react-native', () => ({
  AlertTriangle: 'AlertTriangle',
  CheckCircle2: 'CheckCircle2',
  CloudOff: 'CloudOff',
  Download: 'Download',
  ShieldCheck: 'ShieldCheck',
  Sparkles: 'Sparkles',
  TrendingUp: 'TrendingUp'
}))
// The renderer has its own tests; here it is a host tag carrying what it was
// handed, so a test can see which words went into which group.
vi.mock('../components/MobileMarkdown', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileMarkdown: (props: { content: string; textScale?: number }) =>
      h('MobileMarkdown', { content: props.content, textScale: props.textScale })
  }
})
vi.mock('./installed-version', () => ({
  getInstalledVersion: () => '0.9.126',
  getInstalledBuildNumber: () => '126'
}))
vi.mock('@codeui/expo-apk-updater', () => ({
  isApkUpdaterAvailable: false,
  addApkUpdateProgressListener: vi.fn(),
  addApkUpdateStatusListener: vi.fn(),
  clearApkUpdateState: vi.fn(),
  getApkUpdateState: vi.fn(() => null),
  hasPendingInstallUserAction: vi.fn(() => false),
  installDownloadedApk: vi.fn(() => false),
  launchPendingInstallUserAction: vi.fn(),
  startApkUpdate: vi.fn()
}))
vi.mock('./android-apk-install', () => ({
  downloadApk: vi.fn(() => new Promise<string>(() => {})),
  openApkInstaller: vi.fn(() => Promise.resolve())
}))

import { AppUpdateDialogBody } from './AppUpdateDialogBody'
import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import type { DialogState } from './app-update-dialog-state'
import { HomeUpdateDownloadCard } from './HomeUpdateDownloadCard'
import { downloadProgressPercent } from './download-progress'
import { UPDATE_SCROLL_REGION_MAX_HEIGHT } from './update-card-parts'

/** The notes file format every release since 0.9.100 carries. */
const SECTIONED_NOTES = [
  '### Features',
  '- Charts draw inline in the chat',
  '- Video files play on the phone',
  '',
  '### Improvements',
  '- Big images send faster',
  '',
  '### Security & Bug Fixes',
  '- Sending the same words again goes through',
  '',
  '**Full Changelog**: https://github.com/alwinpaul1/code-ui/compare/mobile-android-v0.9.126...mobile-android-v0.9.127'
].join('\n')

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

let renderer: ReactTestRenderer | null = null

async function render(element: ReactNode, scheme: 'light' | 'dark') {
  await act(async () => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{element}</ThemeProvider>)
  })
  return renderer!.root
}

function renderBody(state: DialogState, scheme: 'light' | 'dark') {
  return render(createElement(AppUpdateDialogBody, { state, onDismiss: () => {} }), scheme)
}

/** A host tag's name: the react-native mock renders strings, which the
 *  renderer's types do not expect. */
function hostType(node: ReactTestInstance): unknown {
  return node.type
}

function flattenStyle(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...list.filter(Boolean))
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')
}

function button(root: ReactTestInstance, label: string): ReactTestInstance {
  const found = root.findAll(
    (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label
  )[0]
  if (!found) {
    throw new Error(`no button labelled ${label}`)
  }
  return found
}

function buttonLabels(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => hostType(node) === 'Pressable' && node.props.accessibilityRole === 'button')
    .map((node) => node.props.accessibilityLabel as string)
}

function byTestId(root: ReactTestInstance, id: string): ReactTestInstance {
  return root.find((node) => typeof node.type === 'string' && node.props.testID === id)
}

function showAvailable(releaseNotes: string | null = SECTIONED_NOTES) {
  useAppUpdateStore.setState({
    status: 'available',
    latestVersion: '0.9.127',
    latestBuildNumber: '127',
    releaseNotes,
    updateUrl: 'https://github.com/alwinpaul1/code-ui/releases/download/v0.9.127/code-ui.apk',
    releaseUrl: null,
    dismissedUpdateId: null,
    userInitiated: false
  })
}

beforeEach(() => {
  useAppUpdateStore.setState({
    status: 'idle',
    latestVersion: null,
    latestBuildNumber: null,
    releaseNotes: null,
    updateUrl: null,
    releaseUrl: null,
    dismissedUpdateId: null,
    userInitiated: false
  })
  useApkInstallStore.setState({ phase: 'idle', progress: 0, version: null, fileUri: null, error: null })
})

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
})

describe.each(SCHEMES)('the update card in %s', (scheme, colors: ThemeColors) => {
  it('leads with the new version, large, under a small accent eyebrow', async () => {
    showAvailable()
    const root = await renderBody({ kind: 'available' }, scheme)
    const hero = byTestId(root, 'update-hero-version')
    expect(textOf(hero)).toBe('0.9.127')
    const heroStyle = flattenStyle(hero.props.style)
    expect(heroStyle.fontSize).toBeGreaterThanOrEqual(36)
    expect(heroStyle.color).toBe(colors.text)
    const eyebrow = root.find(
      (node) => hostType(node) === 'Text' && textOf(node) === 'Update available'
    )
    expect(flattenStyle(eyebrow.props.style).color).toBe(colors.accentText)
    expect(flattenStyle(eyebrow.props.style).fontSize).toBeLessThan(heroStyle.fontSize as number)
    expect(textOf(root)).toContain('you have 0.9.126')
  })

  it('groups the notes under their sections, each with its own marker, in file order', async () => {
    showAvailable()
    const root = await renderBody({ kind: 'available' }, scheme)
    const headers = root
      .findAll((node) => hostType(node) === 'Text' && node.props.accessibilityRole === 'header')
      .map(textOf)
    expect(headers).toEqual(['Update available', 'Features', 'Improvements', 'Security & Bug Fixes'])
    const markers: [string, string, string][] = [
      ['Features', 'Sparkles', colors.accentText],
      ['Improvements', 'TrendingUp', colors.info],
      ['Security & Bug Fixes', 'ShieldCheck', colors.success]
    ]
    for (const [section, icon, ink] of markers) {
      const marker = byTestId(root, `release-notes-marker-${section}`)
      expect(marker.findByType(icon as never).props.color, section).toBe(ink)
    }
    const groups = root.findAllByType('MobileMarkdown' as never).map((node) => node.props.content as string)
    expect(groups[0]).toBe('- Charts draw inline in the chat\n- Video files play on the phone')
    expect(groups[1]).toBe('- Big images send faster')
    expect(groups[2]).toBe('- Sending the same words again goes through')
    // The changelog link is its own group at the end, not a change.
    expect(groups[3]).toMatch(/^\[Full changelog\]\(https:/)
    expect(groups).toHaveLength(4)
  })

  it('scrolls the notes and pins the action bar under them, outside the scroller', async () => {
    showAvailable()
    const root = await renderBody({ kind: 'available' }, scheme)
    const scroller = root.findByType('ScrollView' as never)
    expect(flattenStyle(scroller.props.style).maxHeight).toBe(UPDATE_SCROLL_REGION_MAX_HEIGHT)
    expect(flattenStyle(scroller.props.style).flexShrink).toBe(1)
    const update = button(root, 'Update now')
    expect(scroller.findAll((node) => node === update)).toHaveLength(0)
    const bar = update.parent!
    expect(flattenStyle(bar.props.style).flexShrink).toBe(0)
    expect(flattenStyle(bar.props.style).borderTopColor).toBe(colors.border)
    expect(flattenStyle(update.props.style({ pressed: false })).backgroundColor).toBe(colors.accentText)
    expect(flattenStyle(update.findByType('Text' as never).props.style).color).toBe(colors.onAccent)
    expect(buttonLabels(root)).toEqual(['Update now', 'Later'])
  })

  it('ready to install: the version, Install as the pill, Later quiet', async () => {
    showAvailable()
    useApkInstallStore.setState({ phase: 'ready', version: '0.9.127' })
    const root = await renderBody({ kind: 'ready' }, scheme)
    expect(textOf(byTestId(root, 'update-hero-version'))).toBe('0.9.127')
    expect(textOf(root)).toContain('Update downloaded')
    expect(buttonLabels(root)).toEqual(['Install', 'Later'])
    expect(flattenStyle(button(root, 'Install').props.style({ pressed: false })).backgroundColor).toBe(
      colors.accentText
    )
  })

  it("installing: says Android is installing, with a spinner and no buttons", async () => {
    useApkInstallStore.setState({ phase: 'installing', version: '0.9.127' })
    const root = await renderBody({ kind: 'installing' }, scheme)
    expect(textOf(root)).toContain('Installing')
    expect(textOf(root)).toContain('Android is installing Code UI 0.9.127')
    expect(root.findByType('ActivityIndicator' as never).props.color).toBe(colors.accentText)
    expect(buttonLabels(root)).toEqual([])
  })

  it('failed: the reason in an inset box, Try again as the pill, in danger tones', async () => {
    showAvailable()
    useApkInstallStore.setState({ phase: 'failed', version: '0.9.127', error: 'No space left on device' })
    const root = await renderBody({ kind: 'failed', error: 'No space left on device' }, scheme)
    const reason = byTestId(root, 'update-failure-reason')
    expect(textOf(reason)).toContain('No space left on device')
    expect(flattenStyle(reason.props.style).backgroundColor).toBe(colors.bgSunken)
    expect(flattenStyle(byTestId(root, 'update-status-well').props.style).backgroundColor).toBe(
      colors.dangerSoft
    )
    expect(root.findByType('AlertTriangle' as never).props.color).toBe(colors.danger)
    expect(textOf(root)).toContain('Code UI 0.9.127 did not install')
    expect(buttonLabels(root)).toEqual(['Try again', 'Not now'])
  })

  it('up to date: a success well, the shipped copy, and Done', async () => {
    useAppUpdateStore.setState({ status: 'up-to-date', userInitiated: true })
    const root = await renderBody({ kind: 'up-to-date' }, scheme)
    expect(flattenStyle(byTestId(root, 'update-status-well').props.style).backgroundColor).toBe(
      colors.successSoft
    )
    expect(textOf(root)).toContain('Code UI 0.9.126 is the latest version.')
    expect(buttonLabels(root)).toEqual(['Done'])
  })
})

describe('a downloaded update whose version nobody knows yet', () => {
  // A cold start can find a downloaded APK before any check has run, with no
  // version on the native state either (review, 2026-10-10).
  it('draws no hero rather than an empty line read out as "Version"', async () => {
    useApkInstallStore.setState({ phase: 'ready', version: null })
    const root = await renderBody({ kind: 'ready' }, 'light')
    expect(root.findAll((node) => node.props.testID === 'update-hero-version')).toHaveLength(0)
    expect(textOf(root)).toContain('Update downloaded')
    expect(buttonLabels(root)).toEqual(['Install', 'Later'])
  })
})

describe('notes that are not in the section format', () => {
  it('draw as one markdown column with no section markers, as before the redesign', async () => {
    showAvailable("## What's changed\n\n- One fix\n- Another fix")
    const root = await renderBody({ kind: 'available' }, 'light')
    const groups = root.findAllByType('MobileMarkdown' as never)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.props.content).toBe("**What's changed**\n\n- One fix\n- Another fix")
    expect(root.findAll((node) => String(node.props.testID ?? '').startsWith('release-notes-marker'))).toHaveLength(0)
  })

  it('with none at all: no scroller, no divider over the bar, one line of copy', async () => {
    showAvailable(null)
    const root = await renderBody({ kind: 'available' }, 'light')
    expect(root.findAllByType('ScrollView' as never)).toHaveLength(0)
    expect(textOf(root)).toContain('Fixes and improvements.')
    expect(flattenStyle(button(root, 'Update now').parent!.props.style).borderTopWidth).toBe(0)
  })
})

describe.each(SCHEMES)("Home's download card in %s", (scheme, colors: ThemeColors) => {
  it('shows the download as a determinate bar with its percent, for TalkBack too', async () => {
    useApkInstallStore.setState({ phase: 'downloading', version: '0.9.127', progress: 0.42 })
    const root = await render(createElement(HomeUpdateDownloadCard), scheme)
    const card = byTestId(root, 'home-update-download-card')
    expect(card.props.accessibilityRole).toBe('progressbar')
    expect(card.props.accessibilityLabel).toBe('Downloading Code UI 0.9.127')
    expect(card.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 42 })
    expect(textOf(byTestId(root, 'home-update-download-percent'))).toBe('42%')
    const fill = byTestId(root, 'home-update-download-fill')
    expect(flattenStyle(fill.props.style).width).toBe('42%')
    expect(flattenStyle(fill.props.style).backgroundColor).toBe(colors.accent)
    expect(flattenStyle(card.props.style).backgroundColor).toBe(colors.bgPanel)
    expect(flattenStyle(card.props.style).borderColor).toBe(colors.border)
  })

  it('takes no touches, so Home stays usable under it', async () => {
    useApkInstallStore.setState({ phase: 'downloading', version: '0.9.127', progress: 0.1 })
    const root = await render(createElement(HomeUpdateDownloadCard), scheme)
    expect(root.findAll((node) => node.props.pointerEvents === 'none').length).toBeGreaterThanOrEqual(1)
    expect(buttonLabels(root)).toEqual([])
  })
})

describe("Home's download card outside a download", () => {
  it.each(['idle', 'ready', 'installing', 'failed'] as const)('%s: draws nothing', async (phase) => {
    useApkInstallStore.setState({ phase, version: '0.9.127', progress: 1 })
    const root = await render(createElement(HomeUpdateDownloadCard), 'light')
    expect(root.findAll((node) => node.props.testID === 'home-update-download-card')).toHaveLength(0)
  })

  it('follows the store as the download moves', async () => {
    useApkInstallStore.setState({ phase: 'downloading', version: '0.9.127', progress: 0 })
    const root = await render(createElement(HomeUpdateDownloadCard), 'light')
    expect(textOf(byTestId(root, 'home-update-download-percent'))).toBe('0%')
    await act(async () => useApkInstallStore.setState({ progress: 0.995 }))
    expect(textOf(byTestId(root, 'home-update-download-percent'))).toBe('100%')
    await act(async () => useApkInstallStore.setState({ phase: 'ready' }))
    expect(root.findAll((node) => node.props.testID === 'home-update-download-card')).toHaveLength(0)
  })
})

describe('the download percent', () => {
  it('rounds, and clamps a fraction outside 0..1 or one that is not a number', () => {
    expect(downloadProgressPercent(0)).toBe(0)
    expect(downloadProgressPercent(0.426)).toBe(43)
    expect(downloadProgressPercent(1)).toBe(100)
    expect(downloadProgressPercent(1.02)).toBe(100)
    expect(downloadProgressPercent(-0.1)).toBe(0)
    expect(downloadProgressPercent(Number.NaN)).toBe(0)
  })
})
