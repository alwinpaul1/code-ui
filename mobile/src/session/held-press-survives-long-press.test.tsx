/**
 * Orca #24277: on the OTA page a held press died about 500 ms in, because the WebView's own
 * long-press (selection, then `contextmenu`) took the touch. react-native-web keeps a held press
 * through that only when the control declares `onLongPress`, and the chat mic's swapped icon must
 * not be the touch target (its removal on press would send touchend to a detached node).
 *
 * Native is unchanged by all of it: a no-op long press fires nothing, so these assert the
 * declarations and that the no-op does not cancel the hold.
 *
 * Verified against Orca v1.4.220's react-native-web build; the page's `user-select: none` rule
 * lives in upstream's page bundler, which this fork does not carry.
 */
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { MobileTerminalInputActions } from './MobileTerminalInputActions'
import { mayTerminateBrowserPan } from '../browser/browser-pan-termination'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    Image: 'Image',
    Keyboard: {
      dismiss: vi.fn(),
      isVisible: () => true,
      addListener: () => ({ remove: () => {} })
    },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light'
  }
})
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
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', { visible }, children) : null
  }
})
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/VoiceLevelBars', () => ({ VoiceLevelBars: () => null }))

const isHost = (node: ReactTestInstance, tag: string): boolean => (node.type as unknown) === tag

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

const idleDictation = {
  isStarting: false,
  isRecording: false,
  isProcessing: false,
  level: undefined
} as unknown as Parameters<typeof MobileTerminalInputActions>[0]['dictation']

async function mount(element: ReactNode, scheme: 'light' | 'dark'): Promise<void> {
  await act(async () => {
    renderer = create(
      createElement(ThemeProvider, { initialPreference: scheme, children: element })
    )
  })
}

function pressableLabelled(label: RegExp): ReactTestInstance {
  return renderer!.root.find(
    (node) =>
      isHost(node, 'Pressable') &&
      typeof node.props.accessibilityLabel === 'string' &&
      label.test(node.props.accessibilityLabel as string)
  )
}

describe('the chat mic in hold mode', () => {
  it.each(['light', 'dark'] as const)(
    'declares onLongPress and keeps its icons out of the touch target, in %s',
    async (scheme) => {
      for (const micActive of [false, true]) {
        await mount(
          createElement(MobileNativeChatComposer, {
            value: '',
            onChangeText: () => {},
            onSend: async () => true,
            sendSurfaceId: 'tab-a',
            getSendCompletionGeneration: () => 0,
            getComposerEditGeneration: () => 0,
            agent: 'claude',
            filePaths: [],
            dictationMode: 'hold',
            onMicPress: () => {},
            onMicPressIn: () => {},
            onMicPressOut: () => {},
            micActive
          }),
          scheme
        )
        const mic = pressableLabelled(/dictat/i)
        expect(typeof mic.props.onLongPress).toBe('function')
        const icon = mic.find((node) => isHost(node, micActive ? 'Square' : 'Mic'))
        expect(icon.props.pointerEvents).toBe('none')
        act(() => renderer?.unmount())
      }
    }
  )

  it('leaves toggle mode without a long-press handler', async () => {
    await mount(
      createElement(MobileNativeChatComposer, {
        value: '',
        onChangeText: () => {},
        onSend: async () => true,
        sendSurfaceId: 'tab-a',
        getSendCompletionGeneration: () => 0,
        getComposerEditGeneration: () => 0,
        agent: 'claude',
        filePaths: [],
        dictationMode: 'toggle',
        onMicPress: () => {}
      }),
      'light'
    )
    expect(pressableLabelled(/dictat/i).props.onLongPress).toBeUndefined()
  })
})

describe('the terminal dock mic', () => {
  it.each(['light', 'dark'] as const)(
    'declares onLongPress in hold mode, and the no-op does not cancel the hold, in %s',
    async (scheme) => {
      const cancel = vi.fn()
      await mount(
        createElement(MobileTerminalInputActions, {
          canSend: true,
          isAttaching: false,
          dictation: idleDictation,
          dictationMode: 'hold',
          onAttachImage: () => {},
          onAttachFile: () => {},
          onDictationToggle: () => {},
          onDictationPressIn: () => {},
          onDictationPressOut: () => {},
          onDictationCancel: cancel
        }),
        scheme
      )
      const mic = pressableLabelled(/dictat|voice/i)
      expect(typeof mic.props.onLongPress).toBe('function')
      act(() => (mic.props.onLongPress as () => void)())
      expect(cancel).not.toHaveBeenCalled()
    }
  )
})

describe('the browser pane pan responder', () => {
  it('refuses to yield to the WebView long-press contextmenu', () => {
    expect(mayTerminateBrowserPan({ nativeEvent: { type: 'contextmenu' } } as never)).toBe(false)
  })

  it('still yields to every other touch, native ones carrying no type included', () => {
    expect(mayTerminateBrowserPan({ nativeEvent: {} } as never)).toBe(true)
    expect(mayTerminateBrowserPan({ nativeEvent: { type: 'touchcancel' } } as never)).toBe(true)
  })
})
