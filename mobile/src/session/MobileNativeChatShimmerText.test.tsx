import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { SHIMMER_HALF_BAND, shimmerBandColor } from './mobile-native-chat-shimmer'
import { ChatRowOnScreenScope, createChatRowVisibility } from './native-chat-row-visibility'
import { ShimmerText } from './MobileNativeChatShimmerText'

const mocks = vi.hoisted(() => {
  const state = {
    reduced: false as boolean | null,
    /** Where the one shared phase stands for this render. */
    phase: 0,
    repeats: 0,
    cancels: 0,
    os: 'android',
    version: 34 as number | string,
    /** What AccessibilityInfo.isAccessibilityServiceEnabled answers. */
    serviceEnabled: Promise.resolve(false) as Promise<boolean>
  }
  const phase = {
    get value() {
      return state.phase
    },
    set value(_next: unknown) {}
  }
  return { state, phase }
})

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isAccessibilityServiceEnabled: () => mocks.state.serviceEnabled,
    addEventListener: () => ({ remove: () => undefined })
  },
  Platform: {
    get OS() {
      return mocks.state.os
    },
    get Version() {
      return mocks.state.version
    }
  },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-reanimated', () => ({
  default: { Text: 'AnimatedText' },
  Easing: { linear: (t: number) => t },
  useSharedValue: () => mocks.phase,
  useAnimatedStyle: <T,>(factory: () => T) => factory(),
  withTiming: (to: number) => to,
  withRepeat: (value: number) => {
    mocks.state.repeats += 1
    return value
  },
  cancelAnimation: () => {
    mocks.state.cancels += 1
  },
  // The worklet's own maths decides the weight; this only picks the end the
  // weight is nearer, which is all a render can show.
  interpolateColor: (value: number, _input: number[], output: string[]) =>
    value >= 0.5 ? output[1] : output[0]
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => mocks.state.reduced }))

const LABEL = 'Running agent'

/** The phase at which the band's centre sits on character `index`. */
function centredOn(index: number, count = LABEL.length): number {
  return (index + 0.5 + SHIMMER_HALF_BAND) / (count + 2 * SHIMMER_HALF_BAND)
}

type Glyph = { text: string; color: string | undefined }

function colorOf(style: unknown): string | undefined {
  let found: string | undefined
  for (const entry of [style].flat(3)) {
    if (entry && typeof (entry as { color?: unknown }).color === 'string') {
      found = (entry as { color: string }).color
    }
  }
  return found
}

