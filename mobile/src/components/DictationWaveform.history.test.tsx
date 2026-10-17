/**
 * The waveform's history survives the screen re-rendering (device, 0.9.143, 2026-10-14: "the
 * waveform doesn't flow nicely, it gets starting again"). Every word of the live caption re-renders
 * the composer, and Reanimated's useFrameCallback re-registers a callback whose identity changed,
 * which restarts its `timeSinceFirstFrame` at 0. The waveform's clock rode that value, so each
 * re-render sent the clock back to 0 under a history stamped minutes ahead: a few bars, then a
 * reset. The Claude app's clock is the system's (w330.a: `SystemClock.elapsedRealtime`).
 *
 * This file swaps in a Reanimated stand-in that keeps shared values across renders and registers
 * frame callbacks the way Reanimated 4.5.1 does (src/hook/useFrameCallback.ts: an effect keyed on
 * the callback, src/frameCallback/FrameCallbackRegistryUI.ts: `startTime` reset on registration).
 */
import { createElement, forwardRef, useEffect, useRef, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FrameInfo = { timestamp: number; timeSincePreviousFrame: number | null; timeSinceFirstFrame: number }
const frames = vi.hoisted(() => ({
  registered: null as null | { callback: (info: FrameInfo) => void; startTime: number | null },
  registrations: 0
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
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    useFrameCallback: (callback: (info: FrameInfo) => void) => {
      useEffect(() => {
        frames.registered = { callback, startTime: null }
        frames.registrations += 1
        return () => {
          frames.registered = null
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
const BARS = 40
const WIDTH = WAVEFORM_BAR_WIDTH + BARS * PITCH

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  frames.registered = null
  frames.registrations = 0
})

function element(level: number): React.JSX.Element {
  return (
    <ThemeProvider initialPreference="dark">
      <DictationWaveform level={level} />
    </ThemeProvider>
  )
}

/** One display frame at `timestamp` ms, as Reanimated's UI registry hands it over. */
function frame(timestamp: number): void {
  const entry = frames.registered!
  if (entry.startTime === null) {
    entry.startTime = timestamp
  }
  entry.callback({ timestamp, timeSincePreviousFrame: 16, timeSinceFirstFrame: timestamp - entry.startTime })
}

/** The bars drawn now (opacity 1), after a render so the styles are read again. */
function drawn(level: number): number {
  act(() => renderer!.update(element(level)))
  const box = renderer!.root.find((node) => node.props.testID === 'dictation-waveform' && typeof node.type === 'string')
  return box
    .findAll((node: ReactTestInstance) => typeof node.type === 'string' && node !== box)
    .filter((bar) => {
      const style = Object.assign({}, ...(bar.props.style as object[])) as { opacity?: number; height?: number }
      return style.opacity === 1
    }).length
}

async function mount(): Promise<void> {
  await act(async () => {
    renderer = create(element(0.5))
  })
  const box = renderer!.root.find((node) => node.props.testID === 'dictation-waveform' && typeof node.type === 'string')
  await act(async () => box.props.onLayout({ nativeEvent: { layout: { width: WIDTH, height: WAVEFORM_HEIGHT } } }))
}

describe('the dictation waveform’s history across re-renders', () => {
  it('keeps growing while the screen re-renders, and never starts again mid-take', async () => {
    await mount()
    let t = 100_000
    let previous = 0
    // 1.2 s of frames, the screen re-rendering every 120 ms (a caption word, a level change).
    for (let step = 0; step < 10; step++) {
      for (let i = 0; i < 8; i++) {
        frame(t)
        t += 15
      }
      const now = drawn(step % 2 === 0 ? 0.4 : 0.6)
      expect(now, `after ${step + 1} re-renders`).toBeGreaterThanOrEqual(previous)
      previous = now
    }
    // About 1.2 s at a bar per 60 ms: some 20 slots, less the newest bar still at the edge.
    expect(previous).toBeGreaterThanOrEqual(17)
    // The re-renders did re-register the frame callback: the test reproduces the device.
    expect(frames.registrations).toBeGreaterThan(1)
  })

  it('fills the row and then scrolls: the row stays full, it does not empty out', async () => {
    await mount()
    let t = 5_000
    for (let i = 0; i < 400; i++) {
      frame(t)
      t += 16
      if (i % 25 === 0) {
        drawn(0.5)
      }
    }
    // 6.4 s of history against a 40-bar row: every slot has a sample.
    expect(drawn(0.5)).toBe(BARS)
  })

  it('starts empty again for a new take (a new mount)', async () => {
    await mount()
    let t = 1_000
    for (let i = 0; i < 100; i++) {
      frame(t)
      t += 16
    }
    expect(drawn(0.5)).toBeGreaterThan(10)
    act(() => renderer?.unmount())
    renderer = null
    await mount()
    frame(t)
    expect(drawn(0.5)).toBeLessThanOrEqual(1)
  })
})
