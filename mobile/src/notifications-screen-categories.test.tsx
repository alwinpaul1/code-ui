import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Claude Android app's two Code notification toggles (tl8.java:1173-1521): "Code updates" and
// "Code permission requests", each with its own words. They sit under the one switch the screen
// already had ("Agent notifications", which still turns everything off), and map to the two kinds
// of banner the app tells apart (src/notifications/notification-categories.ts).

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
import {
  NOTIFICATION_CATEGORIES_STORAGE_KEY,
  loadNotificationCategories,
  resetNotificationCategoriesForTests,
  saveNotificationCategories
} from './notifications/notification-categories'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, lightColors } from './theme/tokens'

let renderer: ReactTestRenderer | null = null

beforeEach(async () => {
  prefs.enabled = true
  resetNotificationCategoriesForTests()
  await AsyncStorage.removeItem(NOTIFICATION_CATEGORIES_STORAGE_KEY)
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

const switchLabelled = (tree: ReactTestRenderer, label: string): ReactTestInstance =>
  tree.root.find((node) => (node.type as unknown) === 'Switch' && node.props.accessibilityLabel === label)
const texts = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  return typeof style === 'object' && style !== null ? [style as Record<string, unknown>] : []
}

describe('the Code notification toggles', () => {
  it('are drawn with the Claude app’s words, under the Agent notifications switch', async () => {
    const tree = await draw()
    const shown = texts(tree)
    expect(shown).toContain('Code updates')
    expect(shown).toContain('Get notified when Code sessions have updates')
    expect(shown).toContain('Code permission requests')
    expect(shown).toContain('Get notified when Code sessions need your approval to use a tool')
    expect(shown.indexOf('Code updates')).toBeGreaterThan(shown.indexOf('Agent notifications'))
  })

  it('both read on until a reader turns one off', async () => {
    const tree = await draw()
    expect(switchLabelled(tree, 'Code updates').props.value).toBe(true)
    expect(switchLabelled(tree, 'Code permission requests').props.value).toBe(true)
  })

  it('turn one off without touching the other, and keep it', async () => {
    const tree = await draw()
    await act(async () => {
      switchLabelled(tree, 'Code updates').props.onValueChange(false)
      for (let i = 0; i < 4; i += 1) {
        await Promise.resolve()
      }
    })
    expect(switchLabelled(tree, 'Code updates').props.value).toBe(false)
    expect(switchLabelled(tree, 'Code permission requests').props.value).toBe(true)
    expect(await loadNotificationCategories()).toEqual({ updates: false, permissionRequests: true })
  })

  it('show what was stored the last time', async () => {
    await saveNotificationCategories({ permissionRequests: false })
    const tree = await draw()
    expect(switchLabelled(tree, 'Code updates').props.value).toBe(true)
    expect(switchLabelled(tree, 'Code permission requests').props.value).toBe(false)
  })

  it('cannot be turned on under an Agent notifications switch that is off, and keep their values', async () => {
    prefs.enabled = false
    await saveNotificationCategories({ updates: false })
    const tree = await draw()
    expect(switchLabelled(tree, 'Code updates').props.disabled).toBe(true)
    expect(switchLabelled(tree, 'Code permission requests').props.disabled).toBe(true)
    expect(switchLabelled(tree, 'Code updates').props.value).toBe(false)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('use the %s palette for their track and thumb', async (scheme, palette) => {
    const tree = await draw(scheme)
    const toggle = switchLabelled(tree, 'Code updates')
    expect(toggle.props.trackColor).toEqual({ false: palette.borderStrong, true: palette.accent })
    expect(toggle.props.thumbColor).toBe(palette.bgPanel)
    const label = tree.root.findAll(
      (node) => (node.type as unknown) === 'Text' && node.children.join('') === 'Code updates'
    )[0]!
    expect(stylesOf(label.props.style).map((style) => style.color)).toContain(palette.text)
  })
})