describe('a running label with the Claude app shimmer', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    mocks.state.reduced = false
    mocks.state.phase = 0
    mocks.state.repeats = 0
    mocks.state.cancels = 0
    mocks.state.os = 'android'
    mocks.state.version = 34
    mocks.state.serviceEnabled = Promise.resolve(false)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function draw(args: {
    active?: boolean
    scheme?: 'light' | 'dark'
    visibility?: ReturnType<typeof createChatRowVisibility>
    index?: number
  } = {}) {
    const palette: ThemeColors = args.scheme === 'dark' ? darkColors : lightColors
    const label = (
      <ShimmerText
        text={LABEL}
        active={args.active ?? true}
        color={palette.textSecondary}
        style={{ fontSize: 13 }}
        numberOfLines={1}
        testID="running-label"
      />
    )
    const tree = (
      <ThemeProvider initialPreference={args.scheme ?? 'light'}>
        {args.visibility ? (
          <ChatRowOnScreenScope visibility={args.visibility} index={args.index ?? 0}>
            {label}
          </ChatRowOnScreenScope>
        ) : (
          label
        )}
      </ThemeProvider>
    )
    act(() => {
      if (renderer) {
        renderer.update(tree)
      } else {
        renderer = create(tree)
      }
    })
    return { tree: renderer!, palette }
  }

  function labelNode(tree: ReactTestRenderer) {
    return tree.root.find((node) => node.props.testID === 'running-label' && String(node.type) === 'Text')
  }

  function glyphs(tree: ReactTestRenderer): Glyph[] {
    return labelNode(tree)
      .findAll((node) => String(node.type) === 'AnimatedText')
      .map((node) => ({ text: String(node.props.children), color: colorOf(node.props.style) }))
  }

  it('draws the label one glyph at a time, in order, on one line', () => {
    const { tree } = draw()
    expect(glyphs(tree).map((glyph) => glyph.text).join('')).toBe(LABEL)
    expect(labelNode(tree).props.numberOfLines).toBe(1)
  })

  it('runs one loop for the whole label, not one per glyph', () => {
    draw()
    expect(mocks.state.repeats).toBe(1)
  })

  it('darkens the glyphs under the band and leaves the rest at the label colour, in dark mode', () => {
    mocks.state.phase = centredOn(4)
    const { tree, palette } = draw({ scheme: 'dark' })
    const band = shimmerBandColor(palette.textSecondary, palette.bg)
    const drawn = glyphs(tree)
    // Weight 1 at "i", 2/3 either side: the three glyphs nearest the centre.
    expect(drawn.slice(3, 6).map((glyph) => glyph.color)).toEqual([band, band, band])
    expect(drawn.slice(0, 3).every((glyph) => glyph.color === palette.textSecondary)).toBe(true)
    expect(drawn.slice(6).every((glyph) => glyph.color === palette.textSecondary)).toBe(true)
    expect(band).not.toBe(palette.textSecondary)
  })

  it('draws the same band toward the page in light mode, from the light palette', () => {
    mocks.state.phase = centredOn(9)
    const { tree, palette } = draw({ scheme: 'light' })
    const band = shimmerBandColor(palette.textSecondary, palette.bg)
    const drawn = glyphs(tree)
    expect(drawn[9]!.color).toBe(band)
    expect(drawn[0]!.color).toBe(lightColors.textSecondary)
    expect(drawn.map((glyph) => glyph.color)).not.toContain(darkColors.textSecondary)
    expect(drawn.map((glyph) => glyph.color)).not.toContain(shimmerBandColor(darkColors.textSecondary, darkColors.bg))
  })

  // "Remove animations" on: the label stands still, whole, in its own colour.
  it('draws the plain label and starts no loop when the OS reduces motion', () => {
    mocks.state.reduced = true
    const { tree, palette } = draw()
    expect(glyphs(tree)).toEqual([])
    expect(labelNode(tree).props.children).toBe(LABEL)
    expect(colorOf(labelNode(tree).props.style)).toBe(palette.textSecondary)
    expect(mocks.state.repeats).toBe(0)
  })

  it('holds still while the setting is not yet known, rather than flash motion at someone who asked for none', () => {
    mocks.state.reduced = null
    const { tree } = draw()
    expect(labelNode(tree).props.children).toBe(LABEL)
    expect(mocks.state.repeats).toBe(0)
  })

  it('stops the loop and settles to the plain label once the row has finished', () => {
    const { tree } = draw({ active: true })
    expect(glyphs(tree)).toHaveLength(LABEL.length)
    const cancelsBefore = mocks.state.cancels
    draw({ active: false })
    expect(labelNode(tree).props.children).toBe(LABEL)
    expect(mocks.state.cancels).toBeGreaterThan(cancelsBefore)
    expect(mocks.state.repeats).toBe(1)
  })

  // Code review of c03f5328: 40 steps a second, not a commit per display
  // frame. Two 120 Hz frames inside one step draw the same colours, here
  // across the moment the unstepped band would have tipped "n" into it.
  it('draws the same colours for two display frames inside one step of the sweep', () => {
    mocks.state.phase = 0.367
    const before = glyphs(draw().tree).map((glyph) => glyph.color)
    mocks.state.phase = 0.38
    const after = glyphs(draw().tree).map((glyph) => glyph.color)
    expect(after).toEqual(before)
    mocks.state.phase = 0.3843
    expect(glyphs(draw().tree).map((glyph) => glyph.color)).not.toEqual(before)
  })

  // Android 12 and older announce every setText to the nearest live-region
  // ancestor (TextView.setText, then View.notifyViewAccessibilityStateChangedIfNeeded
  // walking ViewGroup.notifySubtreeAccessibilityStateChanged up), so a sweep
  // under the row's polite live region would send TalkBack a content change
  // ten times a second. Android 13 and later drop a change that only recolours
  // spans (AccessibilityUtils.textOrSpanChanged).
  it('holds still on Android 12 while an accessibility service is on', async () => {
    mocks.state.version = 32
    mocks.state.serviceEnabled = Promise.resolve(true)
    const { tree } = draw()
    await act(async () => {
      await mocks.state.serviceEnabled
    })
    expect(labelNode(tree).props.children).toBe(LABEL)
    expect(mocks.state.repeats).toBe(0)
  })

  it('holds still on Android 12 until it knows whether a service is on, then sweeps when none is', async () => {
    mocks.state.version = 32
    let answer: (enabled: boolean) => void = () => undefined
    mocks.state.serviceEnabled = new Promise((resolve) => {
      answer = resolve
    })
    const { tree } = draw()
    expect(labelNode(tree).props.children).toBe(LABEL)
    expect(mocks.state.repeats).toBe(0)
    await act(async () => {
      answer(false)
      await mocks.state.serviceEnabled
    })
    expect(glyphs(tree)).toHaveLength(LABEL.length)
    expect(mocks.state.repeats).toBe(1)
  })

  it('sweeps on Android 13 and later with a service on, since a recolour sends no event there', async () => {
    mocks.state.version = 33
    mocks.state.serviceEnabled = Promise.resolve(true)
    const { tree } = draw()
    await act(async () => {
      await mocks.state.serviceEnabled
    })
    expect(glyphs(tree)).toHaveLength(LABEL.length)
  })

  it('does not animate a row scrolled off screen, and picks up again when it comes back', () => {
    const visibility = createChatRowVisibility()
    visibility.onViewableItemsChanged({
      viewableItems: [{ index: 0, isViewable: true, item: null, key: 'a', timestamp: 0 }],
      changed: []
    })
    const { tree } = draw({ visibility, index: 7 })
    expect(labelNode(tree).props.children).toBe(LABEL)
    expect(mocks.state.repeats).toBe(0)
    act(() =>
      visibility.onViewableItemsChanged({
        viewableItems: [{ index: 7, isViewable: true, item: null, key: 'b', timestamp: 0 }],
        changed: []
      })
    )
    expect(glyphs(tree)).toHaveLength(LABEL.length)
    expect(mocks.state.repeats).toBe(1)
  })
})
