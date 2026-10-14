import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Reported 2026-10-14 from a Samsung phone: the keyboard up over a terminal
// tab, the live field showing "Tap to type" with no caret, its border not in
// the focused accent. The session's focus hook takes such a keyboard back
// (terminal-live-input-keeps-keyboard.test.ts); this pins that the live field
// on screen is wired to it, in light and in dark, and that its caret is the
// theme's caret colour.

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'dark'
}))
vi.mock('lucide-react-native', () => ({ ArrowUp: 'ArrowUp' }))
vi.mock('./MobileSessionAccessoryStrip', () => ({ MobileSessionAccessoryStrip: () => null }))
vi.mock('./MobileTerminalInputActions', () => ({ MobileTerminalInputActions: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileSessionCommandDock } from './MobileSessionCommandDock'
import type { MobileSessionController } from './use-mobile-session-controller'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function renderDock(scheme: 'light' | 'dark', overrides: Record<string, unknown> = {}) {
  const wiring = {
    armLiveInputKeyboardClaim: vi.fn(),
    bindCommandField: vi.fn(),
    bindLiveInputField: vi.fn(),
    handleLiveInputBlur: vi.fn(),
    handleLiveInputFocus: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; every field the dock reads on the live-input branch is set here.
  const controller = {
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferedTerminalDraftState: { input: '', setInput: () => undefined },
    autocompleteEnabled: false,
    liveInputCapture: '',
    dictationMode: 'tap',
    handleLiveInputChange: () => undefined,
    handleLiveInputKeyPress: () => undefined,
    submitLiveInput: () => undefined,
    activeSessionTab: { type: 'terminal', id: 'term_claude' },
    activeHandle: 'term_claude',
    terminalModes: new Map(),
    canSend: true,
    canCompose: true,
    liveInputEnabled: true,
    showNativeChat: false,
    dictation: { isStarting: false, isRecording: false, isProcessing: false },
    cancelDictation: () => undefined,
    handleDictationToggle: () => undefined,
    handleDictationPressIn: () => undefined,
    handleDictationPressOut: () => undefined,
    handleSend: async () => undefined,
    isAttaching: false,
    attachImage: async () => undefined,
    attachDocument: async () => undefined,
    activeMarkdownTab: null,
    activeFileTab: null,
    activeBrowserTab: null,
    keyboardLift: 320,
    nativeChatController: { viewResolved: true, chatViewSelected: false },
    showLoadingState: false,
    ...wiring,
    ...overrides
  } as unknown as MobileSessionController
  const draw = (next: MobileSessionController) => (
    <ThemeProvider initialPreference={scheme}>
      {createElement(MobileSessionCommandDock, { controller: next })}
    </ThemeProvider>
  )
  act(() => {
    renderer = create(draw(controller), {
      // A native node for every field, so the dock's field refs see a mount.
      createNodeMock: (element: ReactElement) =>
        String(element.type) === 'TextInput' ? NATIVE_FIELD : null
    })
  })
  return {
    ...wiring,
    update: (changes: Record<string, unknown>) =>
      act(() => {
        renderer!.update(draw({ ...controller, ...changes } as MobileSessionController))
      })
  }
}

const NATIVE_FIELD = { focus: () => undefined, blur: () => undefined }

function liveField(): ReactTestInstance {
  const field = renderer!.root
    .findAll((node) => String(node.type) === 'TextInput')
    .find((node) => node.props.accessibilityLabel === 'Live terminal input')
  expect(field).toBeDefined()
  return field!
}

function borderColor(field: ReactTestInstance): unknown {
  return (field.props.style as { borderColor?: unknown }).borderColor
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as const)('the live terminal field in %s', (scheme, palette) => {
  it('hands its focus and blur to the session, so a keyboard it loses is taken back', () => {
    const wiring = renderDock(scheme)
    const field = liveField()

    act(() => field.props.onFocus())
    expect(wiring.handleLiveInputFocus).toHaveBeenCalledTimes(1)
    expect(borderColor(liveField())).toBe(palette.accent)

    act(() => liveField().props.onBlur())
    expect(wiring.handleLiveInputBlur).toHaveBeenCalledTimes(1)
    expect(borderColor(liveField())).toBe(palette.border)
  })

  it('claims an open keyboard when it comes on screen', () => {
    const wiring = renderDock(scheme)
    expect(wiring.armLiveInputKeyboardClaim).toHaveBeenCalled()
    expect(wiring.bindLiveInputField).toHaveBeenLastCalledWith(NATIVE_FIELD)
  })

  // 2026-10-14 on 0.9.141: a new terminal tab that starts Claude left the
  // keyboard up with no field focused. The claim was armed only for the live
  // field and only when the bar changed, never for the buffered command field
  // and never for a field remounted under the same bar.
  it('a new terminal tab that starts Claude keeps typed keys in the box on screen: the buffered field claims too, and again when it remounts', () => {
    const wiring = renderDock(scheme, { liveInputEnabled: false })
    const command = renderer!.root
      .findAll((node) => String(node.type) === 'TextInput')
      .find((node) => node.props.placeholder === 'Type a command…')
    expect(command).toBeDefined()
    expect(wiring.armLiveInputKeyboardClaim).toHaveBeenCalled()
    // The session's own binding still gets the field (submit and dismissal read it).
    expect(wiring.bindCommandField).toHaveBeenLastCalledWith(NATIVE_FIELD)
    expect(command!.props.cursorColor).toBe(palette.caret)
    act(() => command!.props.onFocus())
    act(() => command!.props.onBlur())
    expect(wiring.handleLiveInputFocus).toHaveBeenCalledTimes(1)
    expect(wiring.handleLiveInputBlur).toHaveBeenCalledTimes(1)

    wiring.armLiveInputKeyboardClaim.mockClear()
    // Android keys the field on autocomplete, so this is a fresh native field.
    wiring.update({ liveInputEnabled: false, autocompleteEnabled: true })
    expect(wiring.armLiveInputKeyboardClaim).toHaveBeenCalledTimes(1)
  })

  it('claims nothing while the dock is hidden behind another panel', () => {
    const wiring = renderDock(scheme, { activeBrowserTab: { id: 'page' } })
    expect(wiring.armLiveInputKeyboardClaim).not.toHaveBeenCalled()
  })

  it('draws its caret in the theme caret colour', () => {
    renderDock(scheme)
    expect(liveField().props.cursorColor).toBe(palette.caret)
  })
})
