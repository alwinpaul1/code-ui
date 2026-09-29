import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Same shape as the 2026-09-29 pairing-screen flash: the custom-shortcut list starts as [] while
 * loadCustomKeys() is in flight, and the section said "No custom shortcuts defined yet." over a
 * phone that has some. Rendered in both themes; the claim must wait for the read.
 */
const keys = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Switch: 'Switch',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
vi.mock('expo-router', async () => {
  const react = await import('react')
  return { useFocusEffect: (effect: () => void) => react.useEffect(effect, [effect]) }
})
vi.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight', X: 'X' }))
vi.mock('./DragReorderList', () => ({ DragReorderList: 'DragReorderList' }))
vi.mock('./CustomKeyModal', () => ({
  CustomKeyModal: 'CustomKeyModal',
  loadCustomKeys: keys.load,
  saveCustomKeys: vi.fn(async () => undefined)
}))
vi.mock('../terminal/terminal-accessory-layout', async (importActual) => ({
  ...(await importActual<object>()),
  loadTerminalAccessoryLayout: async () => ({ orderedBuiltInIds: [], visibleBuiltInIds: [] }),
  saveTerminalAccessoryLayout: async () => undefined
}))

import { ThemeProvider } from '../theme/theme-context'
import { TerminalShortcutSettings } from './TerminalShortcutSettings'

const EMPTY_CLAIM = 'No custom shortcuts defined yet.'
const props = {
  scrollRef: { current: null } as never,
  scrollOffsetY: { value: 0 } as never,
  scrollContentHeight: { value: 0 } as never,
  onDragActiveChange: () => {}
}

describe('custom shortcut section before its read lands', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    keys.load.mockReset()
  })
  async function mount(scheme: 'light' | 'dark') {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(TerminalShortcutSettings, props)
        )
      )
    })
    return () => JSON.stringify(renderer!.toJSON())
  }

  it.each(['light', 'dark'] as const)(
    'does not say none are defined while the read is in flight (%s)',
    async (scheme) => {
      let release: (v: unknown[]) => void = () => {}
      keys.load.mockReturnValue(new Promise((r) => (release = r)))
      const text = await mount(scheme)
      expect(text()).not.toContain(EMPTY_CLAIM)
      await act(async () => release([]))
      expect(text()).toContain(EMPTY_CLAIM)
    }
  )

  it.each(['light', 'dark'] as const)(
    'never shows the claim for one or several saved shortcuts (%s)',
    async (scheme) => {
      keys.load.mockResolvedValue([{ id: '1', label: 'A', bytes: 'a' }])
      expect((await mount(scheme))()).not.toContain(EMPTY_CLAIM)
    }
  )

  it('shows the claim once a read that came back empty has finished', async () => {
    keys.load.mockResolvedValue([])
    expect((await mount('light'))()).toContain(EMPTY_CLAIM)
  })
})
