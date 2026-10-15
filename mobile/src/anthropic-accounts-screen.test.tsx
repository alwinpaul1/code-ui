import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Anthropic sign-in lives on its own Settings screen, not under Voice (the user, 2026-10-15):
 * sign-in now matters for session matching, the model pill, usage and sending, not only dictation.
 * Pins the screen in both themes, the row that opens it, the keyboard rule for its code field, and
 * that Voice no longer draws the accounts section.
 */

const nav = vi.hoisted(() => ({ pushed: new Array<string>() }))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Linking: { openURL: vi.fn() },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Info: 'Info',
  Bell: 'Bell',
  Wrench: 'Wrench',
  LifeBuoy: 'LifeBuoy',
  Mic: 'Mic',
  Globe: 'Globe',
  MessageSquare: 'MessageSquare',
  Palette: 'Palette',
  Terminal: 'Terminal',
  KeyRound: 'KeyRound',
  UserRound: 'UserRound'
}))
vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn(), push: (href: string) => nav.pushed.push(href) }),
  useFocusEffect: () => {}
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('./transport/host-credential-cleanup', () => ({
  loadPendingHostCredentialCleanup: async () => ({ ids: [], storageUnreadable: false }),
  subscribePendingHostCredentialCleanup: () => () => {}
}))
vi.mock('./transport/host-store', () => ({
  loadHostCatalog: async () => [],
  retryPendingHostCredentialCleanup: async () => ({ remainingIds: [], storageUnreadable: false })
}))
// The sign-in row reads the keychain (expo-secure-store), which does not exist under vitest.
vi.mock('./dictation/anthropic-auth-store', () => ({
  startLogin: vi.fn(),
  exchangeCode: vi.fn(),
  getSavedVerifier: async () => null,
  listAccounts: async () => [],
  removeAccount: async () => {},
  accountLabel: () => 'Account'
}))

import AnthropicAccountsScreen from '../app/anthropic-accounts'
import SettingsScreen from '../app/settings'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, lightColors } from './theme/tokens'

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  if (typeof style === 'function') {
    return [...stylesOf(style({ pressed: false })), ...stylesOf(style({ pressed: true }))]
  }
  return typeof style === 'object' && style !== null ? [style as Record<string, unknown>] : []
}

const textNodes = (root: ReactTestRenderer['root'], text: string) =>
  root.findAll((node) => String(node.type) === 'Text' && node.props.children === text)

describe('the Anthropic accounts screen', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    nav.pushed.length = 0
  })

  async function draw(scheme: 'light' | 'dark', screen: () => React.JSX.Element) {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>{createElement(screen)}</ThemeProvider>
      )
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve()
      }
    })
    return renderer!.root
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('shows the accounts section on the %s theme', async (scheme, palette) => {
    const root = await draw(scheme, AnthropicAccountsScreen)
    const canvas = root.findAll((node) => String(node.type) === 'View')[0]
    expect(stylesOf(canvas?.props.style).map((s) => s.backgroundColor)).toContain(palette.bg)
    expect(textNodes(root, 'Anthropic accounts')).toHaveLength(1)
    const signIn = textNodes(root, 'Sign in to Anthropic')[0]
    expect(signIn).toBeDefined()
    expect(stylesOf(signIn!.props.style).map((s) => s.color)).toContain(palette.text)
  })

  it('keeps taps with the keyboard up, for the paste-the-code field', async () => {
    const root = await draw('light', AnthropicAccountsScreen)
    const scroller = root.findAll((node) => String(node.type) === 'ScrollView')[0]
    expect(scroller?.props.keyboardShouldPersistTaps).toBe('handled')
  })

  it('does not say the first sign-in is required for voice dictation', async () => {
    const root = await draw('light', AnthropicAccountsScreen)
    const all = root
      .findAll((node) => String(node.type) === 'Text')
      .map((n) => String(n.props.children))
    expect(all.join('\n')).not.toMatch(/voice/i)
  })

  it('has a Settings row that opens it', async () => {
    const root = await draw('light', SettingsScreen)
    const row = root.findAll(
      (node) =>
        String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Anthropic accounts'
    )[0]
    expect(row).toBeDefined()
    act(() => row!.props.onPress())
    expect(nav.pushed).toEqual(['/anthropic-accounts'])
  })

  it('is registered as a route', () => {
    expect(readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8')).toMatch(
      /<Stack\.Screen name="anthropic-accounts"/
    )
  })
})

describe('Voice settings', () => {
  it('no longer mounts the accounts section', () => {
    const src = readFileSync(new URL('../app/voice-settings.tsx', import.meta.url), 'utf8')
    expect(src).not.toMatch(/AnthropicAccountsSection/)
  })
})
