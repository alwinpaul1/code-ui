import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'

// Reported twice from the phone (2026-09-26, and again 2026-09-27 after the
// slide was fixed): the + sheet opens slowly. The second recording (Galaxy S23
// Ultra, Android 16, keyboard up, a busy chat) read at the recorder's own
// 120 Hz frame times, not the 10 fps contact sheets:
//
//   6.003 s  finger up on + (the show-taps spot starts to fade)
//   6.065 s  first dimmed frame: the sheet's Modal window is on screen
//   6.131 s  the keyboard starts to slide away
//   6.201 s  "Add context" appears, already at its resting row
//   6.289 s  the Permission row appears; the sheet is fully visible
//
// The sheet never moved once it could be seen: it had opened, at rest, under
// the keyboard, and the keyboard uncovered it row by row. Nothing asked the
// keyboard to go. It left only because the Modal's Dialog window took focus
// (ReactModalHostView clears FLAG_NOT_FOCUSABLE after show()), and that came
// 128 ms after the finger lifted. The same recording holds the finger on the
// + for about 80 ms (spot drawn 5.920, fading from 6.003), all of it before
// anything could happen, because Pressable acts on release.
//
// So the + hands the keyboard back itself, and on touch-down: the keyboard
// starts leaving while the sheet's window is being built, not after.

const keyboardDismiss = vi.hoisted(() => vi.fn())

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: ({ data, renderItem, keyExtractor, ...props }: {
      data: readonly unknown[]
      renderItem: (info: { item: unknown; index: number }) => unknown
      keyExtractor: (item: unknown) => string
    }) =>
      React.createElement(
        'FlatList',
        props,
        data.map((item, index) =>
          React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem({ item, index }) as React.ReactNode)
        )
      ),
    Image: 'Image',
    Keyboard: {
      dismiss: keyboardDismiss,
      isVisible: () => true,
      addListener: () => ({ remove: () => {} })
    },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: unknown }) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Camera: 'Camera',
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
  Plus: 'Plus',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Square: 'Square',
  X: 'X',
  Zap: 'Zap'
}))

// The drawer itself is not under test here: it mounts its native Modal in
// the commit that makes it visible, so "the sheet is up" is "a visible
// BottomDrawer holds the Photos card".
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, onClose, children }: { visible: boolean; onClose: () => void; children?: unknown }) =>
      visible ? React.createElement('BottomDrawer', { visible, onClose }, children as React.ReactNode) : null
  }
})

type Scheme = 'light' | 'dark'
type ComposerProps = ComponentProps<typeof MobileNativeChatComposer>

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  keyboardDismiss.mockReset()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function mountComposer(scheme: Scheme, props: Partial<ComposerProps>): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileNativeChatComposer, {
          value: 'The message from general purpose agent',
          onChangeText: () => {},
          onSend: async () => true,
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          agent: 'claude',
          ...props
        })}
      </ThemeProvider>,
      { createNodeMock: () => ({ focus: () => {}, blur: () => {}, isFocused: () => true }) }
    )
  })
}

function plus(label: string): ReactTestInstance {
  return renderer!.root.find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label)
}

function sheetIsUp(): boolean {
  return renderer!.root
    .findAll((node) => node.type === 'BottomDrawer')
    .some((drawer) => drawer.findAll((node) => node.props.accessibilityLabel === 'Photos').length > 0)
}

const withSheet: Partial<ComposerProps> = {
  onCaptureImage: () => {},
  onAttachImage: () => {},
  onAttachFile: () => {}
}

describe.each(['light', 'dark'] as const)('the + in %s mode, with the keyboard up', (scheme) => {
  it('sends the keyboard away and opens the sheet as the finger lands', async () => {
    await mountComposer(scheme, withSheet)
    let sheetUpWhenKeyboardAsked: boolean | null = null
    keyboardDismiss.mockImplementation(() => {
      sheetUpWhenKeyboardAsked = sheetIsUp()
    })

    await act(async () => (plus('Add to chat').props.onPressIn as (() => void) | undefined)?.())

    expect(keyboardDismiss, 'the keyboard was left for the Modal to take away, 128 ms after the tap').toHaveBeenCalledTimes(1)
    // Asked before the sheet's window exists, not left to the window's focus.
    expect(sheetUpWhenKeyboardAsked).toBe(false)
    expect(sheetIsUp(), 'the sheet waited for the finger to lift').toBe(true)
  })

  it('opens once for the whole press: the release that follows adds nothing', async () => {
    await mountComposer(scheme, withSheet)
    const button = plus('Add to chat')
    await act(async () => (button.props.onPressIn as (() => void) | undefined)?.())
    await act(async () => (plus('Add to chat').props.onPress as () => void)())

    expect(sheetIsUp()).toBe(true)
    expect(renderer!.root.findAll((node) => node.type === 'BottomDrawer')).toHaveLength(1)
  })

  it('still opens clear of the keyboard when activated without a touch (TalkBack)', async () => {
    // A screen reader's double tap is a click: Pressable calls onPress with
    // no press-in before it.
    await mountComposer(scheme, withSheet)
    await act(async () => (plus('Add to chat').props.onPress as () => void)())

    expect(keyboardDismiss).toHaveBeenCalledTimes(1)
    expect(sheetIsUp()).toBe(true)
  })
})

describe('the + with no sheet to open (Photos only)', () => {
  it('opens the photo picker on release only, and leaves the keyboard alone', async () => {
    // The picker takes the whole screen and the keyboard with it; a touch
    // that lands and slides away must still be able to back out of it.
    const onAttachImage = vi.fn()
    await mountComposer('light', { onAttachImage })
    const button = plus('Attach image')

    await act(async () => (button.props.onPressIn as (() => void) | undefined)?.())
    expect(onAttachImage).not.toHaveBeenCalled()

    await act(async () => (plus('Attach image').props.onPress as () => void)())
    expect(onAttachImage).toHaveBeenCalledTimes(1)
    expect(keyboardDismiss).not.toHaveBeenCalled()
  })
})
