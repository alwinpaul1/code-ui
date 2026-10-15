import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'
import { NativeChatConnectionNoticeContext } from './native-chat-connection-notice'
import { CLAUDE_WORKING_VERBS } from './claude-working-footer-spec'

/**
 * The line above the composer, drawn as the Claude app draws it (com.anthropic.claude
 * 1.261009.20, `nl7.b` and `au8`, read 2026-10-15). The user's screenshot of a session with
 * background tasks showed a plain "3 running tasks" in link blue, with no star and no word
 * "Working"; ours drew "Working · 3 running tasks" with a breathing starburst.
 *
 * Where the Claude app's footer text comes from, so the next release can be re-checked:
 * `nl7.java:263` (idle: the count alone, link colour `ad5.C0()`), `nl7.java:246` (working: a
 * cycling verb), `nl7.java:205` and `:215` (the count after a " · ").
 */

const mocks = vi.hoisted(() => ({ reduced: false as boolean | null }))

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => mocks.reduced }))

const LIGHT = { link: '#184F95', clay: '#C6613F', body: '#7B7974' }
const DARK = { link: '#6DA7EC', clay: '#D97757', body: '#97958D' }

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>
}

describe('the status line above the composer, as the Claude app draws it', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.reduced = false
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function draw(args: { runningCount: number; working: boolean; scheme?: 'light' | 'dark'; openSheet?: () => void }) {
    act(() => {
      renderer?.unmount()
      renderer = create(
        <ThemeProvider initialPreference={args.scheme ?? 'light'}>
          {createElement(
            NativeChatTasksContext.Provider,
            { value: { runningCount: args.runningCount, openSheet: args.openSheet ?? (() => {}) } },
            createElement(MobileNativeChatStatusLine, { working: args.working, spinner: null })
          )}
        </ThemeProvider>
      )
    })
    return renderer!.root
  }

  function texts(root: ReactTestInstance): string[] {
    return root
      .findAllByType('Text' as never)
      .map((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string')
  }

  const star = (root: ReactTestInstance) => root.findAll((n) => n.props.testID === 'claude-spinner-sprite')
  const oldStar = (root: ReactTestInstance) => root.findAll((n) => n.props.testID === 'background-tasks-pulse')

  // The headline.
  it('a working session shows "N running tasks" and the Claude spinner, not the Working star', () => {
    // The app's own verb list holds "Working" (claude-working-footer-spec.ts), so the random pick is
    // pinned to it: the old static "Working" label is what must be gone, not the word (a gate run on
    // 2026-10-15 drew "Working..." by chance and failed a `not.toContain('Working')` on the joined line).
    vi.spyOn(Math, 'random').mockReturnValue(CLAUDE_WORKING_VERBS.indexOf('Working') / CLAUDE_WORKING_VERBS.length)
    const root = draw({ runningCount: 3, working: true })
    const all = texts(root)
    expect(all.join('')).toMatch(/^[A-Za-z]+\.\.\. · 3 running tasks$/)
    expect(all.join('')).toBe('Working... · 3 running tasks')
    expect(all).not.toContain('Working')
    expect(oldStar(root)).toHaveLength(0)
    expect(star(root).length).toBeGreaterThan(0)
  })

  it('an idle session with background tasks is the count alone, in link blue, with no star and no Working', () => {
    const root = draw({ runningCount: 3, working: false })
    expect(texts(root)).toEqual(['3 running tasks'])
    expect(star(root)).toHaveLength(0)
    expect(oldStar(root)).toHaveLength(0)
  })

  it('says "1 running task" for one and "2 running tasks" for two', () => {
    expect(texts(draw({ runningCount: 1, working: false }))).toEqual(['1 running task'])
    expect(texts(draw({ runningCount: 2, working: false }))).toEqual(['2 running tasks'])
  })

  it('draws nothing when nothing runs and the agent is idle', () => {
    expect(texts(draw({ runningCount: 0, working: false }))).toEqual([])
    expect(renderer!.toJSON()).toBeNull()
  })

  it('working with no tasks shows the spinner and a verb, and no count and no separator', () => {
    const root = draw({ runningCount: 0, working: true })
    expect(texts(root)).toHaveLength(1)
    expect(texts(root)[0]).toMatch(/^[A-Za-z]+\.\.\.$/)
    expect(star(root).length).toBeGreaterThan(0)
  })

  it('draws the count in the link colour and the verb in the clay accent of whichever theme is on', () => {
    for (const [scheme, want] of [
      ['light', LIGHT],
      ['dark', DARK]
    ] as const) {
      const root = draw({ runningCount: 4, working: false, scheme })
      const count = root.findAllByType('Text' as never).find((n) => n.props.children === '4 running tasks')
      expect(flat(count!.props.style).color).toBe(want.link)

      const working = draw({ runningCount: 4, working: true, scheme })
      const byText = (match: (t: string) => boolean) =>
        working
          .findAllByType('Text' as never)
          .find((n) => typeof n.props.children === 'string' && match(n.props.children))
      expect(flat(byText((t) => t.endsWith('...'))!.props.style).color).toBe(want.clay)
      expect(flat(byText((t) => t === '4 running tasks')!.props.style).color).toBe(want.link)
      expect(flat(byText((t) => t.includes('·'))!.props.style).color).toBe(want.clay)
    }
  })

  it('sets the line in the app body style: 15 / 400 / 21', () => {
    const root = draw({ runningCount: 3, working: false })
    const style = flat(root.findAllByType('Text' as never)[0]!.props.style)
    expect(style.fontSize).toBe(15)
    expect(style.lineHeight).toBe(21)
  })

  it('opens the Background tasks sheet from the count, labelled for a screen reader', () => {
    const openSheet = vi.fn()
    const root = draw({ runningCount: 6, working: true, openSheet })
    const press = root.find(
      (n) => (n.type as unknown) === 'Pressable' && n.props.accessibilityLabel === '6 running tasks. Open background tasks'
    )
    expect(press.props.accessibilityRole).toBe('button')
    act(() => press.props.onPress())
    expect(openSheet).toHaveBeenCalledTimes(1)
  })

  it('announces the line as a polite live region, and the working state as "Working"', () => {
    const root = draw({ runningCount: 2, working: true })
    const live = root.find((n) => n.props.testID === 'native-chat-status-line')
    expect(live.props.accessibilityLiveRegion).toBe('polite')
    const working = root.find((n) => n.props.accessibilityLabel === 'Working')
    expect(working.props.accessible).toBe(true)
  })

  // au8.java:51-72, :90-91 and nl7.java:232-235: with the connection connecting or lost, the app's
  // ONE line says so in place of its verb and stats, "Connecting..." / "Connection lost...", in the
  // clay, then the count. Ours drew the verb line and a second "Connecting..." row under it.
  for (const [scheme, want] of [
    ['light', LIGHT],
    ['dark', DARK]
  ] as const) {
    it(`a turn whose connection drops says "Connecting... · 2 running tasks" on the one line (${scheme})`, () => {
      act(() => {
        renderer?.unmount()
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            {createElement(
              NativeChatConnectionNoticeContext.Provider,
              { value: { kind: 'connecting', text: 'Connecting...' } },
              createElement(
                NativeChatTasksContext.Provider,
                { value: { runningCount: 2, openSheet: () => {} } },
                createElement(MobileNativeChatStatusLine, { working: true })
              )
            )}
          </ThemeProvider>
        )
      })
      const root = renderer!.root
      expect(texts(root)).toEqual(['Connecting...', ' · ', '2 running tasks'])
      const byText = (t: string) => root.findAllByType('Text' as never).find((n) => n.props.children === t)!
      expect(flat(byText('Connecting...').props.style).color).toBe(want.clay)
      expect(flat(byText(' · ').props.style).color).toBe(want.clay)
      expect(flat(byText('2 running tasks').props.style).color).toBe(want.link)
      expect(star(root).length).toBeGreaterThan(0)
    })
  }

  it('an idle line with tasks ignores a connection notice: the app says it only while busy', () => {
    act(() => {
      renderer?.unmount()
      renderer = create(
        <ThemeProvider initialPreference="light">
          {createElement(
            NativeChatConnectionNoticeContext.Provider,
            { value: { kind: 'lost', text: 'Connection lost...' } },
            createElement(
              NativeChatTasksContext.Provider,
              { value: { runningCount: 1, openSheet: () => {} } },
              createElement(MobileNativeChatStatusLine, { working: false })
            )
          )}
        </ThemeProvider>
      )
    })
    expect(texts(renderer!.root)).toEqual(['1 running task'])
  })

  it('does not say Working to a screen reader when the agent is idle', () => {
    const root = draw({ runningCount: 2, working: false })
    expect(root.findAll((n) => n.props.accessibilityLabel === 'Working')).toHaveLength(0)
  })
})
