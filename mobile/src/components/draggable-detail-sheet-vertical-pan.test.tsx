import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

// A gesture builder that remembers its kind and every configuration call, so
// the test can read what the sheet asked gesture-handler for.
type Recorded = { kind: string; calls: Record<string, unknown[][]> }

vi.mock('react-native-gesture-handler', () => {
  const builder = (kind: string): unknown => {
    const calls: Record<string, unknown[][]> = {}
    const self: unknown = new Proxy(
      {},
      {
        get: (_, key) => {
          if (key === 'kind') {
            return kind
          }
          if (key === 'calls') {
            return calls
          }
          return (...args: unknown[]) => {
            ;(calls[String(key)] ??= []).push(args)
            return self
          }
        }
      }
    )
    return self
  }
  return {
    Gesture: { Pan: () => builder('pan'), Native: () => builder('native') },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('react-native', () => ({
  // DraggableDetailSheet and the image viewers send the keyboard away as they open.
  Keyboard: { dismiss: () => {} },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  useAnimatedScrollHandler: () => () => {},
  withSpring: (to: number) => to,
  withTiming: (to: number) => to,
  runOnJS:
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
  interpolate: () => 0,
  Extrapolation: { CLAMP: 'clamp' }
}))
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('../theme/theme-context', async () => {
  const { lightColors } = await import('../theme/tokens')
  return { useTheme: () => ({ colors: lightColors }) }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 640 })
}))

import { DraggableDetailSheet } from './DraggableDetailSheet'

/** The gestures of every detector above `node`, nearest first. */
function detectorGestures(node: ReactTestInstance): Recorded[] {
  const found: Recorded[] = []
  for (let current = node.parent; current; current = current.parent) {
    if (String(current.type) === 'GestureDetector') {
      found.push(current.props.gesture as Recorded)
    }
  }
  return found
}

/** A Pan that activates on vertical movement and is simultaneous with nothing
 *  but Native gestures the sheet itself owns: its activation is what cancels
 *  a Native gesture on the content (the tool sheet's selectable output). */
function isCancellingVerticalPan(gesture: Recorded, sheetNatives: readonly Recorded[]): boolean {
  if (gesture.kind !== 'pan' || !gesture.calls.activeOffsetY) {
    return false
  }
  const partners = (gesture.calls.simultaneousWithExternalGesture ?? []).flat() as Recorded[]
  return partners.every((partner) => sheetNatives.includes(partner))
}

// a1bda082 keeps a drag over the tool sheet's selectable output from selecting
// a word by giving the text its own Native gesture, which a vertical Pan's
// activation cancels. That holds only while every snap of the sheet puts such
// a Pan above its content: the default height's body pan, and the full
// height's content pan over the scroll. RightDrawer, whose only vertical
// recogniser is its scroll, is where the same wrapper does nothing.
describe('the tool-detail sheet keeps a vertical Pan above its content at both snaps', () => {
  it('has one at the default height and at full height', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <DraggableDetailSheet visible onClose={() => {}} header={null}>
          {'content' as never}
        </DraggableDetailSheet>
      )
    })
    const content = (): ReactTestInstance =>
      renderer.root.findAll((node) => node.children.includes('content'))[0]!

    const atDefault = detectorGestures(content())
    expect(atDefault.some((gesture) => isCancellingVerticalPan(gesture, []))).toBe(true)

    // A decisive upward flick on the body opens the sheet to full height.
    const bodyPan = atDefault.find((gesture) => gesture.kind === 'pan')!
    const onEnd = bodyPan.calls.onEnd![0]![0] as (event: { velocityY: number; translationY: number }) => void
    act(() => onEnd({ velocityY: -5000, translationY: -300 }))
    expect(renderer.root.findAllByProps({ testID: 'draggable-detail-sheet-scroll' })).toHaveLength(1)

    const atFull = detectorGestures(content())
    const natives = atFull.filter((gesture) => gesture.kind === 'native')
    expect(natives).toHaveLength(1)
    expect(atFull.some((gesture) => isCancellingVerticalPan(gesture, natives))).toBe(true)
    act(() => renderer.unmount())
  })
})
