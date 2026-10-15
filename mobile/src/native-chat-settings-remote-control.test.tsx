import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-10-15: "make all sessions from our system have RC on by default and it must be in
// settings, on". The switch lives on the Chat UI screen, under "Claude sessions".

vi.mock('react-native', () => ({
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
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))

import NativeChatSettingsScreen from '../app/native-chat-settings'
import {
  peekRemoteControlNewSessions,
  resetRemoteControlPreferenceMemoryForTests
} from './storage/remote-control-preference'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, lightColors } from './theme/tokens'

let renderer: ReactTestRenderer | null = null
const LABEL = 'Remote Control for new Claude sessions'

beforeEach(async () => {
  resetRemoteControlPreferenceMemoryForTests()
  await AsyncStorage.removeItem('orca:remoteControlNewClaudeSessions')
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetRemoteControlPreferenceMemoryForTests()
})

async function draw(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>{createElement(NativeChatSettingsScreen)}</ThemeProvider>
    )
    await Promise.resolve()
    await Promise.resolve()
  })
  return renderer!
}

const theSwitch = (tree: ReactTestRenderer): ReactTestInstance =>
  tree.root.find((node) => (node.type as unknown) === 'Switch' && node.props.accessibilityLabel === LABEL)

describe('Remote Control for new Claude sessions, in Settings', () => {
  it('is on before anything was ever chosen', async () => {
    const tree = await draw()
    expect(theSwitch(tree).props.value).toBe(true)
  })

  it('saves off when it is turned off, and a later read keeps it off', async () => {
    const tree = await draw()
    await act(async () => {
      theSwitch(tree).props.onValueChange(false)
      await Promise.resolve()
    })
    expect(theSwitch(tree).props.value).toBe(false)
    expect(peekRemoteControlNewSessions()).toBe(false)
    expect(await AsyncStorage.getItem('orca:remoteControlNewClaudeSessions')).toBe('off')
  })

  it('shows what storage holds when the user turned it off earlier', async () => {
    await AsyncStorage.setItem('orca:remoteControlNewClaudeSessions', 'off')
    const tree = await draw()
    expect(theSwitch(tree).props.value).toBe(false)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('colours its track and thumb from the %s palette', async (scheme, palette) => {
    const tree = await draw(scheme)
    const props = theSwitch(tree).props
    expect(props.trackColor).toEqual({ false: palette.borderStrong, true: palette.accent })
    expect(props.thumbColor).toBe(palette.bgPanel)
  })
})
