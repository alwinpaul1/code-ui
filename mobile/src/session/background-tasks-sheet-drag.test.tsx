// Reported from the phone on 2026-09-27: "The sheet scroll is laggy and
// glitching". The recording (Galaxy S23 Ultra, 16.6 s) shows the Background
// tasks sheet opened part way and pulled to full height. A drag down from
// there then scrolled the list up under the finger while the sheet shrank
// (8.9-9.4 s: the title and its close cross go off the top), rather than
// taking the sheet down with the finger. It came to rest at its opening
// height with the list still scrolled, and for six seconds (9.4-15.3 s)
// nothing the finger did on the list moved it: the list could not scroll
// there, and the drag on it waited for the list to reach its top first.
//
// These play the gestures through the real sheet, drawer and theme: the
// callbacks the drawer hands gesture-handler are called the way the phone
// calls them, and the list's own onScroll is fired where the native list
// reports a scroll. Shared values are timelines read at `clock.now`.
import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

const clock = vi.hoisted(() => ({ now: 0 }))
/** The window, in dp; a test turns the phone by swapping the two. */
const win = vi.hoisted(() => ({ width: 384, height: 823 }))
/** Every `scrollTo` the drawer asked for: what its ref pointed at, and the y. */
const scrolls = vi.hoisted(() => ({ calls: [] as { target: unknown; y: number }[] }))
/** What the list's ref points at once mounted (createNodeMock below). */
const LIST_NODE = vi.hoisted(() => ({ nativeList: true }))
/** `springs: true` plays a spring back the way Reanimated moves it; off, it
 *  lands at once, which is all a test of where a drag comes to rest needs. */
const motion = vi.hoisted(() => ({ springs: false, overshoot: false }))
/** Whether the tasks sheet is asked to show: a test closes and reopens it. */
const shown = vi.hoisted(() => ({ visible: true }))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  Animated: {
    View: 'AnimatedView',
    createAnimatedComponent: (component: unknown) => component,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({}),
    sequence: () => ({})
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
  Keyboard: {
    addListener: () => ({ remove: () => {} }),
    dismiss: () => {},
    metrics: () => null
  },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    absoluteFill: {},
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: win.width, height: win.height })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 36, bottom: 24, left: 0, right: 0 })
}))

// A gesture builder that keeps its kind and every call made on it, so a test
// can call back into the callbacks the drawer registered.
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

