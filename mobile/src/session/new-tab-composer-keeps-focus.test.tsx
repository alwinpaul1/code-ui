import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { CHAT_FRAME_HOLD_MS } from './use-native-chat-frame'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

// Reported from the phone (2026-10-12, 0.9.130), and confirmed: "it happens
// when I open a new tab from the phone". The keyboard is up, the composer shows
// "Reply, @files, /commands" with no cursor, and keys go nowhere.
//
// The 2026-10-11 fix (new-tab-composer-keeps-typed-keys.test.tsx) kept the
// composer's value live through the overlay's hold, and only the hold: it
// checks that the composer is not remounted INSIDE CHAT_FRAME_HOLD_MS. A new
// agent tab is not a chat tab the whole time it settles. Until the agent is
// identified the tab is neither shown as chat nor eligible, which reads as a
// blink, and the hold bridges it for CHAT_FRAME_HOLD_MS at most. A blink that
// outlasts the hold yields to the terminal (the overlay renders nothing, and
// the composer unmounts), and the chat comes back with a fresh composer under
// the keyboard the user raised in the old one. The fresh field is not focused,
// so the keyboard types into nothing. The overlay also drops the composer the
// same way for the tab body's own swaps above it.
//
// The composer now claims an open keyboard no field holds when it comes on
// screen (use-composer-keeps-keyboard.ts). This drives the overlay through a
// new tab's settling with the real composer inside the chat view.

const keyboardState = vi.hoisted(() => ({ someFieldFocused: false }))

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
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
vi.mock('./text-field-focus', () => ({ anyTextFieldFocused: () => keyboardState.someFieldFocused }))
// The chat view, reduced to the real composer it docks, wired as the view wires
// it (chat-view-tells-composer-keyboard-up.test.ts pins keyboardUp's wiring).
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  const { MobileNativeChatComposer } = await import('./MobileNativeChatComposer')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) =>
      h(MobileNativeChatComposer, {
        value: props.composerText as string,
        onChangeText: props.onComposerTextChange as (text: string) => void,
        focusRequest: props.composerFocusRequest as number,
        keyboardUp: (props.keyboardInset as number) > 0,
        onSend: async () => true,
        sendSurfaceId: props.sendSurfaceId as string,
        getSendCompletionGeneration: () => 0,
        getComposerEditGeneration: () => 0
      })
  }
})

type Moment = {
  typed: string
  /** The tab is a chat tab: the agent has been identified. */
  chat: boolean
  keyboard: number
}

function overlay(moment: Moment): React.JSX.Element {
  const controller = {
    showNativeChat: moment.chat,
    activeChatEligible: moment.chat,
    chatViewSelected: false,
    viewResolved: true,
    terminalPeekActive: false,
    // A new agent tab writes no transcript before its first prompt.
    nativeChatSession: { messages: [], status: 'awaiting-transcript', transcriptLoading: true },
    nativeChatAgent: 'claude',
    nativeChatAgentWorking: false,
    nativeChatStreamLive: false,
    nativeChatStreamScopeKey: 'new-tab',
    chatPending: [],
    nativeChatSessionIdentity: null,
    chatImagePreviewsByMessageId: {},
    chatComposerText: moment.typed,
    setChatComposerText: vi.fn(),
    composerFocusRequest: 0
  } as unknown as MobileNativeChatController
  return (
    <ThemeProvider initialPreference="dark">
      {createElement(MobileNativeChatOverlay, {
      controller,
      hasTerminalUnderneath: true,
      onOpenFile: vi.fn(),
      hostAllowsRewind: true,
      images: {} as never,
      onMicPress: vi.fn(),
      micActive: false,
      dictationMode: 'toggle',
      onMicPressIn: vi.fn(),
      onMicPressOut: vi.fn(),
      inputLockReason: null,
      sendErrorMessage: null,
      onClearSendError: vi.fn(),
      sendSurfaceId: 'new-tab',
      getSendCompletionGeneration: () => 0,
      keyboardInset: moment.keyboard
      })}
    </ThemeProvider>
  )
}

/** One native field per mounted TextInput; React Native's focus record follows focus() and unmount. */
type Field = { focus: () => void; blur: () => void; focused: boolean }
let fields: Field[] = []
function nodeMock(element: { type: unknown }): Field | null {
  if (element.type !== 'TextInput') {
    return null
  }
  const field: Field = {
    focused: false,
    focus: () => {
      field.focused = true
      keyboardState.someFieldFocused = true
    },
    blur: () => {
      field.focused = false
      keyboardState.someFieldFocused = false
    }
  }
  fields.push(field)
  return field
}

let root: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  fields = []
  keyboardState.someFieldFocused = false
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

const show = (moment: Moment) =>
  act(() => {
    root!.update(overlay(moment))
  })
const composers = () => root!.root.findAll((node) => (node.type as unknown) === 'TextInput')

describe('opening a new agent tab from the phone', () => {
  it('keeps typed keys in the box after the new tab settles into chat under the open keyboard', () => {
    act(() => {
      root = create(overlay({ typed: '', chat: true, keyboard: 0 }), { createNodeMock: nodeMock })
    })
    // The user taps the empty composer: it takes focus and raises the keyboard.
    act(() => fields[0]!.focus())
    show({ typed: '', chat: true, keyboard: 320 })
    // The agent is still being identified: the tab blinks out of chat for
    // longer than the hold, and the overlay yields to the terminal.
    show({ typed: '', chat: false, keyboard: 320 })
    act(() => {
      vi.advanceTimersByTime(CHAT_FRAME_HOLD_MS + 100)
    })
    show({ typed: '', chat: false, keyboard: 320 })
    expect(composers()).toHaveLength(0)
    // React Native blurs a focused field that unmounts; Android lost that blur
    // on the device, and the keyboard stayed.
    keyboardState.someFieldFocused = false
    // The agent is identified: chat again, with a fresh composer.
    show({ typed: '', chat: true, keyboard: 320 })
    expect(composers()).toHaveLength(1)
    const fresh = fields[fields.length - 1]!
    expect(fresh).not.toBe(fields[0])
    expect(fresh.focused).toBe(true)
  })

  it('does not raise the keyboard on a new tab the user has not typed into', () => {
    act(() => {
      root = create(overlay({ typed: '', chat: false, keyboard: 0 }), { createNodeMock: nodeMock })
    })
    show({ typed: '', chat: true, keyboard: 0 })
    expect(fields.some((field) => field.focused)).toBe(false)
  })
})
