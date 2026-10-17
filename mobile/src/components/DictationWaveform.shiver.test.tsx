/**
 * The waveform shivered while dictating (user report and screen recording, 2026-10-17, 0.9.157:
 * "the waveform vibrates and shivers"). Measured on that recording at 120 fps: the scroll itself
 * was even (4.75 px per 60 Hz frame, every frame), but about every 300 ms two frames drew a third
 * to almost half of the bars off-centre — short bars up at the top of the row, tall ones cut flat
 * at the bottom edge.
 *
 * The cause: each bar's style set `height` (a layout prop) and `translateX`/`translateY` (a
 * transform) together. On Android, Reanimated 4.5.1 applies a transform straight to the view and
 * sends a layout prop through a shadow-tree commit (ReanimatedModuleProxy::partitionUpdates; the
 * commit is also deferred while React commits), so the two can land in different frames. Every
 * 60 ms each bar takes its neighbour's level, so every bar's height changes at once, and a frame
 * where the height lands apart from the offset centres the bars on the wrong heights.
 *
 * The Claude app draws all bars in one Canvas pass (1.261009.20, `r44` case 1), so position and
 * height can never disagree. Here: nothing a bar animates may be a layout prop.
 */
import { createElement, forwardRef, useEffect, useRef, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FrameInfo = { timestamp: number; timeSincePreviousFrame: number | null; timeSinceFirstFrame: number }
const recorded = vi.hoisted(() => ({
  registered: null as null | ((info: FrameInfo) => void),
  styles: [] as Record<string, unknown>[]
}))

vi.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'dark',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('react-native-reanimated', () => {
  const host = (tag: string) =>
    forwardRef<unknown, { children?: ReactNode }>((props, ref) => createElement(tag, { ...props, ref }))
  return {
    default: { View: host('View') },
    useSharedValue: <T,>(initial: T) => useRef({ value: initial }).current,
    useDerivedValue: <T,>(factory: () => T) => ({ value: factory() }),
    useAnimatedStyle: <T extends Record<string, unknown>>(factory: () => T) => {
      const style = factory()
      recorded.styles.push(style)
      return style
    },
    useFrameCallback: (callback: (info: FrameInfo) => void) => {
      useEffect(() => {
        recorded.registered = callback
        return () => {
          recorded.registered = null
        }
      }, [callback])
      return { setActive: () => undefined, isActive: true, callbackId: 1 }
    }
  }
})

import { ThemeProvider } from '../theme/theme-context'
import { DictationWaveform } from './DictationWaveform'
import { WAVEFORM_BAR_GAP, WAVEFORM_BAR_WIDTH, WAVEFORM_HEIGHT } from './dictation-waveform-geometry'

const PITCH = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP
const BARS = 30
const WIDTH = WAVEFORM_BAR_WIDTH + BARS * PITCH

/** Props Reanimated 4.5.1 on Android applies straight to the view, in the same pass
 *  (ReanimatedModuleProxy.cpp, `synchronousPropNames`). Anything else goes through a commit. */
const SAME_FRAME_PROPS = new Set(['opacity', 'transform', 'backgroundColor', 'borderRadius'])

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  recorded.registered = null
  recorded.styles = []
})

function element(scheme: 'light' | 'dark', level: number): React.JSX.Element {
  return (
    <ThemeProvider initialPreference={scheme}>
      <DictationWaveform level={level} />
    </ThemeProvider>
  )
}

async function speak(scheme: 'light' | 'dark'): Promise<ReactTestInstance> {
  await act(async () => {
    renderer = create(element(scheme, 0.5))
  })
  const box = renderer!.root.find((node) => node.props.testID === 'dictation-waveform' && typeof node.type === 'string')
  await act(async () => box.props.onLayout({ nativeEvent: { layout: { width: WIDTH, height: WAVEFORM_HEIGHT } } }))
  // Two seconds of 60 Hz frames over a changing voice, then a render so every style is read again.
  let t = 50_000
  for (let i = 0; i < 120; i++) {
    act(() => renderer!.update(element(scheme, i % 3 === 0 ? 0 : 0.2 + (i % 7) / 10)))
    recorded.registered!({ timestamp: t, timeSincePreviousFrame: 16.7, timeSinceFirstFrame: 0 })
    t += 16.7
  }
  recorded.styles = []
  act(() => renderer!.update(element(scheme, 0.6)))
  return renderer!.root.find((node) => node.props.testID === 'dictation-waveform' && typeof node.type === 'string')
}

/** The host views directly inside `node`, looking through function components. */
function hostChildren(node: ReactTestInstance): ReactTestInstance[] {
  return (node.children as (ReactTestInstance | string)[]).flatMap((child) =>
    typeof child === 'string' ? [] : typeof child.type === 'string' ? [child] : hostChildren(child)
  )
}

type Rect = { top: number; bottom: number }

/** The vertical extent a host view paints, from its static layout and its transform (scale about
 *  the view's centre, then translate — what RN does for `[translateY, scaleY]`). */
function paintedExtent(view: ReactTestInstance): Rect | null {
  const style = Object.assign({}, ...(view.props.style as object[]).flat()) as {
    top?: number
    height?: number
    backgroundColor?: string
    transform?: Record<string, number>[]
  }
  if (style.backgroundColor === undefined) {
    return null
  }
  const transform = Object.assign({}, ...(style.transform ?? [])) as { translateY?: number; scaleY?: number }
  const top = style.top ?? 0
  const height = (style.height ?? 0) * (transform.scaleY ?? 1)
  if (!(height > 0)) {
    return null
  }
  const centre = top + (style.height ?? 0) / 2 + (transform.translateY ?? 0)
  return { top: centre - height / 2, bottom: centre + height / 2 }
}

describe('the dictation waveform while speaking', () => {
  it.each(['light', 'dark'] as const)(
    'keeps every bar centred: no bar animates a layout prop that can land a frame apart from its position (%s)',
    async (scheme) => {
      await speak(scheme)
      expect(recorded.styles.length).toBeGreaterThan(0)
      for (const style of recorded.styles) {
        const layoutProps = Object.keys(style).filter((key) => !SAME_FRAME_PROPS.has(key))
        expect(layoutProps, JSON.stringify(style)).toEqual([])
      }
    }
  )

  it('still draws each bar as the Claude app does: its height, centred on the row', async () => {
    const box = await speak('dark')
    const bars = hostChildren(box)
    expect(bars).toHaveLength(BARS)
    let checked = 0
    for (const bar of bars) {
      const style = Object.assign({}, ...(bar.props.style as object[]).flat()) as { opacity?: number }
      if (style.opacity !== 1) {
        continue
      }
      const parts = bar
        .findAll((node) => typeof node.type === 'string' && node !== bar)
        .map(paintedExtent)
        .filter((rect): rect is Rect => rect !== null)
      expect(parts.length).toBeGreaterThan(0)
      const top = Math.min(...parts.map((p) => p.top))
      const bottom = Math.max(...parts.map((p) => p.bottom))
      // Centred on the row whatever its height.
      expect((top + bottom) / 2).toBeCloseTo(WAVEFORM_HEIGHT / 2, 5)
      expect(bottom - top).toBeLessThanOrEqual(WAVEFORM_HEIGHT + 1e-6)
      checked++
    }
    expect(checked).toBeGreaterThan(BARS / 2)
  })
})