// A shared value that is a timeline: `withTiming` hands back its curve and
// `.value` reads it at `clock.now` (attach-sheet-opens-on-first-frame.test.tsx).
// A spring lands on its target at once unless `motion.springs` is on.
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  type Timing = { timing: true; to: number; duration: number; easing: (t: number) => number }
  type SpringConfig = { damping?: number; stiffness?: number; mass?: number }
  type Spring = { spring: true; to: number; config: SpringConfig }
  type Animation = Timing | Spring
  const inOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)
  const isAnimation = (value: unknown): value is Animation =>
    typeof value === 'object' && value !== null && ('timing' in value || 'spring' in value)
  /** Reanimated 4.5.1's withSpring from rest (src/animation/spring): the
   *  config goes over GentleSpringConfig, {damping 120, mass 4, stiffness 900},
   *  and below a damping ratio of 1 it moves as
   *  to + e^(-ζω0·t)·(x0·cos ω1t + (ζω0·x0/ω1)·sin ω1t); at 1 and above as
   *  to + e^(-ω0·t)·x0·(1 + ω0·t) (springUtils.ts). */
  function springAt(from: number, spring: Spring, seconds: number): number {
    // `overshoot` plays every spring as the drawer's old {damping 28, stiffness 400}
    // under that default mass: a ratio of 0.35, about 31% past its target.
    const config = motion.overshoot ? { damping: 28, stiffness: 400 } : spring.config
    const mass = config.mass ?? 4
    const stiffness = config.stiffness ?? 900
    const damping = config.damping ?? 120
    const zeta = damping / (2 * Math.sqrt(stiffness * mass))
    const omega0 = Math.sqrt(stiffness / mass)
    const x0 = from - spring.to
    if (zeta < 1) {
      const omega1 = omega0 * Math.sqrt(1 - zeta * zeta)
      const envelope = Math.exp(-zeta * omega0 * seconds)
      return (
        spring.to +
        envelope * (x0 * Math.cos(omega1 * seconds) + ((zeta * omega0 * x0) / omega1) * Math.sin(omega1 * seconds))
      )
    }
    return spring.to + Math.exp(-omega0 * seconds) * x0 * (1 + omega0 * seconds)
  }
  function timeline<T>(initial: T) {
    let from: unknown = initial
    let animation: Animation | null = null
    let startedAt = 0
    const read = (): unknown => {
      if (!animation) {
        return from
      }
      if ('spring' in animation) {
        return springAt(from as number, animation, Math.max(clock.now - startedAt, 0) / 1000)
      }
      const t = Math.min(Math.max((clock.now - startedAt) / animation.duration, 0), 1)
      return (from as number) + (animation.to - (from as number)) * animation.easing(t)
    }
    return {
      get value(): T {
        return read() as T
      },
      set value(next: T | Animation) {
        if (isAnimation(next)) {
          from = read()
          animation = next
          startedAt = clock.now
        } else {
          from = next
          animation = null
        }
      }
    }
  }
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: <T,>(initial: T) => React.useRef(timeline(initial)).current,
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    useAnimatedScrollHandler: <H,>(handler: H) => handler,
    useAnimatedRef: () => React.useRef<unknown>(null),
    scrollTo: (ref: { current: unknown }, _x: number, y: number) => {
      scrolls.calls.push({ target: ref.current, y })
    },
    cancelAnimation: () => {},
    withTiming: (to: number, config?: { duration?: number; easing?: (t: number) => number }) => ({
      timing: true,
      to,
      duration: config?.duration ?? 300,
      easing: config?.easing ?? inOutQuad
    }),
    withSpring: (to: number, config?: SpringConfig) =>
      motion.springs ? { spring: true, to, config: config ?? {} } : to,
    runOnUI:
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) =>
        fn(...args),
    runOnJS:
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) =>
        fn(...args),
    interpolate: (value: number, input: [number, number], output: [number, number]) => {
      const t = Math.min(Math.max((value - input[0]) / (input[1] - input[0]), 0), 1)
      return output[0] + (output[1] - output[0]) * t
    },
    Extrapolation: { CLAMP: 'clamp' }
  }
})
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Terminal: 'Terminal',
  X: 'X'
}))
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 440 })
}))
vi.mock('../components/bottom-drawer-modal-host', () => ({
  useInsideBottomDrawerModalHost: () => true
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

import { BottomDrawer } from '../components/BottomDrawer'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'

/** The S23 Ultra of the recording, in dp: 823 tall, 36 of status bar. The
 *  drawer keeps a 16 dp gap under it, so full height is 771 and the opening
 *  height is 62% of the window, 510. */
const WINDOW = 823
const FULL_TOP = WINDOW - 771
const OPENING_TOP = WINDOW - 510

const T0 = Date.UTC(2026, 8, 27, 8, 10, 0)
/** "Agent 24s" in the recording's running row. */
const NOW = T0 + 24_000

const backgroundStartOutput = (id: string) =>
  `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`

/** One shell still running, so the sheet's clock ticks every second. */
const MESSAGES: NativeChatMessage[] = [
  {
    id: 'a1',
    role: 'assistant',
    timestamp: T0,
    source: 'transcript',
    blocks: [
      {
        type: 'tool-call',
        name: 'Bash',
        input: { command: 'pnpm build', description: 'Review save picker gate', run_in_background: true }
      }
    ]
  },
  {
    id: 'r1',
    role: 'user',
    timestamp: T0 + 10,
    source: 'transcript',
    blocks: [{ type: 'tool-result', output: backgroundStartOutput('bpz1skord') }]
  }
]

type Scheme = 'light' | 'dark'
type PanEvent = { translationY: number; velocityY: number }

let renderer: ReactTestRenderer | null = null
let render: () => ReactElement = () => createElement('View')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  clock.now = 0
  scrolls.calls = []
  win.width = 384
  win.height = 823
  motion.springs = false
  motion.overshoot = false
  shown.visible = true
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

/** The tasks sheet as the chat's tasks provider renders it: a fresh `onClose`
 *  arrow on every render, the way a streamed message re-renders it. */
function tasksSheet(scheme: Scheme): () => ReactElement {
  return () => (
    <ThemeProvider initialPreference={scheme}>
      <MobileBackgroundTasksSheet visible={shown.visible} messages={MESSAGES} onClose={() => {}} />
    </ThemeProvider>
  )
}

/** A content-sized sheet whose content drags it closed (ActionSheetModal,
 *  the context-window sheet): BottomDrawer's default. */
function contentSheet(): ReactElement {
  return (
    <ThemeProvider initialPreference="light">
      <BottomDrawer visible onClose={() => {}}>
        {createElement('View', { testID: 'rows' })}
      </BottomDrawer>
    </ThemeProvider>
  )
}

async function open(element: () => ReactElement): Promise<void> {
  render = element
  await act(async () => {
    renderer = create(render(), { createNodeMock })
  })
  // Past the 180 ms enter: the sheet stands at its rest.
  clock.now = 1000
  rerender()
}

/** The native views behind host tags: only the list's matters, so a
 *  `scrollTo` can be checked for reaching the list and not a loose ref. */
function createNodeMock(element: ReactElement): unknown {
  return (element.type as unknown) === 'AnimatedScrollView' ? LIST_NODE : null
}

/** Whether the drawer scrolled the list itself back to its top. */
function listPutBackAtTop(): boolean {
  return scrolls.calls.some((call) => call.target === LIST_NODE && call.y === 0)
}

/** A parent re-render, which is also how a style is read back here. */
function rerender(): void {
  act(() => renderer!.update(render()))
}

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean))
}

