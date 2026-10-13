import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import {
  openImagePreview,
  peekImagePreview,
  resetImagePreviewForTests
} from '../session/image-preview-store'
import { ImagePreviewModal } from './ImagePreviewModal'

// The user, 2026-10-13 on 0.9.132 (recording rec4.mp4): tap an agent image,
// pinch to zoom, and within a second the viewer is gone and the chat is back,
// twice. The viewer's single tap closed it, and gesture-handler's Tap has no
// movement limit by default (TapGestureHandler.kt, maxDist MAX_VALUE_IGNORE)
// and counts a two-finger touch, so a pinch released inside 500 ms WAS a
// single tap, run alongside the pinch. The viewer now closes only on the X,
// Back, or a deliberate swipe down at 1x.
//
// The gestures run on the UI thread on a phone. Here every gesture-handler
// builder records its callbacks and config, the reanimated stand-in runs the
// worklets synchronously, and the test plays the callbacks gesture-handler
// would fire for each touch.

type Recorded = {
  kind: string
  handlers: Record<string, (...args: unknown[]) => void>
  config: Record<string, unknown[]>
  children?: Recorded[]
}

vi.mock('react-native-gesture-handler', async () => {
  const { createElement } = await import('react')
  const HANDLERS = new Set(['onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize'])
  const builder = (kind: string, children?: Recorded[]) => {
    const record: Recorded = { kind, handlers: {}, config: {}, children }
    const proxy: unknown = new Proxy(record, {
      get(target, prop) {
        if (prop in target) {
          return target[prop as keyof Recorded]
        }
        return (...args: unknown[]) => {
          if (HANDLERS.has(String(prop))) {
            target.handlers[String(prop)] = args[0] as (...a: unknown[]) => void
          } else {
            target.config[String(prop)] = args
          }
          return proxy
        }
      }
    })
    return proxy
  }
  const composed = (kind: string) => (...children: Recorded[]) => builder(kind, children)
  return {
    Gesture: {
      Pinch: () => builder('Pinch'),
      Pan: () => builder('Pan'),
      Tap: () => builder('Tap'),
      Simultaneous: composed('Simultaneous'),
      Exclusive: composed('Exclusive'),
      Race: composed('Race')
    },
    GestureDetector: (props: Record<string, unknown>) => createElement('GestureDetector', props),
    GestureHandlerRootView: (props: Record<string, unknown>) => createElement('GestureHandlerRootView', props)
  }
})

// The shared stand-in hands out a fresh shared value on every render; a
// picture zoomed by one gesture has to still be zoomed on the next render.
vi.mock('react-native-reanimated', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-native-reanimated')
  const { useRef } = await import('react')
  return {
    ...actual,
    useSharedValue: <T,>(initial: T) => useRef({ value: initial }).current
  }
})

vi.mock('react-native', async () => {
  const { createElement } = await import('react')
  return {
    Keyboard: { dismiss: () => {} },
    Image: Object.assign((props: Record<string, unknown>) => createElement('RNImage', props), {
      getSize: (_uri: string, ok: (w: number, h: number) => void) => ok(1600, 900)
    }),
    Modal: 'Modal',
    // The S23 Ultra's ratio: gesture-handler's dp/s velocity is scaled by it.
    PixelRatio: { get: () => 2.75 },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StatusBar: 'StatusBar',
    Text: 'Text',
    View: 'View',
    StyleSheet: { create: <T,>(styles: T) => styles },
    useColorScheme: () => 'dark',
    useWindowDimensions: () => ({ width: 400, height: 800 })
  }
})

vi.mock('lucide-react-native', () => ({ Check: 'Check', Download: 'Download', Pencil: 'Pencil', X: 'X' }))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetImagePreviewForTests()
})

function render(theme: 'light' | 'dark' = 'dark'): ReactTestRenderer {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={theme}>
        <ImagePreviewModal />
      </ThemeProvider>
    )
  })
  return renderer!
}

function openAgentImage(): ReactTestRenderer {
  openImagePreview('file:///agent-read.png', 'Image the agent read')
  return render()
}

/** Every gesture on the picture as rendered now, composition flattened. */
function gestures(): Recorded[] {
  const detector = renderer!.root.find((node) => String(node.type) === 'GestureDetector')
  const out: Recorded[] = []
  const walk = (g: Recorded) => {
    if (g.children) {
      g.children.forEach(walk)
    } else {
      out.push(g)
    }
  }
  walk(detector.props.gesture as Recorded)
  return out
}

/** Gestures gesture-handler would run: a builder with `.enabled(false)` never activates. */
function live(kind: string): Recorded[] {
  return gestures().filter((g) => g.kind === kind && g.config.enabled?.[0] !== false)
}

function fire(g: Recorded, name: string, event: Record<string, unknown> = {}, success = true): void {
  act(() => {
    g.handlers[name]?.(event, success)
  })
}

/** What gesture-handler fires for a two-finger pinch out, released quickly:
 *  the pinch runs, and any single tap recognises the same touch as a tap.
 *  A movement limit does not reliably stop that: Tap measures the average of
 *  the fingers, which a symmetric pinch barely moves. */
function quickPinchOut(): void {
  const pinch = live('Pinch')[0]!
  fire(pinch, 'onBegin')
  fire(pinch, 'onStart')
  fire(pinch, 'onUpdate', { scale: 2.2, focalX: 200, focalY: 300 })
  for (const tap of live('Tap')) {
    if (tap.config.numberOfTaps?.[0] !== 2) {
      fire(tap, 'onEnd', { x: 200, y: 300 })
    }
  }
  fire(pinch, 'onEnd')
  fire(pinch, 'onFinalize')
}

