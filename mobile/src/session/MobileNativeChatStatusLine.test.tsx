import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { darkColors, lightColors, space } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'

const mocks = vi.hoisted(() => ({ reduced: true, loops: 0 }))

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    createAnimatedComponent: (c: unknown) => c,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => {
      mocks.loops += 1
      return { start: () => {}, stop: () => {} }
    },
    timing: () => ({}),
    sequence: () => ({})
  },
  Easing: { inOut: () => 0, quad: 0 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => mocks.reduced }))

type Drawn = { texts: string[]; colors: string[] }

describe('the status line above the composer', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    mocks.reduced = true
    mocks.loops = 0
  })

  function draw(args: {
    runningCount: number
    working: boolean
    spinner?: ClaudeSpinner | null
    scheme?: 'light' | 'dark'
  }): Drawn {
    act(() => {
      renderer?.unmount()
      renderer = create(
        <ThemeProvider initialPreference={args.scheme ?? 'light'}>
          {createElement(
            NativeChatTasksContext.Provider,
            { value: { runningCount: args.runningCount, openSheet: () => {} } },
            createElement(MobileNativeChatStatusLine, { working: args.working, spinner: args.spinner ?? null })
          )}
        </ThemeProvider>
      )
    })
    const texts: string[] = []
    const colors: string[] = []
    for (const node of renderer!.root.findAllByType('Text' as never)) {
      if (typeof node.props.children === 'string') {
        texts.push(node.props.children)
      }
      for (const entry of [node.props.style].flat()) {
        if (entry && typeof entry.color === 'string') {
          colors.push(entry.color)
        }
      }
    }
    return { texts, colors }
  }

  it('says "1 running task" for one and "2 running tasks" for two', () => {
    expect(draw({ runningCount: 1, working: false }).texts).toEqual(['1 running task'])
    expect(draw({ runningCount: 2, working: false }).texts).toEqual(['2 running tasks'])
  })

  it('stays away entirely when nothing runs and the agent is idle, as on a quiet Codex tab', () => {
    expect(draw({ runningCount: 0, working: false }).texts).toEqual([])
  })

  // 2026-09-25, the user: the line said "42s" once Claude's spinner showed a
  // time, where they wanted words. It says "Working", capital W, whatever the
  // spinner's verb or time, in the accent in both themes.
  it('says Working, never a time, while the agent works', () => {
    for (const spinner of [
      { verb: 'Computing', elapsed: null, thinking: null },
      { verb: 'Computing', elapsed: '42s', thinking: null },
      { verb: 'Computing', elapsed: '1m 16s', thinking: 'thinking some more' },
      null
    ]) {
      const texts = draw({ runningCount: 0, working: true, spinner }).texts
      expect(texts[0]).toBe('Working')
      expect(texts.join(' ')).not.toMatch(/\d+s\b|\dm\b/)
    }
  })

  it('says Working beside the running count', () => {
    expect(draw({ runningCount: 2, working: true, spinner: { verb: 'Cooking', elapsed: '5s', thinking: null } }).texts).toEqual([
      'Working',
      '·',
      '2 running tasks'
    ])
  })

  /** Each separator the line draws: a Text holding the dot and nothing else. */
  function separators() {
    return renderer!.root
      .findAllByType('Text' as never)
      .filter((node) => typeof node.props.children === 'string' && node.props.children.includes('·'))
  }

  function flatStyle(style: unknown): Record<string, unknown> {
    return Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>
  }

  // 2026-09-26, the user: "Working · 7 running tasks", with no ellipsis after
  // Working, and "Working and n running tasks must be separated with . And
  // small space". The line said "Working… · 7 running tasks", and on the phone
  // its ' · ' read as "Working…·7 running tasks": the font's spaces are a few
  // dp at label size, and the muted dot was faint.
  it('reads "Working · 7 running tasks": no ellipsis, and a dot of its own with an even space either side, in light and dark', () => {
    for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
      const drawn = draw({ runningCount: 7, working: true, spinner: null, scheme })
      expect(drawn.texts).toEqual(['Working', '·', '7 running tasks'])
      expect(drawn.texts.join(' ')).not.toContain('…')
      const [dot, ...rest] = separators()
      expect(rest).toHaveLength(0)
      // The dot alone: the space comes from the margin, not from space characters.
      expect(dot!.props.children).toBe('·')
      const style = flatStyle(dot!.props.style)
      expect(style.marginLeft ?? style.marginHorizontal).toBe(space.xs)
      expect(style.marginRight ?? style.marginHorizontal).toBe(space.xs)
      // Secondary, not muted: it has to read against the page in both themes.
      expect(style.color).toBe(palette.textSecondary)
      expect(contrastRatio(style.color as string, palette.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(style.color as string, palette.bg)).toBeGreaterThan(contrastRatio(palette.textMuted, palette.bg))
    }
  })

  it('separates the thinking status with the same dot', () => {
    const drawn = draw({ runningCount: 2, working: true, spinner: { verb: 'Cooking', elapsed: '1m 16s', thinking: 'thinking some more' } })
    expect(drawn.texts).toEqual(['Working', '·', '2 running tasks', '·', 'thinking some more…'])
    const [count, thinking] = separators()
    expect(thinking!.props.children).toBe('·')
    expect(flatStyle(thinking!.props.style)).toEqual(flatStyle(count!.props.style))
  })

  it('draws Working in the accent and the count in the link colour of whichever theme is on', () => {
    const spinner = { verb: 'Cooking', elapsed: null, thinking: null }
    const light = draw({ runningCount: 5, working: true, spinner, scheme: 'light' }).colors
    expect(light).toEqual(expect.arrayContaining([lightColors.accentText, lightColors.info]))
    const dark = draw({ runningCount: 5, working: true, spinner, scheme: 'dark' }).colors
    expect(dark).toEqual(expect.arrayContaining([darkColors.accentText, darkColors.info]))
    expect(dark).not.toContain(lightColors.info)
  })

  /** The star's own drawing: what the Svg is styled with, if anything. */
  function starStyle(): unknown {
    const star = renderer!.root.find((node) => node.props.testID === 'background-tasks-pulse')
    return star.findAllByType('Svg' as never)[0]?.props.style
  }

  // 2026-09-28, the user: "No breathing effect for claude logo in bg running task". The star
  // stood still beside "N running tasks" to match a 2026-09-26 recording of the Claude app; the
  // user wants it to breathe while background work runs, as it does beside Working.
  it('breathes the star beside the running-task count while background tasks run', () => {
    mocks.reduced = false
    const drawn = draw({ runningCount: 4, working: false })
    expect(drawn.texts).toEqual(['4 running tasks'])
    expect(mocks.loops).toBe(1)
    expect(starStyle()).toBeDefined()
  })

  it('keeps the star still beside the running-task count when motion is reduced', () => {
    mocks.reduced = true
    draw({ runningCount: 4, working: false })
    expect(mocks.loops).toBe(0)
    expect(starStyle()).toBeUndefined()
  })

  it('draws the still star in the accent of either theme', () => {
    mocks.reduced = false
    for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
      draw({ runningCount: 4, working: false, scheme })
      const path = renderer!.root.findAllByType('Path' as never)[0]
      expect(path?.props.fill).toBe(palette.accentText)
    }
  })

  // Not in the recording, which caught no working turn: the star beside
  // "Working" keeps the breath it had.
  it('still breathes the star beside Working', () => {
    mocks.reduced = false
    draw({ runningCount: 4, working: true, spinner: null })
    expect(mocks.loops).toBe(1)
    expect(starStyle()).toBeDefined()
  })
})
