import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app draws + and the mic each in a filled circle one step above the
// composer's surface, and send as an accent circle (dimmed with nothing to
// send); ours drew + and mic bare and send in a grey circle (two screenshots,
// same phone, 2026-10-09). Both schemes are real states here: a literal colour
// passes in one and ships the wrong tone in the other.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Code: 'Code',
  Hand: 'Hand',
  Image: 'Image',
  ImagePlus: 'ImagePlus',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Zap: 'Zap',
  Plus: 'Plus',
  Square: 'Square',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))

import { MobileNativeChatComposer } from './MobileNativeChatComposer'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown, pressed = false): Record<string, unknown> {
  if (typeof style === 'function') {
    return flat((style as (state: { pressed: boolean }) => unknown)({ pressed }), pressed)
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flat(entry, pressed)))
  }
  return (style ?? {}) as Record<string, unknown>
}

async function render(scheme: 'light' | 'dark', value: string, extra: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: scheme },
        createElement(MobileNativeChatComposer, {
          value,
          onChangeText: vi.fn(),
          onSend: vi.fn().mockResolvedValue(true),
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          onAttachImage: vi.fn(),
          onMicPress: vi.fn(),
          ...extra
        })
      )
    )
  })
}

function button(label: string): ReactTestInstance {
  return renderer!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label
  )
}

describe('the composer’s round action buttons', () => {
  it.each(['light', 'dark'] as const)('fills + and the mic in a circle one step above the composer in %s', async (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    await render(scheme, '')
    const send = flat(button('Send message').props.style)
    for (const label of ['Attach image', 'Dictate']) {
      const style = flat(button(label).props.style)
      expect(style.backgroundColor, `${scheme} ${label}`).toBe(colors.bgRaised)
      expect(style.backgroundColor, `${scheme} ${label}`).not.toBe(colors.bgPanelGlass)
      // The send circle's size, so the three read as one row of circles.
      expect(style).toMatchObject({ width: send.width, height: send.height, borderRadius: send.borderRadius })
      // A press still shows, one tone past the resting circle.
      expect(flat(button(label).props.style, true).backgroundColor, `${scheme} ${label} pressed`).toBe(
        colors.borderStrong
      )
    }
  })

  it.each(['light', 'dark'] as const)('keeps the mic’s recording tone while dictating in %s', async (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    await render(scheme, '', { micActive: true })
    expect(flat(button('Stop dictation').props.style).backgroundColor).toBe(colors.dangerSoft)
  })

  it.each(['light', 'dark'] as const)('draws send as an accent circle, dimmed with nothing to send, in %s', async (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    await render(scheme, ' hello ')
    const live = flat(button('Send message').props.style)
    expect(live.backgroundColor).toBe(colors.accent)
    expect(live.opacity ?? 1).toBe(1)
    expect(button('Send message').props.disabled).toBe(false)
    await act(async () => renderer!.unmount())
    renderer = null
    await render(scheme, '')
    const idle = flat(button('Send message').props.style)
    expect(idle.backgroundColor).toBe(colors.accent)
    expect(idle.opacity).toBeLessThan(1)
    expect(idle.opacity).toBeGreaterThan(0)
    expect(button('Send message').props.disabled).toBe(true)
  })

  it('keeps the labels and 36 dp touch targets', async () => {
    await render('dark', '')
    for (const label of ['Attach image', 'Dictate', 'Send message']) {
      expect(flat(button(label).props.style)).toMatchObject({ width: 36, height: 36 })
    }
  })
})
