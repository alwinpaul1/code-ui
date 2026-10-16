import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'
import type { ClaudeFooterStats } from './claude-working-footer-stats'

// 2026-10-16, from the device: "In between each component there should square shaped dot exactly
// square shaped see from claude mobile app". The app's " · " is set in its own font, whose middle
// dot is a square; ours was the same character in Instrument Sans, where it is round. The line now
// draws the dot itself: a square in the text's colour, a space's width either side.

const mocks = vi.hoisted(() => ({ stats: null as ClaudeFooterStats | null }))

vi.mock('react-native', () => ({
  Animated: {
    View: 'AnimatedView',
    Value: class {
      setValue() {}
      interpolate() {
        return 0
      }
    },
    timing: () => ({ start: () => {}, stop: () => {} }),
    spring: () => ({ start: () => {}, stop: () => {} }),
    parallel: () => ({ start: () => {}, stop: () => {} })
  },
  Easing: { out: () => 0, in: () => 0, quad: 0, cubic: 0 },
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', G: 'G' }))
vi.mock('./use-claude-footer-stats', () => ({ useClaudeFooterStats: () => mocks.stats }))

const LIGHT = { link: '#184F95', clay: '#C6613F', body: '#7B7974' }
const DARK = { link: '#6DA7EC', clay: '#D97757', body: '#97958D' }

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  mocks.stats = null
})

function draw(scheme: 'light' | 'dark', working: boolean, runningCount: number): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(
          NativeChatTasksContext.Provider,
          { value: { runningCount, openSheet: () => {} } },
          createElement(MobileNativeChatStatusLine, { working })
        )}
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const dots = (root: ReactTestInstance) => root.findAll((n) => n.props.testID === 'claude-footer-separator' && (n.type as unknown) === 'View')
const roundGlyphs = (root: ReactTestInstance) =>
  root.findAll((n) => (n.type as unknown) === 'Text' && typeof n.props.children === 'string' && n.props.children.includes('·'))

describe('the working footer’s separators', () => {
  for (const [scheme, want] of [
    ['light', LIGHT],
    ['dark', DARK]
  ] as const) {
    it(`are square dots, not the font’s round middle dot, between the verb and the count (${scheme})`, () => {
      const root = draw(scheme, true, 2)
      expect(roundGlyphs(root)).toHaveLength(0)
      expect(dots(root)).toHaveLength(1)
      const style = flat(dots(root)[0]!.props.style)
      expect(style.width).toBe(style.height)
      expect(style.width).toBeGreaterThan(0)
      expect(style.borderRadius ?? 0).toBe(0)
      // In the line's own colour: the clay beside a verb.
      expect(style.backgroundColor).toBe(want.clay)
      // A space's width either side, as " · " had.
      expect(style.marginHorizontal).toBeGreaterThan(0)
    })

    it(`are square between every part of "29s · 1,234 tokens · 2 running tasks · thought for 1s" (${scheme})`, () => {
      mocks.stats = { stats: '29s · 1,234 tokens', status: 'thought for 1s' }
      const root = draw(scheme, true, 2)
      expect(roundGlyphs(root)).toHaveLength(0)
      expect(dots(root)).toHaveLength(3)
      for (const dot of dots(root)) {
        expect(flat(dot.props.style).backgroundColor).toBe(want.body)
      }
      const words = root
        .findAll((n) => (n.type as unknown) === 'Text' && typeof n.props.children === 'string')
        .map((n) => n.props.children as string)
        .join('')
      expect(words).toContain('29s')
      expect(words).toContain('tokens')
      expect(words).toContain('thought for 1s')
    })
  }

  it('draws no dot where nothing follows: an idle count alone, or a verb with no tasks', () => {
    expect(dots(draw('light', false, 3))).toHaveLength(0)
    act(() => renderer?.unmount())
    expect(dots(draw('light', true, 0))).toHaveLength(0)
  })
})

// 2026-10-16, from the device beside the Claude app: "make the font in the footer bit more bold".
// The app's "Clauding… · 3 running tasks" reads a step heavier than its line of body text; ours
// was the regular face. Every word on the line, verb, figures and count, is the medium face.
describe('the working footer’s words', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`are a step bolder than body text (${scheme})`, () => {
      mocks.stats = { stats: '29s · 1,234 tokens', status: 'thought for 1s' }
      const root = draw(scheme, true, 2)
      const texts = root.findAll((n) => (n.type as unknown) === 'Text' && typeof n.props.children === 'string')
      expect(texts.length).toBeGreaterThan(0)
      for (const node of texts) {
        expect(flat(node.props.style).fontFamily).toBe('InstrumentSans_500Medium')
      }
    })
  }
})
