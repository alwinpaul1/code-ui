import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Component, createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The markup editor against the Claude app's (com.anthropic.claude
// 1.261009.20 for the output, 1.261013.20 for the screen, decompiled
// 2026-10-11 and 2026-10-16):
//   - "Mark up image" (`image_markup_title`) names the screen for a screen
//     reader only; no title is drawn (xqh.java:85-93);
//   - while the picture is written, Close and Done give "Saving…"
//     (`image_markup_saving`) as their reason and the screen cannot be closed
//     (`goc(!saving, ..)`) nor drawn on;
//   - Done stays disabled until something is drawn (zqh.java:150);
//   - the floating bar fades out under a stroke and returns 400 ms after it
//     (`brh.a`, m7d case 11), unless a screen reader is on;
//   - an opaque source goes out as JPEG at quality 85, one with alpha as PNG
//     (`q130.r`, `fl.z`).
// Code UI keeps its own type sizes; the layout, colours and behaviour are the app's.

const pan = vi.hoisted(() => ({
  onStart: null as null | ((event: { x: number; y: number }) => void),
  onUpdate: null as null | ((event: { x: number; y: number }) => void),
  onEnd: null as null | (() => void)
}))
const svg = vi.hoisted(() => ({
  flatten: null as null | ((base64: string) => void),
  size: null as unknown,
  /** Set to make toDataURL throw instead of answering. */
  throws: null as null | Error
}))
const manipulator = vi.hoisted(() => ({ compress: [] as number[], formats: [] as string[] }))
const screenReader = vi.hoisted(() => ({ on: false }))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false),
    isScreenReaderEnabled: () => Promise.resolve(screenReader.on)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Image: { getSize: vi.fn() },
  Keyboard: { dismiss: () => {}, addListener: () => ({ remove: () => {} }), metrics: () => null },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StatusBar: 'StatusBar',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 400, height: 900 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain = {
    maxPointers: () => chain,
    enabled: () => chain,
    onStart: (handler: (event: { x: number; y: number }) => void) => {
      pan.onStart = handler
      return chain
    },
    onUpdate: (handler: (event: { x: number; y: number }) => void) => {
      pan.onUpdate = handler
      return chain
    },
    onEnd: (handler: () => void) => {
      pan.onEnd = handler
      return chain
    }
  }
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('react-native-reanimated', () => ({
  default: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
  useSharedValue: (initial: unknown) => ({ value: initial }),
  useAnimatedStyle: () => ({}),
  withTiming: (to: number) => to,
  runOnJS:
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args)
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 24, left: 0, right: 0 })
}))
// The factory runs before this file's imports are bound, so it takes React
// through importActual.
vi.mock('react-native-svg', async () => {
  const { Component: Base, createElement: element } = await vi.importActual<{
    Component: typeof Component
    createElement: typeof createElement
  }>('react')
  class Svg extends Base<{ children?: ReactNode }> {
    toDataURL(callback: (base64: string) => void, size: unknown): void {
      if (svg.throws) {
        throw svg.throws
      }
      svg.size = size
      svg.flatten = callback
    }
    render() {
      return element('Svg', this.props)
    }
  }
  const tag = (name: string) => (props: object) => element(name, props)
  return { default: Svg, Image: tag('SvgImage'), Path: tag('Path') }
})
vi.mock('expo-file-system', () => {
  class File {
    uri: string
    constructor(...parts: string[]) {
      this.uri = parts.join('')
    }
    create(): void {}
    write(): void {}
    delete(): void {}
    open(): never {
      throw new Error('no local file in this test')
    }
  }
  return { File, Paths: { cache: 'file:///cache/' } }
})
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: () => ({
      renderAsync: async () => ({
        saveAsync: async (options: { format: string; compress: number }) => {
          manipulator.formats.push(options.format)
          manipulator.compress.push(options.compress)
          return { uri: 'file:///cache/out.jpg', width: 48, height: 48, base64: 'SlBFRy1BVC04NQ==' }
        },
        release: () => {}
      }),
      release: () => {}
    })
  }
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))

