import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemePreference } from '../theme/tokens'
import type { BlockedVerdict } from './ProtocolBlockScreen'
import { ProtocolBlockScreen } from './ProtocolBlockScreen'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LAST_AVAILABLE_KEY, useAppUpdateStore } from '../app-update/app-update-store'

const nativeTestState = vi.hoisted(() => {
  // Declared wide so a test can switch stores; an assertion here would only widen the same literal.
  const platform: { OS: 'ios' | 'android' } = { OS: 'ios' }
  return { openUrl: vi.fn(), platform }
})

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(() => Promise.resolve(null)),
    setItem: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve())
  }
}))

vi.mock('../app-update/installed-version', () => ({
  getInstalledVersion: vi.fn(() => '0.9.100'),
  getInstalledBuildNumber: vi.fn(() => '100')
}))

vi.mock('react-native', () => ({
  Linking: { openURL: nativeTestState.openUrl },
  Platform: nativeTestState.platform,
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))

vi.mock('expo-router', () => ({
  router: { replace: vi.fn() },
  // `ProtocolBlockScreen` reaches the router through the navigation handoff now, and the handoff's
  // native form is this hook. Its web form is what posts the target to the shell.
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), dismissTo: vi.fn() })
}))

// The desktop is stock Orca, so the desktop remedy still points at Orca's own releases.
const ORCA_DESKTOP_RELEASES_URL = 'https://github.com/stablyai/orca/releases'
// This app ships as an APK on its own repo; Orca's mobile releases and App Store listing are not it.
const CODE_UI_RELEASES_URL = 'https://github.com/alwinpaul1/code-ui/releases'
const KNOWN_RELEASE_URL =
  'https://github.com/alwinpaul1/code-ui/releases/tag/mobile-android-v0.9.200'

let renderer: ReactTestRenderer | null = null

function render(verdict: BlockedVerdict): string {
  act(() => {
    renderer = create(createElement(ProtocolBlockScreen, { verdict }))
  })
  return JSON.stringify(renderer?.toJSON())
}

/** Code UI: the wall under one appearance setting, so both can be pinned. */
function renderThemed(preference: ThemePreference, verdict: BlockedVerdict): string {
  act(() => {
    renderer = create(
      createElement(ThemeProvider, {
        initialPreference: preference,
        // oxlint-disable-next-line react/no-children-prop -- a .ts file has no JSX, and ThemeProvider types children as required, so createElement only type-checks with them in props.
        children: createElement(ProtocolBlockScreen, { verdict })
      })
    )
  })
  return JSON.stringify(renderer?.toJSON())
}

/** The mocked host components are plain strings, which `ElementType` does not admit. */
function isMockedHostElement(type: unknown, name: string): boolean {
  return type === name
}

function pressableCount(): number {
  return renderer?.root.findAll((node) => isMockedHostElement(node.type, 'Pressable')).length ?? 0
}

function primaryActionUrl(): unknown {
  const pressable = renderer?.root.findAll((node) => isMockedHostElement(node.type, 'Pressable'))[0]
  act(() => pressable?.props.onPress())
  return nativeTestState.openUrl.mock.calls[0]?.[0]
}