function isHost(node: ReactTestInstance, tag: string): boolean {
  return (node.type as unknown) === tag
}

function sheetNode(): ReactTestInstance {
  return renderer!.root.find((node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet')
}

function sheetStyle(): Record<string, unknown> {
  rerender()
  return flatten(sheetNode().props.style)
}

function translateY(style: Record<string, unknown>): number {
  const transform = (style.transform ?? []) as Record<string, number>[]
  return transform.find((entry) => 'translateY' in entry)?.translateY ?? 0
}

/** Where the sheet's top edge is, in dp from the top of the window: the box
 *  is bottom-anchored, `height` tall, and moved down by its translateY. */
function sheetTop(): number {
  const style = sheetStyle()
  const box = Math.min(style.height as number, (style.maxHeight as number | undefined) ?? Infinity)
  return win.height - box + translateY(style)
}

function list(): ReactTestInstance {
  return renderer!.root.find((node) => isHost(node, 'AnimatedScrollView'))
}

/** The native list saying where it scrolled to, as its onScroll does. */
function listReportsScroll(y: number): void {
  const onScroll = list().props.onScroll as (event: { contentOffset: { x: number; y: number } }) => void
  act(() => onScroll({ contentOffset: { x: 0, y } }))
}

function detectorsAbove(node: ReactTestInstance): Recorded[] {
  const found: Recorded[] = []
  for (let current = node.parent; current; current = current.parent) {
    if (isHost(current, 'GestureDetector')) {
      found.push(current.props.gesture as Recorded)
    }
  }
  return found
}

function allGestures(): Recorded[] {
  return renderer!.root.findAll((node) => isHost(node, 'GestureDetector')).map((node) => node.props.gesture as Recorded)
}

/** The pan nearest above a node: what a finger put down there drives. */
function panAbove(find: () => ReactTestInstance): () => Recorded {
  return () => {
    const pan = detectorsAbove(find()).find((gesture) => gesture.kind === 'pan')
    if (!pan) {
      throw new Error('no pan above the node')
    }
    return pan
  }
}

const handlePan = panAbove(() =>
  renderer!.root.find((node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'Dismiss drawer')
)
const listPan = panAbove(list)
const titlePan = panAbove(() => titleText())

function titleText(): ReactTestInstance {
  return renderer!.root.find((node) => isHost(node, 'Text') && node.props.children === 'Background tasks')
}

/** Calls what the drawer registered for `callback` on the gesture found now:
 *  a re-render may have handed gesture-handler a new one. */
function fire(pan: () => Recorded, callback: 'onBegin' | 'onUpdate' | 'onEnd', event: PanEvent): void {
  const handler = pan().calls[callback]?.[0]?.[0] as ((event: PanEvent) => void) | undefined
  if (!handler) {
    throw new Error(`the pan has no ${callback}`)
  }
  act(() => handler(event))
}

function begin(pan: () => Recorded): void {
  fire(pan, 'onBegin', { translationY: 0, velocityY: 0 })
}

function move(pan: () => Recorded, translationY: number): void {
  fire(pan, 'onUpdate', { translationY, velocityY: 0 })
}

function lift(pan: () => Recorded, translationY: number, velocityY = 0): void {
  fire(pan, 'onEnd', { translationY, velocityY })
}

/** A quick flick up on the handle: how the recording takes it to full height. */
function pullToFull(): void {
  begin(handlePan)
  move(handlePan, -120)
  move(handlePan, -300)
  lift(handlePan, -300, -1500)
  expect(sheetTop(), 'the sheet should stand at full height').toBe(FULL_TOP)
}

/** Plays the clock on in 8 ms frames and reads `probe` on each. */
function playFrames(ms: number, probe: () => number): number[] {
  const seen: number[] = []
  const end = clock.now + ms
  while (clock.now < end) {
    clock.now += 8
    seen.push(probe())
  }
  return seen
}

/** The strip the drawer lays over the bottom of what it shows, if any. */
function bottomStripNode(): ReactTestInstance {
  return renderer!.root.find((node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-bottom-strip')
}

/** How far the strip's bottom edge is from the top of the window: the sheet's
 *  box is bottom-anchored and moved by its translateY, and the strip sits at
 *  the box's bottom, moved by its own. */
function bottomStripBottom(): number {
  const sheet = sheetStyle()
  return win.height + translateY(sheet) + translateY(flatten(bottomStripNode().props.style))
}

function elapsedTexts(): string[] {
  return renderer!.root
    .findAll((node) => isHost(node, 'Text') && typeof node.props.children === 'string')
    .map((node) => node.props.children as string)
    .filter((text) => /^\d+s$/.test(text))
}

describe('the Background tasks sheet dragged down from full height (recording of 2026-09-27)', () => {
  it('follows the finger down when the list under it reports a scroll, instead of scrolling the list', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    begin(listPan)
    move(listPan, 60)
    expect(sheetTop()).toBe(FULL_TOP + 60)
    // What the recording shows from 9.0 s: the list scrolled under the finger
    // while the sheet moved down.
    listReportsScroll(45)
    move(listPan, 140)
    expect(sheetTop(), 'the sheet stopped following the finger').toBe(FULL_TOP + 140)
    expect(listPutBackAtTop(), 'the list was left scrolled while the sheet moved').toBe(true)
  })

  it('comes to rest at full or opening height, never between, when the list reports a scroll mid-drag', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    begin(listPan)
    move(listPan, 100)
    listReportsScroll(45)
    lift(listPan, 100)
    expect([FULL_TOP, OPENING_TOP]).toContain(sheetTop())
  })

  it('still moves when dragged on the list after coming to rest at its opening height with the list scrolled', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    listReportsScroll(150)
    // Down by the handle, let go moving: it drops to its opening height.
    begin(handlePan)
    move(handlePan, 100)
    move(handlePan, 200)
    lift(handlePan, 200, 800)
    expect(sheetTop()).toBe(OPENING_TOP)
    expect(list().props.scrollEnabled, 'the list does not scroll at the opening height').toBe(false)

    begin(listPan)
    move(listPan, 50)
    expect(sheetTop(), 'a drag down on the list did nothing').toBe(OPENING_TOP + 50)
    move(listPan, -100)
    expect(sheetTop(), 'a drag up on the list did nothing').toBe(OPENING_TOP - 100)
    // And it shows its first rows there, not wherever the list was left.
    expect(listPutBackAtTop(), 'the list should be back at its top at the opening height').toBe(true)
  })

  it('keeps its place and its gestures when the running clock ticks mid-drag', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    begin(listPan)
    move(listPan, 80)
    expect(sheetTop()).toBe(FULL_TOP + 80)
    const before = allGestures()
    expect(elapsedTexts()).toEqual(['24s'])

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(elapsedTexts(), 'the clock should have ticked').toEqual(['25s'])
    rerender()
    const after = allGestures()
    expect(after).toHaveLength(before.length)
    expect(
      after.every((gesture, index) => gesture === before[index]),
      'a re-render handed gesture-handler new gestures in the middle of a drag'
    ).toBe(true)
    expect(sheetTop()).toBe(FULL_TOP + 80)

    // A layout pass reporting the box mid-drag moves nothing either.
    act(() => {
      ;(sheetNode().props.onLayout as (event: unknown) => void)({
        nativeEvent: { layout: { x: 0, y: 0, width: 384, height: 691 } }
      })
    })
    expect(sheetTop()).toBe(FULL_TOP + 80)
    move(listPan, 120)
    expect(sheetTop()).toBe(FULL_TOP + 120)
  })

  it('drags without laying the sheet out again on every frame', async () => {
    await open(tasksSheet('light'))
    const height = sheetStyle().height
    begin(listPan)
    move(listPan, -50)
    expect(sheetTop()).toBe(OPENING_TOP - 50)
    expect(sheetStyle().height, 'the drag resized the sheet, a layout pass per frame').toBe(height)
    move(listPan, -100)
    expect(sheetTop()).toBe(OPENING_TOP - 100)
    expect(sheetStyle().height, 'the drag resized the sheet, a layout pass per frame').toBe(height)
  })

  it('scrolls the list back to its top before it moves the sheet, when dragged down with the list scrolled', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    listReportsScroll(200)
    begin(listPan)
    move(listPan, 50)
    expect(sheetTop(), 'the sheet moved while the list still had rows above').toBe(FULL_TOP)
    listReportsScroll(0)
    move(listPan, 120)
    expect(sheetTop()).toBe(FULL_TOP)
    move(listPan, 180)
    expect(sheetTop()).toBe(FULL_TOP + 60)
    lift(listPan, 180)
    expect(sheetTop()).toBe(FULL_TOP)
  })

  it('lets the list take a drag up at full height', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    expect(list().props.scrollEnabled).toBe(true)
    begin(listPan)
    move(listPan, -80)
    listReportsScroll(80)
    expect(scrolls.calls, 'the list was held while it should scroll').toEqual([])
    lift(listPan, -80, -900)
    expect(sheetTop()).toBe(FULL_TOP)
  })

  it('settles on a rest when the handle is let go between them', async () => {
    await open(tasksSheet('light'))
    begin(handlePan)
    move(handlePan, -60)
    lift(handlePan, -60)
    expect(sheetTop()).toBe(OPENING_TOP)
    begin(handlePan)
    move(handlePan, -200)
    lift(handlePan, -200)
    expect(sheetTop()).toBe(FULL_TOP)
  })

  it('is on screen from the first frame of its open', async () => {
    render = tasksSheet('light')
    await act(async () => {
      renderer = create(render(), { createNodeMock })
    })
    // The device's first layout pass reports the box it laid out.
    const box = sheetStyle().height as number
    act(() => {
      ;(sheetNode().props.onLayout as (event: unknown) => void)({
        nativeEvent: { layout: { x: 0, y: 0, width: 384, height: box } }
      })
    })
    clock.now = 1000 / 60
    expect(sheetTop(), 'the sheet is still below the screen edge a frame into its open').toBeLessThan(WINDOW)
    clock.now = 1000
    expect(sheetTop()).toBe(OPENING_TOP)
  })

  it('stands at its opening height after the phone turns, and a nudge does not close it', async () => {
    await open(tasksSheet('light'))
    expect(sheetTop()).toBe(OPENING_TOP)
    win.width = 823
    win.height = 384
    // The render the turn causes (a style is read back on the one after).
    rerender()
    // Landscape: full is 384 - 36 - 16 = 332, the opening height 62% of 384.
    const landscapeOpeningTop = 384 - Math.round(384 * 0.62)
    expect(sheetTop(), 'the sheet kept its portrait offset').toBe(landscapeOpeningTop)
    begin(handlePan)
    move(handlePan, 10)
    lift(handlePan, 10)
    expect(sheetTop(), 'a 10 dp nudge closed the sheet').toBe(landscapeOpeningTop)
  })

  it('leaves a list that is still moving alone while the handle moves the sheet', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    begin(handlePan)
    move(handlePan, 40)
    // A fling from before the handle was taken is still running.
    listReportsScroll(300)
    expect(scrolls.calls, 'the list was snapped to its top under a handle drag').toEqual([])
    lift(handlePan, 40)
    expect(sheetTop()).toBe(FULL_TOP)
  })

  it('rises no higher than full height, and keeps its bottom on the screen edge, as it springs up', async () => {
    motion.springs = true
    await open(tasksSheet('light'))
    begin(handlePan)
    move(handlePan, -100)
    lift(handlePan, -100, -1500)
    const gaps: number[] = []
    const tops = playFrames(1000, () => {
      // How far its bottom edge stands above the bottom of the window.
      gaps.push(Math.max(0, -translateY(sheetStyle())))
      return sheetTop()
    })
    expect(Math.min(...tops), 'the sheet sprang up into the status bar').toBeGreaterThanOrEqual(FULL_TOP)
    expect(Math.max(...gaps), 'the sheet lifted its bottom off the screen').toBe(0)
    expect(sheetTop()).toBeCloseTo(FULL_TOP, 0)
  })

  it('never stands above full height, even under a spring that overshoots', async () => {
    motion.springs = true
    motion.overshoot = true
    await open(tasksSheet('light'))
    begin(handlePan)
    move(handlePan, -100)
    lift(handlePan, -100, -1500)
    const tops = playFrames(1000, sheetTop)
    expect(Math.min(...tops), 'the sheet stood above full height').toBeGreaterThanOrEqual(FULL_TOP)
  })

  it('comes down to its opening height without sinking below it', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    motion.springs = true
    begin(handlePan)
    move(handlePan, 40)
    lift(handlePan, 40, 900)
    const tops = playFrames(1000, sheetTop)
    expect(Math.max(...tops) - OPENING_TOP, 'dp the sheet sank below its opening height').toBeLessThanOrEqual(3)
    expect(sheetTop()).toBeCloseTo(OPENING_TOP, 0)
  })

  it('opens with its list at the top when reopened while it was still closing', async () => {
    await open(tasksSheet('light'))
    pullToFull()
    listReportsScroll(150)
    shown.visible = false
    rerender()
    clock.now += 50
    scrolls.calls = []
    shown.visible = true
    rerender()
    expect(listPutBackAtTop(), 'the list reopened part way down').toBe(true)
    clock.now += 1000
    expect(sheetTop()).toBe(OPENING_TOP)
  })

  it('keeps the chat behind dimmed at its opening height', async () => {
    await open(tasksSheet('light'))
    const backdrop = renderer!.root.find(
      (node) => isHost(node, 'AnimatedView') && flatten(node.props.style).backgroundColor === lightColors.bgOverlay
    )
    expect(flatten(backdrop.props.style).opacity).toBe(1)
  })
})

