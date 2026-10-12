import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'

// Reported from the phone (2026-10-12, 0.9.130): on a Claude chat tab the
// Samsung keyboard was up, the composer showed its placeholder "Reply, @files,
// /commands" with no cursor, and nothing typed appeared in the box. The
// keyboard was up while the composer's field did not hold focus. The day
// before, the same symptom on a new tab was a held frame freezing the field
// (new-tab-composer-keeps-typed-keys.test.tsx); this is the other half of the
// class: a keyboard left up with no field focused.
//
// Android keeps the keyboard up when the focused field leaves without a blur
// from JavaScript, and a fresh field mounted under it is not focused. So
// whenever the composer comes on screen (its screen reports focus, or the app
// comes back) it claims an open keyboard that no field holds once it has
// stayed up for COMPOSER_KEYBOARD_SETTLE_MS, so a keyboard still leaving after
// a dismiss is not brought back (use-composer-keeps-keyboard.ts). These cases
// drive the composer itself; the
// keyboard is the height the screen reports, and React Native's focus record
// is mocked.

const rn = vi.hoisted(() => ({
  appStateListeners: [] as ((state: string) => void)[]
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      rn.appStateListeners.push(listener)
      return {
        remove: () => {
          rn.appStateListeners = rn.appStateListeners.filter((entry) => entry !== listener)
        }
      }
    }
  },
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
// The real seam, over the AppState above (vitest.setup.ts stubs it for everyone else).
vi.mock('./use-app-returns', async () => await vi.importActual('./use-app-returns'))
vi.mock('react-native-svg',() => ({ default: () => null, Circle: () => null }))
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

const focus = vi.hoisted(() => ({
  /** React Native's record: some text field holds focus. */
  someFieldFocused: false,
  /** The screen is on top when the composer mounts (useFocusEffect reports it). */
  shownOnMount: true,
  /** The navigation focus reporter the composer registered, if any. */
  screen: null as ((focused: boolean) => void) | null
}))
vi.mock('./text-field-focus', () => ({
  anyTextFieldFocused: () => focus.someFieldFocused
}))
vi.mock('./use-native-chat-screen-focus', async () => {
  const { useEffect } = await import('react')
  return {
    useNativeChatScreenFocus: (onFocusChange: (focused: boolean) => void) => {
      useEffect(() => {
        focus.screen = onFocusChange
        if (focus.shownOnMount) {
          onFocusChange(true)
        }
      }, [onFocusChange])
    }
  }
})

import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { COMPOSER_KEYBOARD_CLAIM_MS, COMPOSER_KEYBOARD_SETTLE_MS } from './use-composer-keeps-keyboard'

// focus() writes React Native's record at once, as TextInputState.focusTextInput does.
const field = {
  focus: vi.fn(() => {
    focus.someFieldFocused = true
  }),
  blur: vi.fn(),
  isFocused: () => focus.someFieldFocused
}

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  field.focus.mockClear()
  focus.someFieldFocused = false
  focus.shownOnMount = true
  focus.screen = null
  rn.appStateListeners = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function composer(keyboardUp: boolean): React.JSX.Element {
  return (
    <ThemeProvider initialPreference="dark">
      <MobileNativeChatComposer
        value=""
        onChangeText={vi.fn()}
        onSend={vi.fn().mockResolvedValue(true)}
        sendSurfaceId="gloria"
        getSendCompletionGeneration={() => 0}
        getComposerEditGeneration={() => 0}
        keyboardUp={keyboardUp}
      />
    </ThemeProvider>
  )
}

function mount(keyboardUp: boolean): void {
  act(() => {
    renderer = create(composer(keyboardUp), {
      createNodeMock: (element) => ((element.type as unknown) === 'TextInput' ? field : null)
    })
  })
}

function keyboard(up: boolean): void {
  act(() => {
    renderer!.update(composer(up))
  })
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

const appState = (state: string) => act(() => rn.appStateListeners.forEach((listener) => listener(state)))

describe('a keyboard left up over the chat composer', () => {
  it('keeps typed keys in the box after the composer remounts under an open keyboard', () => {
    // The overlay yielded and came back, or the tab body swapped: a fresh
    // field under a keyboard nobody holds.
    mount(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).toHaveBeenCalledTimes(1)
    // The one line left behind for a claim nobody watched.
    expect(console.warn).toHaveBeenCalledWith('[composer] claimed an open keyboard no field held')
  })

  it('keeps typed keys in the box after the keyboard reports its height just after the composer mounts', () => {
    mount(false)
    keyboard(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('keeps typed keys in the box after returning from another route with the keyboard still up', () => {
    mount(false)
    wait(COMPOSER_KEYBOARD_CLAIM_MS + 1)
    // Files or review is pushed; the field leaves the window while the
    // keyboard stays, and the screen comes back to the top with it still up.
    act(() => focus.screen!(false))
    keyboard(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
    act(() => focus.screen!(true))
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('keeps typed keys in the box after the app comes back with the keyboard restored', () => {
    mount(false)
    wait(COMPOSER_KEYBOARD_CLAIM_MS + 1)
    appState('background')
    appState('active')
    // The system restores the IME a moment after the activity resumes.
    wait(300)
    keyboard(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).toHaveBeenCalledTimes(1)
  })
})

describe('the claim never takes a keyboard from someone else', () => {
  it('leaves the keyboard with a field that holds focus (a question card, a sheet)', () => {
    focus.someFieldFocused = true
    mount(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('does not bring back a keyboard that was dismissed just before the composer mounted', () => {
    // A terminal send to an agent dismisses the keyboard, and the tab flips to
    // chat while it is still leaving: its height clears only on keyboardDidHide.
    mount(true)
    wait(200)
    keyboard(false)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('never raises a keyboard that is down, on mount, on a return or when the app comes back', () => {
    mount(false)
    act(() => focus.screen!(false))
    act(() => focus.screen!(true))
    appState('active')
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('leaves a keyboard raised long after the composer came on screen to whatever raised it', () => {
    mount(false)
    wait(COMPOSER_KEYBOARD_CLAIM_MS + 1)
    keyboard(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('does not take the keyboard while another route covers the chat', () => {
    mount(false)
    act(() => focus.screen!(false))
    appState('active')
    keyboard(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('claims nothing for a composer mounted under a covered screen, until it is shown', () => {
    // A new tab settles into chat while agent history is pushed over it.
    focus.shownOnMount = false
    mount(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
    act(() => focus.screen!(true))
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('claims once: a keyboard dismissed and raised again in the window is the user’s', () => {
    mount(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).toHaveBeenCalledTimes(1)
    // Keyboard.dismiss blurs the field; something else raises the keyboard.
    focus.someFieldFocused = false
    keyboard(false)
    keyboard(true)
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).toHaveBeenCalledTimes(1)
  })

  it('degenerate: a field not mounted yet is not an error', () => {
    act(() => {
      renderer = create(composer(true), { createNodeMock: () => null })
    })
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('degenerate: unmounting during the settle claims nothing', () => {
    mount(true)
    act(() => renderer!.unmount())
    renderer = null
    wait(COMPOSER_KEYBOARD_SETTLE_MS)
    expect(field.focus).not.toHaveBeenCalled()
  })
})
