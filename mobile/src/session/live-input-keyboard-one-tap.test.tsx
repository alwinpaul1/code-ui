import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Getting a dismissed keyboard back with live input on is one tap: on the live field itself.
 *
 * A tap on a program that tracks the mouse (Claude Code) is a click for that program and
 * deliberately does not open the keyboard (cc4dfe216, the user's report; `terminal-webview-tap-
 * routing.test.ts`, "sends a tap on a mouse-tracking program (%s) as a click and does not open the
 * keyboard"). That commit left the bar as the way back, and in live mode the bar IS the live field
 * ("Tap to type"). A review read the terminal-tap path alone and concluded it took two taps (live
 * input off, then on). This pins the path that makes it one: with the keyboard down the field is
 * still on screen, editable, raises the keyboard when focused, and is the field the dismissal
 * blurred (`terminal-keyboard-dismiss.test.ts`), so the tap starts a fresh focus. Whether the IME
 * actually rises on that tap is native behaviour; that part is for the phone.
 */

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
// The rows beside the field draw their own controls; this is about the field.
vi.mock('./MobileSessionAccessoryStrip', () => ({ MobileSessionAccessoryStrip: () => null }))
vi.mock('./MobileTerminalInputActions', () => ({ MobileTerminalInputActions: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { MobileSessionCommandDock } from './MobileSessionCommandDock'
import type { MobileSessionController } from './use-mobile-session-controller'

/** What the native TextInput hands its ref: the object the session's `liveInputRef` holds. */
const NATIVE_LIVE_FIELD = { focus: () => undefined, blur: () => undefined }

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function renderDock(keyboardLift: number) {
  const bindLiveInputField = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; every field the dock reads on the live-input branch is set here.
  const controller = {
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferedTerminalDraftState: { input: '', setInput: () => undefined },
    autocompleteEnabled: false,
    liveInputCapture: '',
    dictationMode: 'tap',
    bindCommandField: () => undefined,
    handleLiveInputChange: () => undefined,
    handleLiveInputKeyPress: () => undefined,
    bindLiveInputField,
    submitLiveInput: () => undefined,
    activeSessionTab: { type: 'terminal', id: 'term_claude' },
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
    keyboardLift,
    nativeChatController: { viewResolved: true, chatViewSelected: false },
    showLoadingState: false
  } as unknown as MobileSessionController
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="dark">
        {createElement(MobileSessionCommandDock, { controller })}
      </ThemeProvider>,
      {
        createNodeMock: (element: ReactElement<{ accessibilityLabel?: string }>) =>
          element.props.accessibilityLabel === 'Live terminal input' ? NATIVE_LIVE_FIELD : null
      }
    )
  })
  return { bindLiveInputField }
}

function liveField(): ReactTestInstance | undefined {
  return renderer!.root
    .findAll((node) => String(node.type) === 'TextInput')
    .find((node) => node.props.accessibilityLabel === 'Live terminal input')
}

/** Whether anything around the node stops a touch from reaching it. */
function touchBlockedAbove(node: ReactTestInstance): boolean {
  for (let at: ReactTestInstance | null = node.parent; at; at = at.parent) {
    if (at.props.pointerEvents === 'none' || at.props.pointerEvents === 'box-only') {
      return true
    }
  }
  return false
}

describe('a dismissed keyboard with live input on', () => {
  it('shows the live field to tap while the keyboard is down, so one tap brings it back', () => {
    // keyboardLift 0: the keyboard is down, and the dock sits at the bottom of the screen.
    const { bindLiveInputField } = renderDock(0)

    const field = liveField()
    expect(field).toBeDefined()
    expect(field!.props.editable).toBe(true)
    expect(field!.props.showSoftInputOnFocus).toBe(true)
    expect(field!.props.placeholder).toBe('Tap to type')
    expect(touchBlockedAbove(field!)).toBe(false)
    // The field on screen is the one the dismissal blurred, so the tap is a fresh focus.
    expect(bindLiveInputField).toHaveBeenLastCalledWith(NATIVE_LIVE_FIELD)
  })
})