import { ThemeProvider } from '../theme/theme-context'
import { openImageMarkup, peekImageMarkup, resetImageMarkupForTests, type ImageMarkupResult } from '../session/image-markup-store'
import { openImagePreview, peekImagePreview, resetImagePreviewForTests } from '../session/image-preview-store'
import { MobileImageMarkupEditor } from './MobileImageMarkupEditor'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../session/fixtures/markup', name)).toString('base64')
// Real `sips` output: a JPEG photo and an RGBA PNG screenshot, 48 and 32 px.
const OPAQUE_PHOTO = `data:image/jpeg;base64,${fixture('opaque-photo.jpg')}`
const ALPHA_SCREENSHOT = `data:image/png;base64,${fixture('screenshot-with-alpha.png')}`
const FLATTENED_PNG = 'UE5HLUZMQVRURU4='

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  resetImageMarkupForTests()
  pan.onStart = pan.onUpdate = pan.onEnd = null
  svg.flatten = null
  svg.size = null
  svg.throws = null
  manipulator.compress = []
  manipulator.formats = []
  screenReader.on = false
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function paths(): number {
  return renderer!.root.findAll((node) => (node.type as unknown) === 'Path').length
}

function texts(): string[] {
  return renderer!.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
}

function saysSaving(): boolean {
  return ['Close', 'Done'].every((label) => button(label).props.accessibilityValue?.text === 'Saving…')
}

function bar(): ReactTestInstance {
  return renderer!.root.find((node) => node.props.testID === 'markup-bar' && typeof node.type === 'string')
}

function glyph(name: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === name)
}

function button(label: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label)
}

async function openOn(
  uri: string,
  scheme: 'light' | 'dark',
  receive?: (result: ImageMarkupResult) => void
): Promise<ImageMarkupResult[]> {
  const done: ImageMarkupResult[] = []
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileImageMarkupEditor />
      </ThemeProvider>
    )
  })
  await act(async () =>
    openImageMarkup(uri, {
      onDone: (result) => {
        done.push(result)
        receive?.(result)
      }
    })
  )
  return done
}

async function drawAStroke(): Promise<void> {
  expect(pan.onStart, 'the canvas never drew: the picture size did not load').not.toBeNull()
  await act(async () => pan.onStart!({ x: 10, y: 10 }))
  await act(async () => pan.onUpdate!({ x: 40, y: 30 }))
  await act(async () => pan.onEnd!())
}

async function pressDone(): Promise<void> {
  await act(async () => button('Done').props.onPress())
}