describe('ProtocolBlockScreen', () => {
  beforeEach(() => {
    nativeTestState.openUrl.mockClear()
    nativeTestState.platform.OS = 'android'
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null)
    useAppUpdateStore.setState({
      status: 'idle',
      latestVersion: null,
      latestBuildNumber: null,
      releaseNotes: null,
      updateUrl: null,
      releaseUrl: null
    })
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  // Why: the protocol wall shipped before the bundle one; its copy is what users already see.
  it('keeps the existing protocol wall rendering unchanged', () => {
    const mobile = render({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    })
    expect(mobile).toContain('Update Code UI')
    expect(mobile).toContain(
      'This desktop needs a newer Code UI app. Update Code UI from GitHub Releases, then try this host again.'
    )
    expect(mobile).toContain('Open GitHub Releases')
    expect(mobile).not.toContain('App Store')
    act(() => renderer?.unmount())

    const desktop = render({
      kind: 'blocked',
      reason: 'desktop-too-old',
      desktopVersion: 0,
      requiredDesktopVersion: 2
    })
    expect(desktop).toContain('Update Orca on your computer')
    expect(desktop).toContain(
      'This paired desktop app is too old for your current Code UI app. Update Orca on your computer, then try this host again.'
    )
    expect(desktop).toContain('Open GitHub Releases')
  })

  it("sends a too-old phone to this app's releases, never to Orca's releases or Orca's App Store listing", () => {
    for (const os of ['android', 'ios'] as const) {
      nativeTestState.platform.OS = os
      nativeTestState.openUrl.mockClear()
      const output = render({
        kind: 'blocked',
        reason: 'mobile-too-old',
        desktopVersion: 5,
        requiredMobileVersion: 99
      })
      expect(output).not.toContain('App Store')
      expect(primaryActionUrl()).toBe(CODE_UI_RELEASES_URL)
      act(() => renderer?.unmount())
    }
  })

  it('names the exact release and opens its page when the update check already found one', () => {
    useAppUpdateStore.setState({
      status: 'available',
      latestVersion: '0.9.200',
      releaseUrl: KNOWN_RELEASE_URL
    })
    const output = render({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    })
    expect(output).toContain('Get Code UI 0.9.200')
    expect(primaryActionUrl()).toBe(KNOWN_RELEASE_URL)
  })

  it('still opens the exact release after the user chose Later on the home card', async () => {
    // "Later" clears the store's copy of the release; the way past a wall is not a nudge to decline.
    const found = {
      status: 'available',
      latestVersion: '0.9.200',
      updateUrl: 'https://github.com/alwinpaul1/code-ui/releases/download/x/code-ui.apk',
      releaseUrl: KNOWN_RELEASE_URL
    }
    vi.mocked(AsyncStorage.getItem).mockImplementation((key) =>
      Promise.resolve(key === LAST_AVAILABLE_KEY ? JSON.stringify(found) : null)
    )
    await act(async () => {
      renderer = create(
        createElement(ProtocolBlockScreen, {
          verdict: {
            kind: 'blocked',
            reason: 'mobile-too-old',
            desktopVersion: 5,
            requiredMobileVersion: 99
          }
        })
      )
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('Get Code UI 0.9.200')
    expect(primaryActionUrl()).toBe(KNOWN_RELEASE_URL)
  })

  it('ignores a remembered release the installed build has already caught up with', async () => {
    const stale = { status: 'available', latestVersion: '0.9.100', releaseUrl: KNOWN_RELEASE_URL }
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stale))
    await act(async () => {
      renderer = create(
        createElement(ProtocolBlockScreen, {
          verdict: {
            kind: 'blocked',
            reason: 'mobile-too-old',
            desktopVersion: 5,
            requiredMobileVersion: 99
          }
        })
      )
    })
    expect(primaryActionUrl()).toBe(CODE_UI_RELEASES_URL)
  })

  it("never opens a release link that only starts with this app's releases path", () => {
    // `..` climbs out of the releases path; the browser resolves it to Orca's repo.
    useAppUpdateStore.setState({
      status: 'available',
      latestVersion: '0.9.200',
      releaseUrl: `${CODE_UI_RELEASES_URL}/../../../stablyai/orca/releases`
    })
    const output = render({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    })
    expect(output).not.toContain('Get Code UI')
    expect(primaryActionUrl()).toBe(CODE_UI_RELEASES_URL)
  })

  it('opens the collapsed form of a release link that has dot segments', () => {
    useAppUpdateStore.setState({
      status: 'available',
      latestVersion: '0.9.200',
      releaseUrl: `${CODE_UI_RELEASES_URL}/./tag/mobile-android-v0.9.200`
    })
    render({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    })
    expect(primaryActionUrl()).toBe(`${CODE_UI_RELEASES_URL}/tag/mobile-android-v0.9.200`)
  })

  it('names the phone app Code UI and the desktop Orca, never the phone app Orca Mobile', () => {
    const phone = render({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    })
    expect(phone).not.toContain('Orca Mobile')
    expect(phone).toContain('Update Code UI')
    act(() => renderer?.unmount())
    const desktop = render({
      kind: 'blocked',
      reason: 'desktop-too-old',
      desktopVersion: 0,
      requiredDesktopVersion: 2
    })
    expect(desktop).not.toContain('Orca Mobile')
    expect(desktop).toContain('Update Orca on your computer')
  })

  it("never opens a release link that is not on this app's repo", () => {
    useAppUpdateStore.setState({
      status: 'available',
      latestVersion: '0.9.200',
      releaseUrl: 'https://github.com/stablyai/orca/releases/tag/v1.4.219'
    })
    const output = render({
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    })
    expect(output).not.toContain('Get Code UI')
    expect(primaryActionUrl()).toBe(CODE_UI_RELEASES_URL)
  })

  it('sends a host without a bundle to the desktop update', () => {
    const output = render({ kind: 'blocked', reason: 'bundle-unavailable' })
    expect(output).toContain('Update Orca on your computer')
    expect(output).toContain(
      'This paired desktop app does not include the mobile workspace yet. Update Orca on your computer, then try this host again.'
    )
    expect(primaryActionUrl()).toBe(ORCA_DESKTOP_RELEASES_URL)
  })

  it('sends an unknown manifest schema to the mobile update', () => {
    const output = render({
      kind: 'blocked',
      reason: 'bundle-shell-too-old',
      schemaVersion: 2
    })
    expect(output).toContain('Update Code UI')
    expect(output).toContain(
      "This desktop's mobile workspace needs a newer Code UI app. Update Code UI from GitHub Releases, then try this host again."
    )
    expect(primaryActionUrl()).toBe(CODE_UI_RELEASES_URL)
  })

  it('offers no download for a cached bundle the host outgrew, because none would clear it', () => {
    const output = render({
      kind: 'blocked',
      reason: 'bundle-incompatible',
      side: 'mobile',
      bundleRuntimeProtocolVersion: 3,
      requiredBundleRuntimeProtocolVersion: 4
    })

    expect(output).toContain('Refresh the mobile workspace')
    expect(output).toContain(
      'The workspace cached for this host is older than the desktop expects. Reconnect to this host to download the current one.'
    )
    // A store update cannot replace a stale cache, so neither store link is offered.
    expect(output).not.toContain('Open App Store')
    expect(output).not.toContain('Open GitHub Releases')
    expect(output).not.toContain('Update Orca')
    // Back to hosts is the only button left, and it is not a download.
    expect(pressableCount()).toBe(1)
    expect(output).toContain('Back to hosts')
    // Nothing was "already updated" here; the note keeps only the pairing fallback.
    expect(output).not.toContain('Already updated?')
    expect(output).toContain('If this message stays, remove this host and pair it again.')
  })

  it('sends a host older than its own bundle to the desktop update', () => {
    const output = render({
      kind: 'blocked',
      reason: 'bundle-incompatible',
      side: 'desktop',
      hostProtocolVersion: 1,
      requiredHostProtocolVersion: 2
    })
    expect(output).toContain('Update Orca on your computer')
    expect(output).toContain('This paired desktop app is too old for your current Code UI app')
    expect(primaryActionUrl()).toBe(ORCA_DESKTOP_RELEASES_URL)
  })

  it('routes an Android bundle wall to GitHub Releases, not a store that has no listing', () => {
    nativeTestState.platform.OS = 'android'
    const output = render({
      kind: 'blocked',
      reason: 'bundle-shell-too-old',
      schemaVersion: 2
    })
    expect(output).toContain('Update Code UI from GitHub Releases')
    expect(primaryActionUrl()).toBe(CODE_UI_RELEASES_URL)
  })

  it('keeps the update walls on two buttons and the full recovery note', () => {
    const output = render({ kind: 'blocked', reason: 'bundle-unavailable' })
    expect(output).toContain('Already updated? Go back to Hosts and refresh the connection.')
    // The presence precondition for the absence asserted on the refresh wall above.
    expect(pressableCount()).toBe(2)
  })
})

// Code UI (2026-09-19): the wall painted from the legacy static palette until this test, which
// passed every check while rendering dark on a light phone. Both schemes are required states.
describe('ProtocolBlockScreen follows the appearance setting', () => {
  beforeEach(() => {
    nativeTestState.platform.OS = 'android'
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const verdict: BlockedVerdict = {
    kind: 'blocked',
    reason: 'desktop-too-old',
    desktopVersion: 1,
    requiredDesktopVersion: 99
  }

  it('paints the light canvas and text in light', () => {
    const light = renderThemed('light', verdict)
    expect(light).toContain(lightColors.bg)
    expect(light).toContain(lightColors.text)
    expect(light).not.toContain(darkColors.bg)
  })

  it('paints the named-release button in both themes', () => {
    useAppUpdateStore.setState({
      status: 'available',
      latestVersion: '0.9.200',
      releaseUrl: KNOWN_RELEASE_URL
    })
    const phoneVerdict: BlockedVerdict = {
      kind: 'blocked',
      reason: 'mobile-too-old',
      desktopVersion: 5,
      requiredMobileVersion: 99
    }
    const light = renderThemed('light', phoneVerdict)
    expect(light).toContain('Get Code UI 0.9.200')
    expect(light).toContain(lightColors.text)
    expect(light).not.toContain(darkColors.bg)
    act(() => renderer?.unmount())
    const dark = renderThemed('dark', phoneVerdict)
    expect(dark).toContain('Get Code UI 0.9.200')
    expect(dark).toContain(darkColors.text)
    expect(dark).not.toContain(lightColors.bg)
  })

  it('paints the dark canvas and text in dark', () => {
    const dark = renderThemed('dark', verdict)
    expect(dark).toContain(darkColors.bg)
    expect(dark).toContain(darkColors.text)
    expect(dark).not.toContain(lightColors.bg)
  })
})
