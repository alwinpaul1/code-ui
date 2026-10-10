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

const setFocusView = vi.fn()
vi.mock('./session/use-mobile-chat-focus-view', () => ({
  useMobileChatFocusViewPreference: () => ({ focusView: false, setFocusView })
}))

const setExpandTools = vi.fn()
vi.mock('./session/use-mobile-chat-expand-tools', () => ({
  useMobileChatExpandToolsPreference: () => ({ expandTools: false, setExpandTools })
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
    // 2026-10-10: the desktop beacon flags are always on; no switch, no section.
    expect(text).not.toMatch(/Model and context on the desktop/)
    expect(text).not.toMatch(/report model and context/)
    expect(
      renderer!.root.findAll(
        (node) => node.type === 'Switch' && /model and context/i.test(String(node.props.accessibilityLabel))
      )
    ).toHaveLength(0)
    expect(text).not.toMatch(/Chat-capable agents/)
    expect(text).not.toMatch(/escape sequence/)
    expect(text).not.toMatch(/long-press away/)
    expect(text).not.toMatch(/launch profile/)
  })

  // Extension `claudeCode.focusView`, beside the other view option this screen
  // already holds: one switch, its state read from and written to the same
  // store as the default session view.
  it('offers Focus view beside the default view, wired to the preference', async () => {
    await act(async () => {
      renderer = create(createElement(NativeChatSettingsScreen))
      await Promise.resolve()
    })
    expect(collectText(renderer!)).toContain('Focus view')
    const toggle = renderer!.root.find(
      (node) => node.type === 'Switch' && node.props.accessibilityLabel === 'Focus view'
    )
    expect(toggle.props.value).toBe(false)
    act(() => toggle.props.onValueChange(true))
    expect(setFocusView).toHaveBeenCalledWith(true)
  })

  // 2026-10-10: the chat's "Tools" button became this switch, like Focus view
  // beside it: off by default, saved through the preference hook.
  it('offers Expand tool calls under Focus view, wired to the preference', async () => {
    await act(async () => {
      renderer = create(createElement(NativeChatSettingsScreen))
      await Promise.resolve()
    })
    const text = collectText(renderer!)
    expect(text).toContain('Expand tool calls')
    expect(text.indexOf('Expand tool calls')).toBeGreaterThan(text.indexOf('Focus view'))
    const toggle = renderer!.root.find(
      (node) => node.type === 'Switch' && node.props.accessibilityLabel === 'Expand tool calls'
    )
    expect(toggle.props.value).toBe(false)
    act(() => toggle.props.onValueChange(true))
    expect(setExpandTools).toHaveBeenCalledWith(true)
  })
})