async function finishFlatten(): Promise<void> {
  expect(svg.flatten, 'Done never asked the canvas for its picture').not.toBeNull()
  await act(async () => {
    svg.flatten!(FLATTENED_PNG)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe.each(['light', 'dark'] as const)('the markup editor, in %s mode', (scheme) => {
  it('names the screen "Mark up image" for a screen reader and draws no title, as the Claude app does', async () => {
    await openOn(OPAQUE_PHOTO, scheme)
    const screen = renderer!.root.find((node) => node.props.testID === 'markup-screen' && typeof node.type === 'string')
    expect(screen.props.accessibilityLabel).toBe('Mark up image')
    expect(texts()).not.toContain('Mark up image')
    expect(saysSaving()).toBe(false)
  })

  it('saves a marked-up JPEG photo as a JPEG at quality 85', async () => {
    const done = await openOn(OPAQUE_PHOTO, scheme)
    await drawAStroke()
    await pressDone()
    await finishFlatten()
    expect(manipulator.formats).toEqual(['jpeg'])
    expect(manipulator.compress).toEqual([0.85])
    expect(done).toEqual([{ base64: 'SlBFRy1BVC04NQ==', mimeType: 'image/jpeg' }])
  })

  it('saves a marked-up screenshot with alpha as the PNG the canvas flattened', async () => {
    const done = await openOn(ALPHA_SCREENSHOT, scheme)
    await drawAStroke()
    await pressDone()
    await finishFlatten()
    expect(manipulator.formats).toEqual([])
    expect(done).toEqual([{ base64: FLATTENED_PNG, mimeType: 'image/png' }])
  })

  it('says "Saving…" while the picture is written, and cannot be closed or drawn on meanwhile', async () => {
    const done = await openOn(OPAQUE_PHOTO, scheme)
    await drawAStroke()
    await pressDone()
    expect(saysSaving()).toBe(true)
    for (const label of ['Close', 'Undo', 'Redo', 'Done']) {
      expect(button(label).props.accessibilityState, label).toEqual({ disabled: true })
      expect(button(label).props.onPress, label).toBeUndefined()
    }
    const modal = renderer!.root.find((node) => (node.type as unknown) === 'Modal')
    await act(async () => modal.props.onRequestClose())
    expect(peekImageMarkup(), 'Back closed the editor while it saved').not.toBeNull()
    const drawnBefore = paths()
    await act(async () => pan.onStart!({ x: 50, y: 50 }))
    await act(async () => pan.onUpdate!({ x: 80, y: 90 }))
    expect(paths(), 'the pen drew while the picture was being written').toBe(drawnBefore)
    await act(async () => pan.onEnd!())
    expect(paths(), 'a stroke was committed while the picture was being written').toBe(drawnBefore)
    await finishFlatten()
    expect(done).toHaveLength(1)
    expect(peekImageMarkup()).toBeNull()
  })

  // The gesture's callbacks run on the UI thread with the closures of the
  // render they were built in. A drag that ends on its first sample sends its
  // start and its end before the canvas re-renders, so an end that read the
  // render's draft committed nothing and the dot was lost (Opus review).
  it('keeps a one-point drag as a dot when its end lands before the canvas re-renders', async () => {
    await openOn(OPAQUE_PHOTO, scheme)
    await act(async () => {
      pan.onStart!({ x: 30, y: 30 })
      pan.onEnd!()
    })
    expect(paths()).toBe(1)
    await act(async () => {
      pan.onStart!({ x: 10, y: 10 })
      pan.onUpdate!({ x: 20, y: 25 })
      pan.onUpdate!({ x: 35, y: 30 })
      pan.onEnd!()
    })
    expect(paths()).toBe(2)
    const last = renderer!.root.findAll((node) => (node.type as unknown) === 'Path').at(-1)!
    expect(String(last.props.d).match(/[MQL]/g)).toEqual(['M', 'Q', 'Q', 'L'])
  })

  // Saving holds Close and Back, so a flatten that never answers must not hold
  // them for good: the screen would be a full-window trap (Opus review).
  it('lets the editor be closed again when the flatten never answers, and ignores a late answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const done = await openOn(OPAQUE_PHOTO, scheme)
    await drawAStroke()
    vi.useFakeTimers()
    await pressDone()
    expect(saysSaving()).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(saysSaving()).toBe(false)
    expect(button('Close').props.accessibilityState).toEqual({ disabled: false })
    expect(button('Done').props.accessibilityState).toEqual({ disabled: false })
    expect(warn.mock.calls.some((call) => String(call[0]).includes('never answered'))).toBe(true)
    vi.useRealTimers()
    await finishFlatten()
    expect(done, 'a flatten that answered after the editor gave up on it was still sent').toEqual([])
    expect(peekImageMarkup()).not.toBeNull()
  })

  it('leaves Saving and says why when the flatten throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const done = await openOn(OPAQUE_PHOTO, scheme)
    await drawAStroke()
    svg.throws = new Error('bitmap allocation failed')
    await pressDone()
    expect(saysSaving()).toBe(false)
    expect(button('Close').props.accessibilityState).toEqual({ disabled: false })
    expect(warn.mock.calls.some((call) => String(call[0]).includes('bitmap allocation failed'))).toBe(true)
    expect(done).toEqual([])
  })

  it('leaves Saving and says why when whoever takes the picture throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await openOn(ALPHA_SCREENSHOT, scheme, () => {
      throw new Error('composer gone')
    })
    await drawAStroke()
    await pressDone()
    await finishFlatten()
    expect(saysSaving()).toBe(false)
    expect(warn.mock.calls.some((call) => String(call[0]).includes('composer gone'))).toBe(true)
  })

  // The flatten covers the canvas exactly: letterboxing the sub-pixel shape
  // difference of the rounded output size left a transparent strip, which a
  // JPEG turns black (Opus review).
  it('stretches the canvas onto the output size instead of letterboxing it', async () => {
    await openOn(OPAQUE_PHOTO, scheme)
    const canvas = renderer!.root.find((node) => (node.type as unknown) === 'Svg')
    expect(canvas.props.preserveAspectRatio).toBe('none')
  })

  // The Claude app's Done runs only with no stroke in progress. A Done tapped
  // by a second finger mid-drag flattened the half-drawn line, and the drag's
  // end then committed it while the picture was written (Opus re-review).
  it('waits for a stroke in progress before Done writes the picture', async () => {
    const done = await openOn(OPAQUE_PHOTO, scheme)
    await drawAStroke()
    await act(async () => {
      pan.onStart!({ x: 60, y: 60 })
      pan.onUpdate!({ x: 70, y: 80 })
    })
    await pressDone()
    expect(svg.flatten, 'Done flattened a half-drawn stroke').toBeNull()
    expect(saysSaving()).toBe(false)
    await act(async () => pan.onEnd!())
    expect(paths()).toBe(2)
    await pressDone()
    await finishFlatten()
    expect(done).toHaveLength(1)
  })

  it('keeps Done disabled until something is drawn, and again once every stroke is undone', async () => {
    const done = await openOn(OPAQUE_PHOTO, scheme)
    expect(button('Done').props.accessibilityState).toEqual({ disabled: true })
    expect(button('Done').props.onPress).toBeUndefined()
    expect(peekImageMarkup(), 'an empty Done closed the editor').not.toBeNull()
    await drawAStroke()
    expect(button('Done').props.accessibilityState).toEqual({ disabled: false })
    await act(async () => button('Undo').props.onPress())
    expect(button('Done').props.accessibilityState).toEqual({ disabled: true })
    expect(button('Redo').props.accessibilityState).toEqual({ disabled: false })
    expect(done).toEqual([])
  })

  it('fades the bar out under a stroke and brings it back 400 ms after the stroke ends', async () => {
    await openOn(OPAQUE_PHOTO, scheme)
    expect(bar().props.pointerEvents).toBe('box-none')
    vi.useFakeTimers()
    await act(async () => pan.onStart!({ x: 10, y: 10 }))
    expect(bar().props.pointerEvents, 'the bar stayed up under the pen').toBe('none')
    expect(bar().props.accessibilityElementsHidden).toBe(true)
    await act(async () => pan.onUpdate!({ x: 40, y: 30 }))
    await act(async () => pan.onEnd!())
    await act(async () => {
      vi.advanceTimersByTime(399)
    })
    expect(bar().props.pointerEvents, 'the bar came back before 400 ms').toBe('none')
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(bar().props.pointerEvents).toBe('box-none')
    expect(bar().props.accessibilityElementsHidden).toBe(false)
  })

  it('keeps the bar up under a stroke while a screen reader is on', async () => {
    screenReader.on = true
    await openOn(OPAQUE_PHOTO, scheme)
    await act(async () => pan.onStart!({ x: 10, y: 10 }))
    expect(bar().props.pointerEvents).toBe('box-none')
    await act(async () => pan.onEnd!())
  })

  it('draws the photo on black, with the bar in the Claude app\'s pill colours', async () => {
    const expected =
      scheme === 'light'
        ? { pill: '#F9F9F7', glyph: '#131313', off: 'rgba(19, 19, 19, 0.38)', done: '#C6613F', divider: 'rgba(30, 30, 29, 0.15)' }
        : { pill: '#151515', glyph: '#F9F9F7', off: 'rgba(249, 249, 247, 0.38)', done: '#D97757', divider: 'rgba(225, 224, 217, 0.15)' }
    await openOn(OPAQUE_PHOTO, scheme)
    const screen = renderer!.root.find((node) => node.props.testID === 'markup-screen' && typeof node.type === 'string')
    expect(screen.props.style.backgroundColor).toBe('#000000')
    expect(button('Close').props.style.backgroundColor).toBe(expected.pill)
    expect(button('Done').props.style.backgroundColor).toBe(expected.pill)
    const pill = renderer!.root.find((node) => node.props.testID === 'markup-undo-redo-pill' && typeof node.type === 'string')
    expect(pill.props.style.backgroundColor).toBe(expected.pill)
    const divider = renderer!.root.find((node) => node.props.testID === 'markup-undo-redo-divider' && typeof node.type === 'string')
    expect(divider.props.style).toMatchObject({ width: 1, height: 20, backgroundColor: expected.divider })
    expect(glyph('X').props.color).toBe(expected.glyph)
    expect(glyph('RotateCcw').props.color, 'undo with nothing to undo').toBe(expected.off)
    expect(glyph('Check').props.color, 'Done with nothing drawn').toBe(expected.off)
    await drawAStroke()
    expect(glyph('RotateCcw').props.color).toBe(expected.glyph)
    expect(glyph('Check').props.color, 'Done is clay once there is something to save').toBe(expected.done)
  })
})

// 2026-10-14: the editor sometimes never appeared after the preview's pencil, because the preview's
// Modal was dismissed in the same tick the editor's was shown. The pencil now leaves the preview up
// (ImagePreviewModal.test.tsx), and the editor closes it here, once its own window is on screen.
describe('opening from the full-screen preview', () => {
  afterEach(() => resetImagePreviewForTests())

  it('closes the preview it was opened over only once its own window has shown', async () => {
    openImagePreview('file:///a.png', 'a photo', 0, () => {})
    await openOn(OPAQUE_PHOTO, 'dark')
    const modal = renderer!.root.find((node) => (node.type as unknown) === 'Modal')
    expect(peekImagePreview()).not.toBeNull()

    await act(async () => modal.props.onShow())
    expect(peekImagePreview()).toBeNull()
    expect(peekImageMarkup()).not.toBeNull()
  })
})
