import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Component, createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The markup editor's Done, against the Claude app's (com.anthropic.claude
// 1.261009.20, decompiled 2026-10-11):
//   - the title bar reads "Mark up image" (`image_markup_title`);
//   - while the picture is written it adds "Saving…" (`image_markup_saving`)
//     and the screen cannot be closed (`gic(!saving, ..)`) nor drawn on;
//   - an opaque source goes out as JPEG at quality 85, one with alpha as PNG
//     (`q130.r`, `fl.z`).
// Code UI keeps its own bar, colours and sizes; only the behaviour is copied.

const pan = vi.hoisted(() => ({
  onStart: null as null | ((event: { x: number; y: number }) => void),
  onUpdate: null as null | ((event: { x: number; y: number }) => void),
  onEnd: null as null | (() => void)
}))
const svg = vi.hoisted(() => ({
  flatten: null as null | ((base64: string) => void),
  size: null as unknown
}))
const manipulator = vi.hoisted(() => ({ compress: [] as number[], formats: [] as string[] }))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
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
  manipulator.compress = []
  manipulator.formats = []
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function texts(): string[] {
  return renderer!.root
    .findAll((node) => (node.type as unknown) === 'Text')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
}

function button(label: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label)
}

async function openOn(uri: string, scheme: 'light' | 'dark'): Promise<ImageMarkupResult[]> {
  const done: ImageMarkupResult[] = []
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileImageMarkupEditor />
      </ThemeProvider>
    )
  })
  await act(async () => openImageMarkup(uri, { onDone: (result) => done.push(result) }))
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
  it('is titled "Mark up image", as the Claude app titles it', async () => {
    await openOn(OPAQUE_PHOTO, scheme)
    expect(texts()).toContain('Mark up image')
    expect(texts()).not.toContain('Saving…')
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
    expect(texts()).toContain('Mark up image')
    expect(texts()).toContain('Saving…')
    for (const label of ['Close', 'Undo', 'Done']) {
      expect(button(label).props.accessibilityState, label).toEqual({ disabled: true })
      expect(button(label).props.onPress, label).toBeUndefined()
    }
    const modal = renderer!.root.find((node) => (node.type as unknown) === 'Modal')
    await act(async () => modal.props.onRequestClose())
    expect(peekImageMarkup(), 'Back closed the editor while it saved').not.toBeNull()
    await act(async () => pan.onStart!({ x: 50, y: 50 }))
    await act(async () => pan.onEnd!())
    await finishFlatten()
    expect(done).toHaveLength(1)
    expect(peekImageMarkup()).toBeNull()
  })
})
