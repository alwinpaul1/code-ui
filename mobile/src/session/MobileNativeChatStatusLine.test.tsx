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
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', G: 'G' }))

const LIGHT = { link: '#184F95', clay: '#C6613F', body: '#7B7974' }
const DARK = { link: '#6DA7EC', clay: '#D97757', body: '#97958D' }

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>
}

describe('the working footer at the transcript\'s foot, as the Claude app draws it', () => {
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

  const star = (root: ReactTestInstance) => root.findAll((n) => n.props.testID === 'claude-working-mark' && (n.type as unknown) === 'View')
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

  // Claude app 1.261013.20, `wm7.a` and `y07` (docs/claude-app-typography.md, "Working footer"):
  // the row is the list's item, padded by the list's 16 dp gutter and 16 dp above and below; the
  // working mark is a 20 dp box (`zq20.a`), then 8 dp, then the words. The recording measures the
  // words starting 126 px (44.8 dp) in and the dots spanning 48..97 px, in a 45..101 px box.
  it('sits in the transcript\'s 16 dp gutter, 16 dp above and below, with a 20 dp mark and 8 dp to the words', () => {
    const root = draw({ runningCount: 1, working: true })
    const line = root.find((n) => n.props.testID === 'native-chat-status-line')
    expect(flat(line.props.style)).toMatchObject({ paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center' })
    const mark = star(root)[0]!
    expect(flat(mark.props.style)).toMatchObject({ width: 20, height: 20 })
    // The mark's own component sits between its box and the row; step up to the row's child.
    let slot = mark
    while ((slot.parent!.type as unknown) !== 'View') {
      slot = slot.parent!
    }
    const row = slot.parent!
    const gap = row.children[row.children.indexOf(slot) + 1] as ReactTestInstance
    expect(flat(gap.props.style)).toMatchObject({ width: 8 })
  })

  it('tints the working mark with the clay of whichever theme is on', () => {
    for (const [scheme, want] of [
      ['light', LIGHT],
      ['dark', DARK]
    ] as const) {
      const root = draw({ runningCount: 0, working: true, scheme })
      const fills = root.findAll((n) => (n.type as unknown) === 'Circle' || (n.type as unknown) === 'Ellipse').map((n) => n.props.fill ?? n.props.stroke)
      expect(fills.length).toBeGreaterThan(0)
      expect(new Set(fills)).toEqual(new Set([want.clay]))
    }
  })

  it('an idle line with tasks is padded the same, so the count does not jump when a turn ends', () => {
    const root = draw({ runningCount: 2, working: false })
    const line = root.find((n) => n.props.testID === 'native-chat-status-line')
    expect(flat(line.props.style)).toMatchObject({ paddingHorizontal: 16, paddingVertical: 16 })
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

  // A matched Claude tab: the app's line is busy on the turn its stream last saw open, so a
  // reconnecting stream says "Connecting..." even while the relay calls the agent idle, and the
  // phone offline says the app's whole sentence (zr8.java:1097-1099), not one cut line.
  function drawNotice(scheme: 'light' | 'dark', notice: { kind: 'connecting' | 'lost' | 'offline'; text: string; anthropic?: true; quiet?: true }, runningCount = 0) {
    act(() => {
      renderer?.unmount()
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(
            NativeChatConnectionNoticeContext.Provider,
            { value: notice },
            createElement(
              NativeChatTasksContext.Provider,
              { value: { runningCount, openSheet: () => {} } },
              createElement(MobileNativeChatStatusLine, { working: false })
            )
          )}
        </ThemeProvider>
      )
    })
    return renderer!.root
  }
  for (const [scheme, want] of [
    ['light', LIGHT],
    ['dark', DARK]
  ] as const) {
    it(`a matched tab whose stream reconnects mid-turn says "Connecting..." with the relay idle (${scheme})`, () => {
      const root = drawNotice(scheme, { kind: 'connecting', text: 'Connecting...', anthropic: true }, 2)
      expect(texts(root)).toEqual(['Connecting...', ' · ', '2 running tasks'])
      const byText = (t: string) => root.findAllByType('Text' as never).find((n) => n.props.children === t)!
      expect(flat(byText('Connecting...').props.style).color).toBe(want.clay)
      expect(star(root).length).toBeGreaterThan(0)
    })

    // Review 2026-10-15: a matched tab's rows come from its Anthropic stream, so a stream lost
    // between turns froze the chat with nothing saying so. The line says it, muted, with no
    // working mark: nothing is running.
    it(`a stream lost between turns says a quiet "Connection lost" with no working mark (${scheme})`, () => {
      const root = drawNotice(scheme, { kind: 'lost', text: 'Connection lost', anthropic: true, quiet: true })
      expect(texts(root)).toEqual(['Connection lost'])
      const line = root.findAllByType('Text' as never).find((n) => n.props.children === 'Connection lost')!
      expect(flat(line.props.style).color).toBe(want.body)
      expect(star(root)).toHaveLength(0)
      expect(root.findAll((n) => n.props.accessibilityLabel === 'Working')).toHaveLength(0)
      expect(root.findAll((n) => n.props.accessibilityLabel === 'Connection lost').length).toBeGreaterThan(0)
    })

    it(`a quiet "Connection lost" keeps the running count beside it (${scheme})`, () => {
      const root = drawNotice(scheme, { kind: 'lost', text: 'Connection lost', anthropic: true, quiet: true }, 2)
      expect(texts(root)).toEqual(['Connection lost', ' · ', '2 running tasks'])
      expect(star(root)).toHaveLength(0)
    })

    it(`the phone offline mid-turn says the app’s whole sentence, wrapped, not cut (${scheme})`, () => {
      const sentence = 'You’re offline. The rest of Claude’s reply will appear when you reconnect.'
      const root = drawNotice(scheme, { kind: 'offline', text: sentence, anthropic: true })
      const line = root.findAllByType('Text' as never).find((n) => n.props.children === sentence)!
      expect(line).toBeDefined()
      expect(line.props.numberOfLines).toBeUndefined()
      expect(flat(line.props.style).color).toBe(want.clay)
    })
  }

  it('does not say Working to a screen reader when the agent is idle', () => {
    const root = draw({ runningCount: 2, working: false })
    expect(root.findAll((n) => n.props.accessibilityLabel === 'Working')).toHaveLength(0)
  })
})
