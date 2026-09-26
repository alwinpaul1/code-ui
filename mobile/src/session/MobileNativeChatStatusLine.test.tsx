import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
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
  // time, where they wanted words. It says "Working…", capital W, whatever the
  // spinner's verb or time, in the accent in both themes.
  it('says Working, never a time, while the agent works', () => {
    for (const spinner of [
      { verb: 'Computing', elapsed: null, thinking: null },
      { verb: 'Computing', elapsed: '42s', thinking: null },
      { verb: 'Computing', elapsed: '1m 16s', thinking: 'thinking some more' },
      null
    ]) {
      const texts = draw({ runningCount: 0, working: true, spinner }).texts
      expect(texts[0]).toBe('Working…')
      expect(texts.join(' ')).not.toMatch(/\d+s\b|\dm\b/)
    }
  })

  it('says Working beside the running count', () => {
    expect(draw({ runningCount: 2, working: true, spinner: { verb: 'Cooking', elapsed: '5s', thinking: null } }).texts).toEqual([
      'Working…',
      ' · ',
      '2 running tasks'
    ])
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

  // 2026-09-26, the user's recording of the Claude app, "4 running tasks" with
  // the turn over: the star kept one shape the whole 10.5 s, with no fade, no
  // scale and no turn, and the words never moved. The phone's star breathed.
  it('keeps the star still beside the running-task count once the turn is over', () => {
    mocks.reduced = false
    const drawn = draw({ runningCount: 4, working: false })
    expect(drawn.texts).toEqual(['4 running tasks'])
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
  // "Working…" keeps the breath it had.
  it('still breathes the star beside Working…', () => {
    mocks.reduced = false
    draw({ runningCount: 4, working: true, spinner: null })
    expect(mocks.loops).toBe(1)
    expect(starStyle()).toBeDefined()
  })
})
