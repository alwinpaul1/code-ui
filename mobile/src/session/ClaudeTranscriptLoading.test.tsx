import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { CLAWD_DANCING_FRAMES, CLAWD_DANCING_POSES } from './claude-clawd-dancing-frames'
import { CLAUDE_TRANSCRIPT_LOADING, clawdLayers, nextClawdFrame } from './claude-transcript-loading-spec'
import { ClaudeTranscriptLoading } from './ClaudeTranscriptLoading'

const motion = vi.hoisted(() => ({ reduced: false as boolean | null }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => motion.reduced }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement(name, props, children)
  return {
    Platform: { OS: 'android', select: (options: { android?: unknown; default?: unknown }) => options.android ?? options.default },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 400, height: 800, scale: 3, fontScale: 1 })
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

describe("Clawd, the Claude app's transcript loading mark", () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    motion.reduced = false
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function draw(scheme: 'light' | 'dark'): void {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <ClaudeTranscriptLoading />
        </ThemeProvider>
      )
    })
  }
  const drawnPaths = () =>
    renderer!.root.findAll((node) => node.type === ('Path' as never)).map((node) => node.props.d as string)
  const pathsOf = (frame: number) => clawdLayers(frame).map((layer) => layer.d)

  it("holds the app's 40 frames, 17 rows of 55 cells, in its own three colours", () => {
    expect(CLAWD_DANCING_FRAMES).toHaveLength(40)
    for (const pose of CLAWD_DANCING_POSES) {
      expect(pose).toHaveLength(CLAUDE_TRANSCRIPT_LOADING.rows)
      for (const row of pose) {
        expect(row).toMatch(/^[.odK]{55}$/)
      }
    }
  })

  it('dances frames 4 to 35 at 83 ms a frame, then loops back to 4, as the app does', () => {
    draw('light')
    expect(drawnPaths()).toEqual(pathsOf(4))
    const seen: number[] = []
    let frame = 4
    for (let step = 0; step < 33; step++) {
      act(() => {
        vi.advanceTimersByTime(83)
      })
      frame = nextClawdFrame(frame)
      seen.push(frame)
      expect(drawnPaths()).toEqual(pathsOf(frame))
    }
    expect(seen.slice(0, 31)).toEqual(Array.from({ length: 31 }, (_, i) => i + 5))
    expect(seen.slice(31)).toEqual([4, 5])
  })

  it.each([
    ['reduced motion is on', true],
    ['the OS has not answered yet', null]
  ] as const)('stands still on frame 0 while %s, as the app does with animators off', (_label, reduced) => {
    motion.reduced = reduced
    draw('light')
    expect(drawnPaths()).toEqual(pathsOf(0))
    act(() => {
      vi.advanceTimersByTime(83 * 10)
    })
    expect(drawnPaths()).toEqual(pathsOf(0))
  })

  it.each(SCHEMES)('draws its body, shade and eyes from the theme in %s', (scheme, colors) => {
    draw(scheme)
    // Frame 10 is a step of the dance with the shade column down his side (frame 4 has none).
    act(() => {
      vi.advanceTimersByTime(83 * 6)
    })
    expect(CLAWD_DANCING_POSES[CLAWD_DANCING_FRAMES[10]!]!.join('')).toContain('d')
    const fills = renderer!.root.findAll((node) => node.type === ('Path' as never)).map((node) => node.props.fill)
    expect(fills).toEqual([colors.clawdBody, colors.clawdShade, colors.clawdInk])
    // The app's palette is one fixed set (`tq7.b`) in both schemes.
    expect([colors.clawdBody, colors.clawdShade, colors.clawdInk]).toEqual(['#D97757', '#BE684D', '#141413'])
    const label = renderer!.root.find((node) => node.type === ('Text' as never))
    expect(label.props.children).toBe('Loading session…')
  })

  it('is 180 dp wide at the 55:17 aspect of the rows the app shows', () => {
    draw('light')
    const svg = renderer!.root.find((node) => node.type === ('Svg' as never))
    expect(svg.props.width).toBe(180)
    expect(svg.props.height).toBeCloseTo(55.636, 2)
    expect(svg.props.viewBox).toBe('0 0 55 17')
  })
})
