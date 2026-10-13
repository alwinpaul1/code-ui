import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PickedMobileImage } from '../platform/media-picker-contract'

// Reported from the phone on 2026-10-11: "after attaching any media from + button
// sheet opens smoother but closes stuck after attaching media especially images".
//
// A source card (Camera, Photos, Files) closed the sheet and launched the system
// picker in the same press. The picker is an Activity: launching it pauses the
// app's, and Reanimated stops driving animation frames on a host pause
// (NodesManager.onHostPause in react-native-reanimated 4.5.1). The sheet's 150 ms
// exit froze wherever its first frames had left it. Android's photo picker is a
// sheet over the app, so the half-closed + sheet and its dimmed backdrop stayed in
// sight behind it for the whole pick; Camera and Files cover the screen and hid
// it. Back from the picker, the exit's end reached JS behind the picked photo's
// chip, its scaling and its base64 read, so the sheet's window stayed up (and took
// taps) until all of that was done.
//
// These play the real attach button, sheet and drawer, with a timeline standing in
// for Reanimated: an animation's completion callback runs only when the test says
// the UI thread reached its end. The source's work, which is the picker launch and
// then everything after it, may start only once the sheet has gone.

const clock = vi.hoisted(() => ({ now: 0 }))
/** Animations the UI thread is still running: their completion callbacks, not yet called. */
const running = vi.hoisted(() => ({ callbacks: new Set<{ fire: (finished: boolean) => void }>() }))
const uploads = vi.hoisted(() => ({ log: [] as string[] }))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
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
  useWindowDimensions: () => ({ width: 412, height: 956 })
}))
vi.mock('lucide-react-native', () => ({
  Camera: 'Camera',
  ChevronRight: 'ChevronRight',
  Image: 'Image',
  Paperclip: 'Paperclip',
  FileUp: 'FileUp',
  Plus: 'Plus',
  Zap: 'Zap'
}))

// The upload itself: the host RPC is not what is under test, only when it starts.
vi.mock('./mobile-clipboard-image', () => ({
  saveMobileClipboardImageAsTempFile: async () => {
    uploads.log.push('upload')
    return '/tmp/orca-photo.jpg'
  }
}))

vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  type Timing = {
    timing: true
    to: number
    duration: number
    easing: (t: number) => number
    callback?: (finished: boolean) => void
  }
  const isTiming = (value: unknown): value is Timing =>
    typeof value === 'object' && value !== null && (value as Timing).timing === true
  function timeline(initial: number) {
    let from = initial
    let animation: Timing | null = null
    let startedAt = 0
    let pending: { fire: (finished: boolean) => void } | null = null
    const read = (): number => {
      if (!animation) {
        return from
      }
      const t = Math.min(Math.max((clock.now - startedAt) / animation.duration, 0), 1)
      return from + (animation.to - from) * animation.easing(t)
    }
    // Reanimated calls a replaced animation's callback with `finished: false`.
    const interrupt = () => {
      if (pending) {
        running.callbacks.delete(pending)
        const interrupted = pending
        pending = null
        interrupted.fire(false)
      }
    }
    return {
      get value(): number {
        return read()
      },
      set value(next: number | Timing) {
        const before = read()
        interrupt()
        if (isTiming(next)) {
          from = before
          animation = next
          startedAt = clock.now
          const callback = next.callback
          if (callback) {
            const entry = {
              fire: (finished: boolean) => {
                if (finished) {
                  from = next.to
                  animation = null
                }
                callback(finished)
              }
            }
            pending = entry
            running.callbacks.add(entry)
          }
        } else {
          from = next
          animation = null
        }
      }
    }
  }
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) => React.useRef(timeline(initial)).current,
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    scrollTo: () => {},
    withTiming: (
      to: number,
      config?: { duration?: number; easing?: (t: number) => number },
      callback?: (finished: boolean) => void
    ) => ({
      timing: true,
      to,
      duration: config?.duration ?? 300,
      easing: config?.easing ?? ((t: number) => t),
      callback
    }),
    withSpring: (to: number) => to,
    runOnJS: (fn: () => void) => fn,
    interpolate: (value: number, input: [number, number], output: [number, number]) => {
      const t = Math.min(Math.max((value - input[0]) / (input[1] - input[0]), 0), 1)
      return output[0] + (output[1] - output[0]) * t
    },
    Extrapolation: { CLAMP: 'clamp' }
  }
})

import { resetReducedMotionForTests } from '../ui/use-reduced-motion'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatAttachButton } from './MobileNativeChatAttachButton'
import { uploadMobileNativeChatImages } from './mobile-native-chat-image-attachment'

type Source = 'Camera' | 'Photos' | 'Files'

