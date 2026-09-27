import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The same defect as the bottom sheets (bottom-drawer-dismisses-keyboard-on-open.test.tsx),
// in the three full-window Modals the chat opens with nothing to type:
//   the tool detail sheet  a tool row in the transcript
//   the image preview      a photo chip over the composer, a queued photo, a transcript image
//   the markup editor      a photo chip's pencil
// Each is a Dialog window below the keyboard's window, so opened while the
// composer's keyboard is up it sat under the keyboard until its window took
// focus and the keyboard finally left. Each now sends the keyboard away in
// the commit that opens it.

const keyboardDismiss = vi.hoisted(() => vi.fn())

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Image: { getSize: vi.fn() },
  Keyboard: { dismiss: keyboardDismiss, addListener: () => ({ remove: () => {} }), metrics: () => null },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StatusBar: 'StatusBar',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 956 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: { Pan: () => chain, Native: () => chain, Simultaneous: () => chain, Pinch: () => chain, Tap: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('react-native-reanimated', () => ({
  default: {
    View: 'AnimatedView',
    ScrollView: 'AnimatedScrollView',
    createAnimatedComponent: (component: unknown) => component
  },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: () => () => {},
  withSpring: (to: number) => to,
  withTiming: (to: number, _config?: unknown, done?: (finished: boolean) => void) => {
    done?.(true)
    return to
  },
  runOnJS:
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
  interpolate: () => 0,
  Extrapolation: { CLAMP: 'clamp' }
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 24, left: 0, right: 0 })
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('./ZoomableImage', () => ({ ZoomableImage: 'ZoomableImage' }))
// The editor reads the photo's size before it draws; the pencil's open is what is under test.
vi.mock('./markup-image-size', () => ({ loadMarkupImageSize: () => new Promise(() => {}) }))

import { ThemeProvider } from '../theme/theme-context'
import { openImageMarkup, resetImageMarkupForTests } from '../session/image-markup-store'
import { openImagePreview, resetImagePreviewForTests } from '../session/image-preview-store'
import { DraggableDetailSheet } from './DraggableDetailSheet'
import { ImagePreviewModal } from './ImagePreviewModal'
import { MobileImageMarkupEditor } from './MobileImageMarkupEditor'

type Scheme = 'light' | 'dark'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  keyboardDismiss.mockReset()
  resetImagePreviewForTests()
  resetImageMarkupForTests()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function modalUp(): boolean {
  return renderer!.root.findAll((node) => (node.type as unknown) === 'Modal').length > 0
}

/** Mounts `element` closed, opens it with `open`, and returns how many times
 *  the keyboard was asked to go, and whether the Modal was in the tree then. */
async function openAndCount(element: React.JSX.Element, open: () => void): Promise<{ asked: number; modalWhenAsked: boolean | null }> {
  await act(async () => {
    renderer = create(element)
  })
  expect(modalUp(), 'the surface was already open before the tap').toBe(false)
  keyboardDismiss.mockClear()
  let modalWhenAsked: boolean | null = null
  keyboardDismiss.mockImplementation(() => {
    modalWhenAsked = modalUp()
  })
  await act(async () => open())
  expect(modalUp(), 'the surface did not open').toBe(true)
  return { asked: keyboardDismiss.mock.calls.length, modalWhenAsked }
}

function detailSheet(scheme: Scheme, visible: boolean): React.JSX.Element {
  return (
    <ThemeProvider initialPreference={scheme}>
      <DraggableDetailSheet visible={visible} onClose={() => {}} header={null}>
        {null}
      </DraggableDetailSheet>
    </ThemeProvider>
  )
}

describe.each(['light', 'dark'] as const)('full-window surfaces over the chat keyboard, in %s mode', (scheme) => {
  it('the tool detail sheet sends the keyboard away as it opens', async () => {
    const { asked, modalWhenAsked } = await openAndCount(detailSheet(scheme, false), () =>
      renderer!.update(detailSheet(scheme, true))
    )
    expect(asked).toBe(1)
    expect(modalWhenAsked).toBe(true)
  })

  it('the image preview sends the keyboard away as it opens', async () => {
    const { asked, modalWhenAsked } = await openAndCount(
      <ThemeProvider initialPreference={scheme}>
        <ImagePreviewModal />
      </ThemeProvider>,
      () => openImagePreview('file:///cache/photo.jpg', 'Photo')
    )
    expect(asked).toBe(1)
    expect(modalWhenAsked).toBe(true)
  })

  it('the markup editor sends the keyboard away as it opens', async () => {
    const { asked, modalWhenAsked } = await openAndCount(
      <ThemeProvider initialPreference={scheme}>
        <MobileImageMarkupEditor />
      </ThemeProvider>,
      () => openImageMarkup('file:///cache/photo.jpg', { onDone: () => {} })
    )
    expect(asked).toBe(1)
    expect(modalWhenAsked).toBe(true)
  })

  it('the tool detail sheet asks once per open, not on each render while open', async () => {
    await openAndCount(detailSheet(scheme, false), () => renderer!.update(detailSheet(scheme, true)))
    keyboardDismiss.mockClear()
    await act(async () => renderer!.update(detailSheet(scheme, true)))
    expect(keyboardDismiss).not.toHaveBeenCalled()
  })
})
