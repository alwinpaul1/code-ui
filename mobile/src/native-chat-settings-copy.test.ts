import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NativeChatSettingsScreen from '../app/native-chat-settings'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn() })
}))

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft'
}))

vi.mock('./session/use-mobile-default-session-view-preference', () => ({
  useMobileDefaultSessionViewPreference: () => ({
    defaultView: 'chat',
    setDefaultView: vi.fn()
  })
}))

vi.mock('./session/desktop-hud-launch-preference', () => ({
  loadDesktopHudLaunchEnabled: async () => true,
  saveDesktopHudLaunchEnabled: async () => undefined
}))

vi.mock('./session/agent-hud-desktop-launch-args', () => ({
  syncAgentHudDesktopLaunchArgs: async () => undefined
}))

vi.mock('./transport/use-all-host-clients', () => ({
  useAllHostClients: () => []
}))

vi.mock('./transport/host-store', () => ({
  loadHostCatalog: async () => []
}))

function collectText(renderer: ReactTestRenderer): string {
  const parts: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      parts.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        visit(child)
      }
    }
  }
  for (const node of renderer.root.findAllByType('Text')) {
    visit(node.props.children)
  }
  return parts.join(' ')
}

describe('Chat UI settings copy', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps the toggles and drops the help copy under them', async () => {
    await act(async () => {
      renderer = create(createElement(NativeChatSettingsScreen))
      await Promise.resolve()
    })
    const text = collectText(renderer!)
    expect(text).toContain('Open sessions in Chat UI')
    expect(text).toContain('Desktop agents report model and context')
    expect(text).not.toMatch(/Chat-capable agents/)
    expect(text).not.toMatch(/escape sequence/)
    expect(text).not.toMatch(/long-press away/)
    expect(text).not.toMatch(/launch profile/)
  })
})
