import { createElement, type ComponentType, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// The Claude app's turn edits card (1.261009.20, bv20.java:2259): the rows
// past the first three come in on `expandVertically` plus `fadeIn`, each a
// 250 ms tween on cubic-bezier(0.4, 0, 0.2, 1), and leave on no transition at
// all (`ExitTransition.None`). Ours snapped open.

const seen = vi.hoisted(() => ({
  timings: [] as { to: number; config: { duration?: number; easing?: unknown } | undefined }[],
  reduced: false as boolean | null
}))

vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: () => null
}))
vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: unknown }) =>
      React.createElement(name, props, children as ReactNode)
  return {
    Animated: {
      View: host('View'),
      Text: host('Text'),
      Value: class {
        constructor(private value: number) {}
        setValue(next: number): void {
          this.value = next
        }
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Platform: { OS: 'android', Version: 34 },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('./MobileNativeChatDiffCard', () => ({
  MobileNativeChatDiffCard: 'DiffCard',
  MAX_DIFF_CARD_ROWS: 200
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => seen.reduced }))
// The repo's stand-in (src/test/react-native-reanimated-mock.ts), which lands values at once and reads a
// style at render, with every tween recorded.
vi.mock('react-native-reanimated', async (importOriginal) => {
  const React = await import('react')
  return {
    ...(await importOriginal<typeof import('react-native-reanimated')>()),
    // The stand-in's value is born again on every render; this one is kept, as a real one is.
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    withTiming: (to: number, config?: { duration?: number; easing?: unknown }) => {
      seen.timings.push({ to, config })
      return to
    }
  }
})

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { claudeEase, TURN_EDITS_EXPAND_MS } from './claude-motion-spec'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import type { TurnEditedFile } from './mobile-native-chat-turn-edits'

const Themed = ThemeProvider as unknown as ComponentType<{
  initialPreference: 'light' | 'dark'
  children?: ReactNode
}>
const REPLY: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Done.' }],
  timestamp: null,
  source: 'transcript'
}

const file = (name: string): TurnEditedFile => ({
  path: `/w/${name}`,
  created: false,
  stat: { added: 1, removed: 0 },
  changes: []
})
const FIVE = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map(file)
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null

function tree(files: TurnEditedFile[], scheme: 'light' | 'dark') {
  return createElement(
    Themed,
    { initialPreference: scheme },
    createElement(MobileNativeChatMessage, { message: REPLY, endsTurn: true, turnEdits: files })
  )
}
function render(files: TurnEditedFile[], scheme: 'light' | 'dark' = 'light'): ReactTestInstance {
  act(() => {
    renderer = create(tree(files, scheme))
  })
  return renderer!.root
}
/** Draw again, so a style that read a value the effect has just set picks it up. The row is
 *  memoised, so the list is a new one. */
function redraw(files: TurnEditedFile[], scheme: 'light' | 'dark' = 'light'): void {
  act(() => renderer!.update(tree([...files], scheme)))
}

const fileRows = (root: ReactTestInstance) =>
  root.findAll((node) => node.props.testID === 'turn-edits-file' && typeof node.type === 'string')
const expansion = (root: ReactTestInstance) =>
  root.findAll((node) => node.props.testID === 'turn-edits-expand' && typeof node.type === 'string')
const measure = (root: ReactTestInstance) =>
  root.findAll(
    (node) => node.props.testID === 'turn-edits-expand-content' && typeof node.type === 'string'
  )
const button = (root: ReactTestInstance, label: string) =>
  root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  )[0]!

beforeEach(() => {
  seen.timings.length = 0
  seen.reduced = false
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as const)('the rows "Show more" reveals, in a %s session', (scheme, palette) => {
  it('keeps the first three rows outside the expansion and puts only the rest in it', () => {
    const root = render(FIVE, scheme)
    expect(fileRows(root)).toHaveLength(3)
    expect(expansion(root)).toHaveLength(0)
    act(() => button(root, 'Show 2 more').props.onPress())
    expect(fileRows(root)).toHaveLength(5)
    const [grown] = expansion(root)
    expect(
      grown!.findAll(
        (node) => node.props.testID === 'turn-edits-file' && typeof node.type === 'string'
      )
    ).toHaveLength(2)
  })

  it('takes no height and no alpha until the rows are measured, so they never flash at full size', () => {
    const root = render(FIVE, scheme)
    act(() => button(root, 'Show 2 more').props.onPress())
    expect(flat(expansion(root)[0]!.props.style)).toMatchObject({
      height: 0,
      opacity: 0,
      overflow: 'hidden'
    })
    expect(seen.timings).toEqual([])
  })

  it('grows to the measured height and fades in over 250 ms on the Claude curve', () => {
    const root = render(FIVE, scheme)
    act(() => button(root, 'Show 2 more').props.onPress())
    act(() => measure(root)[0]!.props.onLayout({ nativeEvent: { layout: { height: 96 } } }))
    expect(seen.timings).toEqual([
      { to: 1, config: { duration: TURN_EDITS_EXPAND_MS, easing: claudeEase } }
    ])
    expect(TURN_EDITS_EXPAND_MS).toBe(250)
    redraw(FIVE, scheme)
    expect(flat(expansion(root)[0]!.props.style)).toMatchObject({ height: 96, opacity: 1 })
  })

  it('keeps the rows’ own hairlines from the theme', () => {
    const root = render(FIVE, scheme)
    act(() => button(root, 'Show 2 more').props.onPress())
    for (const row of fileRows(root)) {
      expect(flat(row.props.style).borderTopColor).toBe(palette.border)
    }
  })

  it('takes the rows away at once on Show less, with no exit tween', () => {
    const root = render(FIVE, scheme)
    act(() => button(root, 'Show 2 more').props.onPress())
    act(() => measure(root)[0]!.props.onLayout({ nativeEvent: { layout: { height: 96 } } }))
    seen.timings.length = 0
    act(() => button(root, 'Show less').props.onPress())
    expect(fileRows(root)).toHaveLength(3)
    expect(expansion(root)).toHaveLength(0)
    expect(seen.timings).toEqual([])
  })

  it('plays again when the rows are shown a second time', () => {
    const root = render(FIVE, scheme)
    act(() => button(root, 'Show 2 more').props.onPress())
    act(() => measure(root)[0]!.props.onLayout({ nativeEvent: { layout: { height: 96 } } }))
    act(() => button(root, 'Show less').props.onPress())
    act(() => button(root, 'Show 2 more').props.onPress())
    act(() => measure(root)[0]!.props.onLayout({ nativeEvent: { layout: { height: 96 } } }))
    expect(seen.timings).toHaveLength(2)
  })
})

describe('a card the list recycles for another turn', () => {
  it('measures the other rows afresh instead of keeping the height of the last ones', () => {
    const root = render(FIVE)
    act(() => button(root, 'Show 2 more').props.onPress())
    act(() => measure(root)[0]!.props.onLayout({ nativeEvent: { layout: { height: 96 } } }))
    redraw(FIVE)
    expect(flat(expansion(root)[0]!.props.style).height).toBe(96)
    // The same cell, now holding a turn of seven files: the open state stays, the measure does not.
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => file(`${name}.ts`))
    act(() => renderer!.update(tree(seven, 'light')))
    expect(fileRows(root)).toHaveLength(7)
    expect(flat(expansion(root)[0]!.props.style)).toMatchObject({ height: 0, opacity: 0 })
  })
})

describe('the expansion at its edges', () => {
  it('animates the one row of a four-file turn', () => {
    const root = render(['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(file))
    act(() => button(root, 'Show 1 more').props.onPress())
    expect(fileRows(root)).toHaveLength(4)
    expect(expansion(root)).toHaveLength(1)
  })

  it('draws no expansion, and no button, for a turn of exactly three files', () => {
    const root = render(['a.ts', 'b.ts', 'c.ts'].map(file))
    expect(expansion(root)).toHaveLength(0)
    expect(
      root.findAll((node) => String(node.props.accessibilityLabel ?? '').startsWith('Show '))
    ).toHaveLength(0)
  })

  it('draws no expansion for a single file', () => {
    const root = render([file('only.ts')])
    expect(expansion(root)).toHaveLength(0)
  })

  // An entrance does not wait for the OS to answer (use-reduced-motion.ts): a tap that opens the
  // rows is the user's own act, and holding it back would feel like a dead button.
  it('plays while the OS has not said yet whether motion is reduced', () => {
    seen.reduced = null
    const root = render(FIVE)
    act(() => button(root, 'Show 2 more').props.onPress())
    act(() => measure(root)[0]!.props.onLayout({ nativeEvent: { layout: { height: 96 } } }))
    expect(seen.timings).toHaveLength(1)
  })

  it('opens at once with no tween while reduced motion is on', () => {
    seen.reduced = true
    const root = render(FIVE)
    act(() => button(root, 'Show 2 more').props.onPress())
    expect(fileRows(root)).toHaveLength(5)
    expect(seen.timings).toEqual([])
    const style = flat(expansion(root)[0]?.props.style)
    expect(style.height).toBeUndefined()
    expect(style.opacity).toBeUndefined()
  })
})