describe('the bottom of the Background tasks sheet', () => {
  it.each(['light', 'dark'] as const)('keeps the rows it shows clear of the gesture bar, in %s', async (scheme) => {
    const colors = scheme === 'light' ? lightColors : darkColors
    await open(tasksSheet(scheme))
    // The gesture bar's inset (24) and the drawer's own 16 below it.
    expect(flatten(bottomStripNode().props.style).height).toBe(24 + 16)
    expect(flatten(bottomStripNode().props.style).backgroundColor).toBe(colors.bgPanel)
    expect(bottomStripBottom(), 'the strip is not on the screen edge at the opening height').toBe(WINDOW)
    // Drawn after the list, so it lies over the rows that run under the bar.
    const children = sheetNode().children as ReactTestInstance[]
    const listAt = children.findIndex((child) => child.findAll((node) => isHost(node, 'AnimatedScrollView')).length > 0)
    expect(children.indexOf(bottomStripNode())).toBeGreaterThan(listAt)
    pullToFull()
    expect(bottomStripBottom(), 'the strip left the screen edge at full height').toBe(WINDOW)
    // Dragged down to close, the strip goes with the sheet.
    begin(handlePan)
    move(handlePan, 261 + 60)
    expect(bottomStripBottom()).toBe(WINDOW + 60)
  })
})

