import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
// Why: lucide's entry pulls React Native internals that the host-tag mock above removed.
vi.mock('lucide-react-native', () => ({
  Check: 'Check',
  Edit3: 'Edit3',
  Eye: 'Eye',
  EyeOff: 'EyeOff',
  Lock: 'Lock',
  LockOpen: 'LockOpen',
  MonitorOff: 'MonitorOff',
  Sunrise: 'Sunrise',
  Volume2: 'Volume2',
  VolumeX: 'VolumeX',
  Trash2: 'Trash2'
}))
// Why: the drawer is a native modal stack; the sheet's own colours are what is under test.
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ children }: { children: unknown }) => children
}))
// Why: expo-secure-store reaches for expo-modules-core's native EventEmitter, which
// does not exist once 'react-native' is a handful of host tags.
vi.mock('./mac-unlock-password-store', () => ({
  writeMacUnlockPassword: vi.fn(),
  clearMacUnlockPassword: vi.fn()
}))

import { ActionSheetContent } from '../components/ActionSheetModal'
import { ThemeProvider } from '../theme/theme-context'
import { MacHostToast } from './MacHostToast'
import { MacUnlockPasswordSheet } from './MacUnlockPasswordSheet'
import { getMacHostSheetActions } from './mac-host-sheet-actions'

function renderInScheme(scheme: 'light' | 'dark', element: ReturnType<typeof createElement>) {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(ThemeProvider, { initialPreference: scheme }, element))
  })
  return renderer!
}

function backgroundsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => typeof node.props?.style === 'object' && node.props.style !== null)
    .flatMap((node) => {
      const style = node.props.style as Record<string, unknown>
      return typeof style.backgroundColor === 'string' ? [style.backgroundColor] : []
    })
}

describe('the Mac controls in both themes', () => {
  it('paints the toast from the live theme, not one fixed palette', () => {
    const light = backgroundsOf(renderInScheme('light', createElement(MacHostToast, { message: 'Locking the Mac…' })))
    const dark = backgroundsOf(renderInScheme('dark', createElement(MacHostToast, { message: 'Locking the Mac…' })))
    expect(light.length).toBeGreaterThan(0)
    expect(dark).not.toEqual(light)
  })

  it('paints the password sheet from the live theme too', () => {
    const props = {
      hostId: 'host-1',
      onClose: vi.fn(),
      onSaved: vi.fn()
    }
    const light = backgroundsOf(renderInScheme('light', createElement(MacUnlockPasswordSheet, props)))
    const dark = backgroundsOf(renderInScheme('dark', createElement(MacUnlockPasswordSheet, props)))
    expect(light.length).toBeGreaterThan(0)
    expect(dark).not.toEqual(light)
  })

  it('paints the "checking the Mac" row from the live theme in both schemes', () => {
    const checkingRow = () =>
      createElement(ActionSheetContent, {
        actions: getMacHostSheetActions({
          hostPlatform: 'darwin',
          worktreeId: 'wt-1',
          state: 'checking',
          onAction: vi.fn()
        })
      })
    const light = renderInScheme('light', checkingRow())
    const dark = renderInScheme('dark', checkingRow())
    expect(JSON.stringify(light.toJSON())).toContain('Checking the Mac…')
    expect(JSON.stringify(dark.toJSON())).toContain('Checking the Mac…')
    expect(backgroundsOf(dark)).not.toEqual(backgroundsOf(light))
  })

  it('holds Unlock Mac to forget the saved password, in light and dark', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const onForget = vi.fn()
      const onAction = vi.fn()
      const onClose = vi.fn()
      const renderer = renderInScheme(
        scheme,
        createElement(ActionSheetContent, {
          onClose,
          actions: getMacHostSheetActions({
            hostPlatform: 'darwin',
            worktreeId: 'wt-1',
            state: { lock: 'locked', display: 'on', mute: 'unmuted' },
            onAction,
            onForgetUnlockPassword: onForget
          })
        })
      )
      const unlock = renderer.root.findAllByType('Pressable').find((node) =>
        node.findAllByType('Text').some((text) => text.children.includes('Unlock Mac'))
      )
      expect(unlock?.props.onLongPress).toEqual(expect.any(Function))
      expect(JSON.stringify(renderer.toJSON())).not.toContain('Hold to forget the saved password')
      act(() => unlock?.props.onLongPress())
      expect(onForget).toHaveBeenCalledOnce()
      expect(onAction).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledOnce()
    }
  })

  it('titles the sheet Unlock Mac and reveals what was typed, in light and dark', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const renderer = renderInScheme(
        scheme,
        createElement(MacUnlockPasswordSheet, {
          hostId: 'host-1',
          onClose: vi.fn(),
          onSaved: vi.fn()
        })
      )
      const text = JSON.stringify(renderer.toJSON())
      expect(text).toContain('Unlock Mac')
      expect(text).not.toContain('Mac unlock password')
      expect(text).not.toContain('stored on this phone')
      const field = renderer.root.findByType('TextInput')
      expect(field.props.secureTextEntry).toBe(true)
      const reveal = renderer.root
        .findAllByType('Pressable')
        .find((node) => node.props.accessibilityLabel === 'Show password')
      expect(reveal).toBeDefined()
      act(() => reveal?.props.onPress())
      expect(renderer.root.findByType('TextInput').props.secureTextEntry).toBe(false)
      expect(
        renderer.root.findAllByType('Pressable').some((node) => node.props.accessibilityLabel === 'Hide password')
      ).toBe(true)
    }
  })
})
