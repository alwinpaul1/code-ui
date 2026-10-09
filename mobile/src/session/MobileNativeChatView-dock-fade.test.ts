import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { space } from '../theme/tokens'
import { DOCK_BACKDROP_FADE } from './MobileNativeChatDockBackdrop'
import { MobileNativeChatView } from './MobileNativeChatView'

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn().mockResolvedValue(undefined) }
}))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
// The system interrupting a touch is not what these tests are about; see
// use-mobile-native-chat-tail-follow.settle.test.ts for that.
vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Animated: {
    View: 'AnimatedView',
    createAnimatedComponent: (c: unknown) => c,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({}),
    sequence: () => ({})
  },
  Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  // The list sizes its render-ahead window from the screen, so the stub has to
  // report one — a Galaxy S23's 2316px at density 2.8125.
  useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 }),
  View: 'View',
  useColorScheme: () => 'light'
}))

vi.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

vi.mock('react-native-gesture-handler', () => {
  const chain = {
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain
  }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Sparkles: 'Sparkles',
  Square: 'Square'
}))

// The sheet reaches BottomDrawer, whose styles call Platform.select — absent
// from this file's react-native mock, and irrelevant to the banner tests.
vi.mock('./MobileBackgroundTasksSheet', () => ({
  MobileBackgroundTasksSheet: 'BackgroundTasksSheet'
}))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: 'RunSheet' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
// The Rewind confirm sheet reaches the same drawer; its rows are covered in
// MobileNativeChatView-rewind.test.ts.
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))

// Stand-in composer: exposes the view's `handleSend` through a pressable, which is
// the only composer behaviour these banner tests exercise.
vi.mock('./MobileNativeChatComposer', async () => {
  const React = await import('react')
  return {
    MobileNativeChatComposer: (props: {
      onSend: (text: string) => Promise<boolean>
      disabled?: boolean
      placeholder?: string
    }) =>
      React.createElement('Composer', {
        ...props,
        accessibilityLabel: 'Send message',
        onPress: () => props.onSend('hi')
      })
  }
})

// 2026-10-09 review: the dock's ground fades in over the 28 dp above the dock
// (DOCK_BACKDROP_FADE), but the list's end spacer and the jump-to-latest
// button cleared only the dock itself. At rest, pinned to the tail, the last
// line of the newest reply sat about 16 dp above the dock, under a veil about
// 43% opaque, and the bottom 16 dp of the 40 dp button sat under the fade.

const DOCK = 180

describe.each(['light', 'dark'] as const)('MobileNativeChatView in a %s session, at the dock\'s fade', (scheme) => {
  let renderer: ReturnType<typeof create> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(): Promise<void> {
    const messages: NativeChatMessage[] = [
      { id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'hi' }], timestamp: 0, source: 'transcript' },
      { id: 'a1', role: 'assistant', blocks: [{ type: 'text', text: 'Done.' }], timestamp: 0, source: 'transcript' }
    ]
    await act(async () => {
      renderer = create(
        createElement(ThemeProvider, {
          initialPreference: scheme,
          // oxlint-disable-next-line react/no-children-prop -- a .ts file has no JSX, and ThemeProvider types children as required, so createElement only type-checks with them in props.
          children: createElement(MobileNativeChatView, {
            messages,
            folded: messages,
            status: 'ready',
            streaming: null,
            onSend: vi.fn().mockResolvedValue(true),
            sendSurfaceId: 'tab-a',
            getSendCompletionGeneration: () => 0,
            getComposerEditGeneration: () => 0,
            pending: [],
            composerText: '',
            onComposerTextChange: vi.fn()
          })
        })
      )
    })
    const dock = renderer!.root.find((node) => node.props.testID === 'native-chat-dock')
    await act(async () => dock.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 384, height: DOCK } } }))
  }

  /** The spacer at the list's end, read off the header element itself
   *  (FlashList is a stub here, so the header is never mounted). */
  function spacerHeight(): unknown {
    const list = renderer!.root.find((node) => String(node.type) === 'FlashList')
    const visit = (element: unknown): unknown => {
      if (!element || typeof element !== 'object') {
        return undefined
      }
      const props = (element as { props?: { testID?: string; style?: { height?: unknown }; children?: unknown } }).props
      if (props?.testID === 'native-chat-dock-spacer') {
        return props.style?.height
      }
      for (const child of ([] as unknown[]).concat(props?.children ?? [])) {
        const found = visit(child)
        if (found !== undefined) {
          return found
        }
      }
      return undefined
    }
    return visit(list.props.ListHeaderComponent)
  }

  it('keeps the newest line clear of the fade when pinned to the tail', async () => {
    await render()
    // The header is the visual bottom of the inverted list: at the tail the
    // newest row sits on top of this spacer.
    expect(spacerHeight()).toBe(DOCK + DOCK_BACKDROP_FADE)
  })

  it('keeps the jump-to-latest button clear of the fade', async () => {
    await render()
    const jump = renderer!.root.find(
      (node) => typeof node.type === 'function' && node.type.name === 'MobileNativeChatJumpToLatest'
    )
    const fab = Object.assign({}, ...[jump.props.styles.fab].flat(Infinity).filter(Boolean)) as { bottom: number }
    // space.md: the button's own gap above whatever it clears.
    expect(fab.bottom).toBe(DOCK + DOCK_BACKDROP_FADE + space.md)
  })
})
