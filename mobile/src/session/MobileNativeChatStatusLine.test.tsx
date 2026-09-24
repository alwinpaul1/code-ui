import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'
import type { ClaudeSpinner } from './mobile-terminal-spinner-line'

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Animated: {
    createAnimatedComponent: (c: unknown) => c,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
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
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

type Drawn = { texts: string[]; colors: string[] }

describe('the status line above the composer', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
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
        createElement(
          ThemeProvider,
          { initialPreference: args.scheme ?? 'light' },
          createElement(
            NativeChatTasksContext.Provider,
            { value: { runningCount: args.runningCount, openSheet: () => {} } },
            createElement(MobileNativeChatStatusLine, { working: args.working, spinner: args.spinner ?? null })
          )
        )
      )
    })
    const texts: string[] = []
    const colors: string[] = []
    for (const node of renderer!.root.findAllByType('Text')) {
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

  it('says the verb alone while the agent works with nothing in the background', () => {
    expect(draw({ runningCount: 0, working: true, spinner: { verb: 'Computing', elapsed: null, thinking: null } }).texts).toEqual([
      'Computing…'
    ])
  })

  it('draws the verb in the accent and the count in the link colour of whichever theme is on', () => {
    const spinner = { verb: 'Cooking', elapsed: null, thinking: null }
    const light = draw({ runningCount: 5, working: true, spinner, scheme: 'light' }).colors
    expect(light).toEqual(expect.arrayContaining([lightColors.accentText, lightColors.info]))
    const dark = draw({ runningCount: 5, working: true, spinner, scheme: 'dark' }).colors
    expect(dark).toEqual(expect.arrayContaining([darkColors.accentText, darkColors.info]))
    expect(dark).not.toContain(lightColors.info)
  })
})
