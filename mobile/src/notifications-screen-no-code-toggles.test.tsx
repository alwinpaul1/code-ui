import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Code sessions section ("Code updates", "Code permission requests") was removed on 2026-10-16
// at the user's request: "Just have code notification turned on by default and remove those from
// notifications". Agent notifications is the one switch left.

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  Linking: { openSettings: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))
vi.mock('expo-router', async () => {
  const React = await import('react')
  return {
    useRouter: () => ({ back: vi.fn() }),
    useFocusEffect: (callback: () => void) => {
      React.useEffect(callback, [callback])
    }
  }
})
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
const prefs = vi.hoisted(() => ({ enabled: true }))
vi.mock('./storage/preferences', () => ({
  loadPushNotificationsEnabled: async () => prefs.enabled,
  savePushNotificationsEnabled: async (value: boolean) => {
    prefs.enabled = value
  }
}))
vi.mock('./notifications/mobile-notifications', () => ({
  ensureNotificationPermissions: async () => true,
  getNotificationPermissionState: async () => ({
    granted: true,
    status: 'granted',
    canAskAgain: true,
    authorizationReflectsUserChoice: true
  })
}))
vi.mock('./background/background-link', () => ({
  applyBackgroundDelivery: vi.fn(),
  isBackgroundDeliveryAvailable: () => false,
  isBackgroundDeliveryUnrestricted: () => true,
  requestBackgroundDeliveryUnrestricted: vi.fn()
}))
vi.mock('./background/background-delivery-power', () => ({
  adviseBackgroundDeliveryPower: () => ({ showRow: false, caption: '', promptOnEnable: false })
}))

import NotificationsScreen from '../app/notifications'
import { ThemeProvider } from './theme/theme-context'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  prefs.enabled = true
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function draw(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{createElement(NotificationsScreen)}</ThemeProvider>)
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve()
    }
  })
  return renderer!
}

const switchLabels = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => (node.type as unknown) === 'Switch')
    .map((node) => String(node.props.accessibilityLabel))
const texts = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))

describe('the Notifications screen', () => {
  it.each(['light', 'dark'] as const)('has no Code sessions toggles, only Agent notifications (%s)', async (scheme) => {
    const tree = await draw(scheme)
    const shown = texts(tree)
    expect(shown).not.toContain('Code sessions')
    expect(shown).not.toContain('Code updates')
    expect(shown).not.toContain('Code permission requests')
    expect(switchLabels(tree)).toEqual(['Agent notifications'])
  })
})
