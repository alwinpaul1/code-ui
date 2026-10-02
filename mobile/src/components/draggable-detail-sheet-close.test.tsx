import type { ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const seam = vi.hoisted(() => ({
  timings: [] as { to: number; done?: (finished: boolean) => void }[],
  shared: [] as { value: number }[],
  panCalls: 0
}))

vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('react-native', () => ({
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
vi.mock('react-native-gesture-handler', () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: {
      Pan: () => {
        seam.panCalls += 1
        return chain
      },
      Native: () => chain
    },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
// useSharedValue keeps one cell per call site, as the real hook does, so a
// re-render sees the same cells; the cells are listed in creation order.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) =>
      React.useRef(
        (() => {
          const cell = { value: initial }
          seam.shared.push(cell)
          return cell
        })()
      ).current,
    useAnimatedStyle: () => ({}),
    useAnimatedScrollHandler: () => () => {},
    withSpring: (to: number) => to,
    withTiming: (to: number, _config?: unknown, done?: (finished: boolean) => void) => {
      seam.timings.push({ to, done })
      return to
    },
    runOnJS:
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) =>
        fn(...args),
    interpolate: () => 0,
    Extrapolation: { CLAMP: 'clamp' }
  }
})
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
import { resolveDraggableSheetHeights } from './draggable-detail-sheet-snap'

function sheet(
  visible: boolean,
  onClose: () => void,
  onAfterClose?: () => void,
  body = 'body'
): ReactElement {
  return (
    <DraggableDetailSheet visible={visible} onClose={onClose} onAfterClose={onAfterClose} header={null}>
      {body}
    </DraggableDetailSheet>
  )
}

let renderer: ReactTestRenderer | null = null

function render(element: ReactElement): ReactTestRenderer {
  act(() => {
    renderer = create(element)
  })
  return renderer!
}

function pressClose(): void {
  const button = renderer!.root.findByProps({ testID: 'draggable-detail-sheet-close' })
  act(() => button.props.onPress())
}

/** The hide animation the sheet last started, as the UI thread would finish it. */
function lastHide() {
  const hide = seam.timings.findLast((timing) => timing.to === 0 && timing.done)
  expect(hide, 'a hide animation was started').toBeDefined()
  return hide!
}

beforeEach(() => {
  seam.timings.length = 0
  seam.shared.length = 0
  seam.panCalls = 0
  const originalConsoleError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('not configured to support act')) {
      return
    }
    originalConsoleError(...args)
  })
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.restoreAllMocks()
})

describe('the tool-detail sheet reopened while its last hide report is still in flight', () => {
  it('still unmounts on the next close and hands off once, after it', () => {
    const afterClose = vi.fn()
    const onClose = vi.fn()
    render(sheet(true, onClose, afterClose))

    act(() => renderer!.update(sheet(false, onClose, afterClose)))
    const firstClose = lastHide()
    act(() => renderer!.update(sheet(true, onClose, afterClose)))
    // The first close finished on the UI thread just before the reopen; its report lands after it.
    act(() => firstClose.done!(true))

    expect(renderer!.toJSON(), 'the reopened sheet stays up').not.toBeNull()
    expect(afterClose, 'no hand-off while the sheet is open').not.toHaveBeenCalled()

    act(() => renderer!.update(sheet(false, onClose, afterClose)))
    act(() => lastHide().done!(true))

    expect(renderer!.toJSON(), 'the second close unmounts the sheet').toBeNull()
    expect(afterClose).toHaveBeenCalledTimes(1)
  })
})

describe('the tool-detail sheet closed by its cross', () => {
  it('leaves from where it stands instead of jumping up to full height first', () => {
    render(sheet(true, vi.fn()))
    const [translateY] = seam.shared
    const { fullHeight, defaultHeight } = resolveDraggableSheetHeights({
      screenHeight: 844,
      topInset: 62,
      topGap: 24
    })
    expect(fullHeight - defaultHeight, 'it opens part way down').toBeGreaterThan(0)
    expect(translateY!.value).toBe(fullHeight - defaultHeight)

    pressClose()

    // Writing 0 here moved the whole sheet up to its full-height position in
    // one frame, then slid it down: a jump on every close from the default rest.
    expect(translateY!.value).toBe(fullHeight - defaultHeight)
  })

  it('unmounts as soon as the parent hides it, without a second exit animation', () => {
    const afterClose = vi.fn()
    let visible = true
    const onClose = vi.fn(() => {
      visible = false
    })
    render(sheet(visible, onClose, afterClose))

    pressClose()
    act(() => lastHide().done!(true))
    expect(onClose).toHaveBeenCalledTimes(1)
    const timingsBefore = seam.timings.length

    act(() => renderer!.update(sheet(visible, onClose, afterClose)))

    // The sheet is already off the screen: another 150 ms of the same
    // animation only keeps an invisible Modal over the screen, and holds
    // back whatever waits for onAfterClose.
    expect(seam.timings.length, 'no second hide animation').toBe(timingsBefore)
    expect(renderer!.toJSON()).toBeNull()
    expect(afterClose).toHaveBeenCalledTimes(1)
  })

  it('still waits for the exit animation when the parent hides it on its own', () => {
    const afterClose = vi.fn()
    render(sheet(true, vi.fn(), afterClose))
    act(() => renderer!.update(sheet(false, vi.fn(), afterClose)))
    expect(renderer!.toJSON(), 'mounted while it animates out').not.toBeNull()

    act(() => lastHide().done!(false))
    expect(renderer!.toJSON(), 'an interrupted animation is not a finished one').not.toBeNull()

    act(() => lastHide().done!(true))
    expect(renderer!.toJSON()).toBeNull()
    expect(afterClose).toHaveBeenCalledTimes(1)
  })
})

// The sheet re-renders whenever the call it shows changes (a running tool
// streams its output): a new Gesture.Pan() per render makes gesture-handler
// reconfigure the handler tracking the finger, mid-drag (BottomDrawer's
// gestures are memoised for the same reason).
describe('the tool-detail sheet while its content re-renders under the finger', () => {
  it('keeps the gestures it handed gesture-handler', () => {
    render(sheet(true, vi.fn(), undefined, 'first'))
    const afterFirstRender = seam.panCalls
    expect(afterFirstRender).toBeGreaterThan(0)

    act(() => renderer!.update(sheet(true, vi.fn(), undefined, 'second, streamed in')))

    expect(seam.panCalls).toBe(afterFirstRender)
  })
})
