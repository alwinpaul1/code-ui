import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A bottom sheet is a native Modal: a Dialog window, laid out below the
// keyboard's window. Opened while the chat composer's keyboard is up, it
// stood at rest UNDER the keyboard until the keyboard left, and the keyboard
// left only once the Dialog had taken focus. On the S23 Ultra (2026-09-27)
// that was 128 ms after the finger lifted, and the + sheet was fully
// uncovered at 286 ms. A sheet with nothing to type now sends the keyboard
// away in the commit that opens it, before its window exists.
//
// A sheet that brings its own keyboard (an autoFocus field: TextInputModal,
// the smart-source and diff-comment drawers) does not ask: the dismissal
// would blur the field it just focused.

const keyboardDismiss = vi.hoisted(() => vi.fn())

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: {
    addListener: () => ({ remove: () => {} }),
    dismiss: keyboardDismiss,
    metrics: () => null
  },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 956 })
}))

import { ThemeProvider } from '../theme/theme-context'
import { BottomDrawer } from './BottomDrawer'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  keyboardDismiss.mockReset()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function sheet(scheme: 'light' | 'dark', visible: boolean, dismissKeyboardOnOpen?: boolean): ReactElement {
  return (
    <ThemeProvider initialPreference={scheme}>
      <BottomDrawer visible={visible} onClose={() => {}} dismissKeyboardOnOpen={dismissKeyboardOnOpen}>
        {createElement('View', { testID: 'sheet-body' })}
      </BottomDrawer>
    </ThemeProvider>
  )
}

async function mountClosed(scheme: 'light' | 'dark', dismissKeyboardOnOpen?: boolean): Promise<void> {
  await act(async () => {
    renderer = create(sheet(scheme, false, dismissKeyboardOnOpen))
  })
  keyboardDismiss.mockClear()
}

async function setVisible(scheme: 'light' | 'dark', visible: boolean, dismissKeyboardOnOpen?: boolean): Promise<number> {
  keyboardDismiss.mockClear()
  await act(async () => {
    renderer!.update(sheet(scheme, visible, dismissKeyboardOnOpen))
  })
  return keyboardDismiss.mock.calls.length
}

function modalMounted(): boolean {
  return renderer!.root.findAll((node) => (node.type as unknown) === 'Modal').length > 0
}

describe.each(['light', 'dark'] as const)('a sheet with nothing to type, in %s mode', (scheme) => {
  it('sends the keyboard away in the commit that opens it', async () => {
    await mountClosed(scheme, true)
    let modalWhenAsked: boolean | null = null
    keyboardDismiss.mockImplementation(() => {
      modalWhenAsked = modalMounted()
    })

    expect(await setVisible(scheme, true, true), 'the sheet left the keyboard for its window to take away').toBe(1)
    // The same commit: the Modal element is in the tree (its native window
    // is built on the next UI frame, after this view command has run).
    expect(modalWhenAsked).toBe(true)
  })

  it('asks once per open, not on every render while it stays open', async () => {
    await mountClosed(scheme, true)
    expect(await setVisible(scheme, true, true)).toBe(1)
    expect(await setVisible(scheme, true, true)).toBe(0)
  })

  it('asks again when it opens a second time', async () => {
    await mountClosed(scheme, true)
    await setVisible(scheme, true, true)
    await setVisible(scheme, false, true)
    expect(await setVisible(scheme, true, true)).toBe(1)
  })
})

describe.each(['light', 'dark'] as const)('a sheet that brings its own keyboard, in %s mode', (scheme) => {
  it('opens without touching the keyboard when it does not ask', async () => {
    await mountClosed(scheme)
    expect(await setVisible(scheme, true)).toBe(0)
  })
})