/** The pan that closes the viewer: the one that is not the zoomed pan. */
function dismissPan(): Recorded {
  const pans = gestures().filter((g) => g.kind === 'Pan' && g.config.activeOffsetY !== undefined)
  expect(pans).toHaveLength(1)
  return pans[0]!
}

function pictureScale(): number {
  const picture = renderer!.root.find((node) => node.props.testID === 'zoomable-image')
  const styles = ([] as unknown[]).concat(picture.props.style).flat() as Record<string, unknown>[]
  const transform = styles.find((s) => s && Array.isArray(s.transform))?.transform as Record<string, number>[]
  return transform.find((t) => 'scale' in t)!.scale!
}

function swipeDown(translationY: number, velocityY = 200, translationX = 0): void {
  for (const pan of live('Pan')) {
    fire(pan, 'onBegin')
    fire(pan, 'onStart')
    fire(pan, 'onUpdate', { translationX, translationY, velocityX: 0, velocityY })
    fire(pan, 'onEnd', { translationX, translationY, velocityX: 0, velocityY })
    fire(pan, 'onFinalize')
  }
}

describe('the image viewer while the picture is zoomed', () => {
  it('keeps the viewer open while the picture is pinch-zoomed', () => {
    openAgentImage()
    quickPinchOut()
    expect(peekImagePreview()).not.toBeNull()
    expect(pictureScale()).toBeCloseTo(2.2)
  })

  it('reads no pinch as a tap: every tap on the picture has a movement limit', () => {
    openAgentImage()
    const taps = gestures().filter((g) => g.kind === 'Tap')
    expect(taps.length).toBeGreaterThan(0)
    for (const tap of taps) {
      expect(tap.config.maxDistance?.[0]).toBeLessThanOrEqual(16)
    }
  })

  it('stays open on a single tap on the picture at fit', () => {
    openAgentImage()
    for (const tap of live('Tap')) {
      if (tap.config.numberOfTaps?.[0] !== 2) {
        fire(tap, 'onEnd', { x: 200, y: 300 })
      }
    }
    expect(peekImagePreview()).not.toBeNull()
  })

  it('has no tap-to-close area around the picture: only the X closes', () => {
    openAgentImage()
    const closers = renderer!.root.findAll(
      (node) => String(node.type) === 'Pressable' && /close/i.test(String(node.props.accessibilityLabel ?? ''))
    )
    expect(closers.map((node) => node.props.accessibilityLabel)).toEqual(['Close'])
  })

  it('zooms in on a double tap and stays open', () => {
    openAgentImage()
    const doubleTap = live('Tap').find((g) => g.config.numberOfTaps?.[0] === 2)!
    fire(doubleTap, 'onEnd', { x: 200, y: 300 })
    expect(pictureScale()).toBeGreaterThan(1)
    expect(peekImagePreview()).not.toBeNull()
  })

  it('closes on a deliberate swipe down at 1x', () => {
    openAgentImage()
    swipeDown(160)
    expect(peekImagePreview()).toBeNull()
  })

  it('closes on a fast fling down at 1x, though it travelled less than the distance', () => {
    openAgentImage()
    swipeDown(60, 2000)
    expect(peekImagePreview()).toBeNull()
  })

  it('springs back and stays open on a short slow drag down', () => {
    openAgentImage()
    swipeDown(50, 100)
    expect(peekImagePreview()).not.toBeNull()
  })

  it('does not close on a drag down while zoomed in: the drag pans the picture', () => {
    openAgentImage()
    quickPinchOut()
    swipeDown(300, 2500)
    expect(peekImagePreview()).not.toBeNull()
  })

  it('does not close when the zoom state trails the gesture: the swipe re-checks the scale itself', () => {
    openAgentImage()
    // Captured at fit, before the pinch re-renders the gestures: the same
    // builder gesture-handler still holds for one frame after the zoom.
    const staleDismiss = dismissPan()
    quickPinchOut()
    fire(staleDismiss, 'onStart')
    fire(staleDismiss, 'onUpdate', { translationX: 0, translationY: 300, velocityY: 2500 })
    fire(staleDismiss, 'onEnd', { translationX: 0, translationY: 300, velocityY: 2500 })
    expect(peekImagePreview()).not.toBeNull()
  })

  it('stays open when a second finger lands mid-swipe and cancels it', () => {
    openAgentImage()
    const pan = dismissPan()
    fire(pan, 'onStart')
    fire(pan, 'onUpdate', { translationX: 0, translationY: 200, velocityY: 2000 })
    // maxPointers(1): gesture-handler cancels the active pan, onEnd(success=false).
    fire(pan, 'onEnd', { translationX: 0, translationY: 200, velocityY: 2000 }, false)
    expect(peekImagePreview()).not.toBeNull()
  })

  it('swipes to close with one finger, downward only, giving a sideways drag to the pager', () => {
    openAgentImage()
    const pan = dismissPan()
    expect(pan.config.maxPointers).toEqual([1])
    // One positive number: activates on a drag DOWN past it, never up.
    expect(pan.config.activeOffsetY?.[0]).toBeGreaterThan(0)
    const [left, right] = pan.config.failOffsetX?.[0] as number[]
    expect(left).toBeLessThan(0)
    expect(right).toBeGreaterThan(0)
  })
})

describe('the image viewer background', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`is opaque near-black in the ${theme} theme, so the chat never shows through`, () => {
      openImagePreview('file:///agent-read.png', 'Image the agent read')
      render(theme)
      const root = renderer!.root.find((node) => String(node.type) === 'GestureHandlerRootView')
      const surface = root.children[0] as ReactTestInstance
      const style = ([] as unknown[]).concat(surface.props.style).flat() as Record<string, unknown>[]
      const background = style.map((s) => s?.backgroundColor).find(Boolean)
      expect(background).toBe('#000')
    })
  }
})