let renderer: ReactTestRenderer | null = null
/** What happened after the tap, in order. */
let log: string[] = []
/** What the system picker hands back: one photo, or nothing (the user backed out). */
let pickerReturns: PickedMobileImage[] = []

beforeEach(() => {
  clock.now = 0
  running.callbacks.clear()
  uploads.log = log = []
  pickerReturns = []
  resetReducedMotionForTests()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function sheetMounted(): boolean {
  return renderer!.root.findAll((node) => String(node.type) === 'Modal').length > 0
}

/** The chat's attach path past the picker, as `useMobileNativeChatImageUpload` drives it. */
function attach(source: Source) {
  return () =>
    void uploadMobileNativeChatImages(source === 'Camera' ? 'camera' : source === 'Photos' ? 'library' : 'files', {
      client: {} as never,
      getConnectionId: async () => null,
      pickImages: async function* () {
        log.push(sheetMounted() ? 'picker over the sheet' : 'picker')
        yield* pickerReturns
      },
      onImageStart: () => log.push('chip')
    })
}

function mount(scheme: 'light' | 'dark'): void {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatAttachButton
          iconButtonStyle={{}}
          disabled={false}
          onCaptureImage={attach('Camera')}
          onAttachImage={attach('Photos')}
          onAttachFile={attach('Files')}
          permissionMode="default"
        />
      </ThemeProvider>
    )
  })
}

function pressable(label: string): ReactTestInstance {
  return renderer!.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)
}

/** The + tap, with the window up and the sheet laid out, and its open run to rest. */
function openSheet(): void {
  act(() => (pressable('Add to chat').props.onPressIn as () => void)())
  const [modal] = renderer!.root.findAll((node) => String(node.type) === 'Modal')
  const [sheet] = renderer!.root.findAll((node) => node.props.testID === 'bottom-drawer-sheet')
  act(() => {
    ;(modal!.props.onShow as () => void)()
    ;(sheet!.props.onLayout as (event: unknown) => void)({
      nativeEvent: { layout: { x: 0, y: 0, width: 412, height: 280 } }
    })
  })
  clock.now += 1000
}

/** The UI thread reaching the end of every animation it is running. */
async function finishAnimations(): Promise<void> {
  clock.now += 1000
  await act(async () => {
    for (const entry of Array.from(running.callbacks)) {
      running.callbacks.delete(entry)
      entry.fire(true)
    }
  })
  // The picked photo's chip and upload settle on later microtasks.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Whether the sheet still takes touches: it gives them up the moment its close is asked for. */
function sheetTakesTouches(): boolean {
  return renderer!.root
    .findAll((node) => node.props.accessibilityViewIsModal !== undefined && node.props.pointerEvents !== undefined)
    .some((node) => node.props.pointerEvents === 'auto')
}

const photo: PickedMobileImage = { base64: 'aGVsbG8=', uri: 'file:///photo.jpg' }

describe.each(['light', 'dark'] as const)('the + sheet in %s mode', (scheme) => {
  it.each(['Camera', 'Photos', 'Files'] as const)(
    'has left the screen before %s opens its picker',
    async (source) => {
      pickerReturns = [photo]
      mount(scheme)
      openSheet()

      act(() => (pressable(source).props.onPress as () => void)())

      // The close is asked for at once, and nothing else starts yet.
      expect(sheetTakesTouches(), 'the sheet still took touches after the tap').toBe(false)
      expect(log, 'the picker launched while the sheet was still closing').toEqual([])
      expect(sheetMounted()).toBe(true)

      await finishAnimations()

      expect(sheetMounted(), 'the sheet stayed mounted after its exit ran').toBe(false)
      expect(log).toEqual(['picker', 'chip', 'upload'])
    }
  )

  it('leaves nothing behind when the picker is backed out of', async () => {
    pickerReturns = []
    mount(scheme)
    openSheet()

    act(() => (pressable('Photos').props.onPress as () => void)())
    await finishAnimations()

    expect(sheetMounted()).toBe(false)
    expect(log).toEqual(['picker'])
  })

  it('never opens the picker for a Photos tap the user took back by reopening the sheet', async () => {
    pickerReturns = [photo]
    mount(scheme)
    openSheet()

    act(() => (pressable('Photos').props.onPress as () => void)())
    // The + again, before the exit could finish: the sheet comes back instead.
    act(() => (pressable('Add to chat').props.onPressIn as () => void)())
    await finishAnimations()
    expect(sheetMounted()).toBe(true)
    expect(log).toEqual([])

    // Dismissed with a tap on the backdrop this time.
    const [backdrop] = renderer!.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === undefined && node.props.onPress
    )
    act(() => (backdrop!.props.onPress as () => void)())
    await finishAnimations()

    expect(sheetMounted()).toBe(false)
    expect(log, 'the abandoned Photos tap opened the picker on a later close').toEqual([])
  })
})