describe('the Background tasks sheet title', () => {
  it.each(['light', 'dark'] as const)('stays in view above the list, with its close cross, in %s', async (scheme) => {
    const colors = scheme === 'light' ? lightColors : darkColors
    await open(tasksSheet(scheme))
    const inList = (node: ReactTestInstance): boolean => {
      for (let current = node.parent; current; current = current.parent) {
        if (isHost(current, 'AnimatedScrollView')) {
          return true
        }
      }
      return false
    }
    const close = renderer!.root.find((node) => isHost(node, 'Pressable') && node.props.accessibilityLabel === 'Close')
    expect(inList(titleText()), 'the title scrolls away with the list').toBe(false)
    expect(inList(close), 'the close cross scrolls away with the list').toBe(false)
    expect(flatten(titleText().props.style).color).toBe(colors.text)
    expect(sheetStyle().backgroundColor).toBe(colors.bgPanel)
  })

  it('moves the sheet when dragged, even with the list scrolled', async () => {
    await open(tasksSheet('dark'))
    pullToFull()
    listReportsScroll(150)
    begin(titlePan)
    move(titlePan, 60)
    move(titlePan, 100)
    expect(sheetTop()).toBe(FULL_TOP + 100)
  })
})

describe('a content-sized sheet that closes by a drag on its content', () => {
  it('follows the finger down when the list under it reports a scroll', async () => {
    await open(contentSheet)
    begin(listPan)
    move(listPan, 60)
    expect(translateY(sheetStyle())).toBe(60)
    listReportsScroll(45)
    move(listPan, 140)
    expect(translateY(sheetStyle()), 'the sheet jumped back while the finger was still down').toBe(140)
  })

  it('springs back to where it rests without rising past it', async () => {
    motion.springs = true
    await open(contentSheet)
    begin(listPan)
    move(listPan, 60)
    lift(listPan, 60)
    const positions = playFrames(1000, () => translateY(sheetStyle()))
    expect(Math.min(...positions), 'dp the sheet rose past its rest').toBeGreaterThanOrEqual(-3)
    expect(translateY(sheetStyle())).toBeCloseTo(0, 0)
  })

  it('springs back rather than stopping part way when the list reports a scroll as the finger lifts', async () => {
    await open(contentSheet)
    begin(listPan)
    move(listPan, 60)
    listReportsScroll(45)
    lift(listPan, 60)
    expect(translateY(sheetStyle())).toBe(0)
  })

  it('scrolls a scrolled list first, and closes once dragged past the threshold from its top', async () => {
    await open(contentSheet)
    listReportsScroll(200)
    begin(listPan)
    move(listPan, 50)
    expect(translateY(sheetStyle())).toBe(0)
    listReportsScroll(0)
    move(listPan, 60)
    move(listPan, 160)
    expect(translateY(sheetStyle())).toBe(100)
    lift(listPan, 160)
    clock.now += 400
    expect(translateY(sheetStyle()), 'the sheet should leave the window').toBeGreaterThanOrEqual(WINDOW)
  })
})
