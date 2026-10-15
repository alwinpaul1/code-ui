import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { claudeStatusFooterPalette } from '../theme/claude-status-footer-palette'
import { CCR_IDLE_LIVE_STATE } from './ccr-live-state'
import { ClaudeChatLiveContext, claudeChatLive, type ClaudeChatLive } from './claude-chat-live'
import { NativeChatTasksContext } from './native-chat-tasks-context'

// The working footer, as the Claude app drew it on 2026-10-15 with the relay down:
// working mark, "15s · 2 running tasks · still thinking…" (nl7.java:188-224: stats and status in the
// muted `pl7.Q`, the count in link blue `ad5.C0()`), and the running count from Anthropic's
// `background_tasks_changed` when the relay's sources are stale.

const running = vi.hoisted(() => ({ tasks: [] as { id: string; kind: string }[] }))

vi.mock('react-native', () => ({
  // The stats roll (ClaudeRollingText); reduced motion is on here, so nothing animates.
  Animated: {
    Text: 'AnimatedText',
    Value: class {
      setValue() {}
      interpolate() {
        return 0
      }
    }
  },
  Easing: { linear: (t: number) => t },
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', G: 'G' }))
vi.mock('./use-mobile-running-task-count', () => ({ useMobileRunningTasks: () => running.tasks }))
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: () => null }))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: () => null }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('./MobileBackgroundShellOutputSheet', () => ({ MobileBackgroundShellOutputSheet: () => null }))
vi.mock('./MobileNativeChatAgentToolCalls', () => ({ MobileNativeChatAgentToolCalls: () => null }))
vi.mock('./subagent-transcript-store', () => ({ followSubagentTranscriptRunning: () => () => {}, followSubagentTranscriptStream: () => {}, openSubagentTranscript: () => {} }))

import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { MobileNativeChatTasksProvider } from './MobileNativeChatTasksProvider'

const START = Date.parse('2026-10-15T12:29:33Z')
const relayDownThinking = claudeChatLive({
  live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START, thinking: true, runningTasks: 2 },
  linkPhase: 'live',
  connectionStatus: null,
  relayConnected: false
})

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START + 15_000)
  running.tasks = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function draw(scheme: 'light' | 'dark', children: ReactNode): ReactTestInstance {
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{children}</ThemeProvider>)
  })
  return renderer!.root
}

function line(live: ClaudeChatLive | null, runningCount: number, working = true) {
  return createElement(
    ClaudeChatLiveContext.Provider,
    { value: live },
    createElement(NativeChatTasksContext.Provider, { value: { runningCount, openSheet: () => {} } }, createElement(MobileNativeChatStatusLine, { working }))
  )
}

function colorOf(node: ReactTestInstance): string {
  const style = ([] as unknown[]).concat(node.props.style).flat() as Array<{ color?: string } | undefined>
  return style.reduce<string>((found, part) => part?.color ?? found, '')
}

/** Each drawn string with its colour, in order. The rolling stats draw one Text per character
 *  (`z530.a`), so they count as one string: the line they say, in their characters' colour. */
function texts(root: ReactTestInstance): Array<{ text: string; color: string }> {
  const out: Array<{ text: string; color: string }> = []
  const walk = (node: ReactTestInstance) => {
    if (node.props.testID === 'native-chat-status-stats' && (node.type as unknown) === 'View') {
      const shown = node.findAll((n) => (n.type as unknown) === 'Text' && n.props.importantForAccessibility !== 'no')
      out.push({ text: node.props.accessibilityLabel as string, color: colorOf(shown[0]!) })
      return
    }
    if ((node.type as unknown) === 'Text' && typeof node.props.children === 'string') {
      out.push({ text: node.props.children as string, color: colorOf(node) })
      return
    }
    for (const child of node.children) {
      if (typeof child !== 'string') {
        walk(child)
      }
    }
  }
  walk(root)
  return out
}

describe('the footer reads Anthropic’s live state, as the Claude app’s does', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`draws "15s · 2 running tasks · still thinking…" with the app's colours (${scheme})`, () => {
      const palette = claudeStatusFooterPalette(scheme)
      const root = draw(scheme, line(relayDownThinking, 2))
      expect(texts(root)).toEqual([
        { text: '15s', color: palette.body },
        { text: ' · ', color: palette.body },
        { text: '2 running tasks', color: palette.link },
        { text: ' · still thinking…', color: palette.body }
      ])
      expect(root.findAll((node) => node.props.testID === 'claude-working-mark' && (node.type as unknown) === 'View').length).toBe(1)
    })
  }

  it('counts up each second, and steps the phrase at 30 s', () => {
    const root = draw('light', line(relayDownThinking, 0))
    expect(texts(root).map((t) => t.text)).toEqual(['15s', ' · still thinking…'])
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(texts(root).map((t) => t.text)).toEqual(['30s', ' · thinking more…'])
  })

  it('with no stats (not thinking, no tokens) it keeps the cycling verb in clay', () => {
    const notThinking = claudeChatLive({ live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START }, linkPhase: 'live', connectionStatus: null, relayConnected: false })
    const root = draw('dark', line(notThinking, 1))
    const palette = claudeStatusFooterPalette('dark')
    expect(texts(root)).toEqual([
      { text: 'Clauding...', color: palette.clay },
      { text: ' · ', color: palette.clay },
      { text: '1 running task', color: palette.link }
    ])
  })

  it('a tab with no Anthropic state draws today’s line', () => {
    const root = draw('light', line(null, 0))
    expect(texts(root).map((t) => t.text)).toEqual(['Clauding...'])
  })

  it('idle with tasks running: the count alone, no stats', () => {
    const idle = claudeChatLive({ live: { ...CCR_IDLE_LIVE_STATE, runningTasks: 2 }, linkPhase: 'live', connectionStatus: null, relayConnected: false })
    const root = draw('light', line(idle, 2, false))
    expect(texts(root).map((t) => t.text)).toEqual(['2 running tasks'])
  })
})

describe('after thinking, and while the token figure grows, as the Claude app draws it', () => {
  const live = (over: { thinking: boolean; thinkingTokens?: number | null }) =>
    claudeChatLive({
      live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START, thinking: over.thinking, thinkingTokens: over.thinkingTokens ?? null },
      linkPhase: 'live',
      connectionStatus: null,
      relayConnected: false
    })
  const redraw = (value: ClaudeChatLive | null) => act(() => renderer!.update(<ThemeProvider initialPreference="light">{line(value, 0)}</ThemeProvider>))

  it('says "thought for 8s" for two seconds once Claude stops thinking, then goes back to the verb', () => {
    const root = draw('light', line(live({ thinking: true }), 0))
    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    redraw(live({ thinking: false }))
    expect(texts(root).map((t) => t.text)).toEqual(['23s', ' · thought for 8s'])
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(texts(root).map((t) => t.text)).toEqual(['Clauding...'])
  })

  it('keeps the tokens after the phrase goes', () => {
    const root = draw('light', line(live({ thinking: true, thinkingTokens: 40 }), 0))
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    redraw(live({ thinking: false, thinkingTokens: 40 }))
    expect(texts(root).map((t) => t.text)).toEqual(['18s · 40 tokens', ' · thought for 3s'])
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(texts(root).map((t) => t.text)).toEqual(['20s · 40 tokens'])
  })

  it('a new turn forgets the last turn’s span', () => {
    const root = draw('light', line(live({ thinking: true }), 0))
    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    const nextTurn = claudeChatLive({
      live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START + 19_000, thinking: false },
      linkPhase: 'live',
      connectionStatus: null,
      relayConnected: false
    })
    redraw(nextTurn)
    expect(texts(root).map((t) => t.text)).toEqual(['Clauding...'])
  })

  it('counts the token figure up from 1 instead of jumping to it', () => {
    const root = draw('light', line(live({ thinking: true, thinkingTokens: 1_200 }), 0))
    expect(texts(root).map((t) => t.text)).toEqual(['15s · 1 token', ' · still thinking…'])
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(texts(root)[0]!.text).toBe('15s · 600 tokens')
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(texts(root)[0]!.text).toBe('16s · 1,200 tokens')
  })
})

describe('the running count on an Anthropic-drawn tab', () => {
  function providerLine(live: ClaudeChatLive | null) {
    return createElement(
      ClaudeChatLiveContext.Provider,
      { value: live },
      <MobileNativeChatTasksProvider messages={[]} agent="claude" agentWorking>
        <MobileNativeChatStatusLine working />
      </MobileNativeChatTasksProvider>
    )
  }

  it('is Anthropic’s background_tasks_changed count, not the relay’s stale one', () => {
    running.tasks = [{ id: 'stale-1', kind: 'shell' }]
    const root = draw('light', providerLine(relayDownThinking))
    expect(texts(root).map((t) => t.text)).toContain('2 running tasks')
  })

  // 2026-10-15, relay up: the Claude app said "3 running tasks", Code UI's desktop count "4".
  it('with the relay up, is still Anthropic’s, so it matches the Claude app', () => {
    running.tasks = [{ id: 'shell-1', kind: 'shell' }]
    const relayUp = claudeChatLive({ live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START, thinking: true, runningTasks: 2 }, linkPhase: 'live', connectionStatus: null, relayConnected: true })
    const root = draw('light', providerLine(relayUp))
    expect(texts(root).map((t) => t.text)).toContain('2 running tasks')
  })

  it('with Anthropic’s stream not live, is the relay’s', () => {
    running.tasks = [{ id: 'shell-1', kind: 'shell' }]
    const notLive = claudeChatLive({ live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START, thinking: true, runningTasks: 2 }, linkPhase: 'reconnecting', connectionStatus: null, relayConnected: true })
    const root = draw('light', providerLine(notLive))
    expect(texts(root).map((t) => t.text)).toContain('1 running task')
  })
})

// The user's screenshot of the Claude app mid-turn, 2026-10-15: "9s · 3 running tasks · thinking…",
// and of the same session earlier: "Noodling… · 2 running tasks". Re-read in 1.261013.20: the stats
// builder is qq30.java:353-512 (elapsed whole seconds since the turn started, 0 with no start or a
// clock behind it, :403-409; "thinking…" under 15 s while thinking, :410-419; with no tokens the
// stats are the time alone when there is a phrase, else none and the verb is drawn, :506-511),
// rt30.java:492-509 writes "Ns" under a minute and "Nm Ns" from one, and wm7.java:197-226 draws the
// time in `pl7.Q` (muted), the count's " · " in `pl7.Q` and the count in link blue `ad5.C0()`,
// then " · " + the phrase in `pl7.Q`; the line is padded 16 dp above and below (wm7.java:80).
describe('the thinking form of the line, as the Claude app draws it (2026-10-15 screenshot)', () => {
  const thinkingAt = (runningTasks: number) =>
    claudeChatLive({
      live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START, thinking: true, runningTasks },
      linkPhase: 'live',
      connectionStatus: null,
      relayConnected: false
    })

  for (const scheme of ['light', 'dark'] as const) {
    it(`draws "9s · 3 running tasks · thinking…": time muted, count blue, phrase muted (${scheme})`, () => {
      vi.setSystemTime(START + 9_000)
      const palette = claudeStatusFooterPalette(scheme)
      expect(texts(draw(scheme, line(thinkingAt(3), 3)))).toEqual([
        { text: '9s', color: palette.body },
        { text: ' · ', color: palette.body },
        { text: '3 running tasks', color: palette.link },
        { text: ' · thinking…', color: palette.body }
      ])
    })

    it(`with no task running there is no link and no separator for one: "9s · thinking…" (${scheme})`, () => {
      vi.setSystemTime(START + 9_000)
      const palette = claudeStatusFooterPalette(scheme)
      const root = draw(scheme, line(thinkingAt(0), 0))
      expect(texts(root)).toEqual([
        { text: '9s', color: palette.body },
        { text: ' · thinking…', color: palette.body }
      ])
      expect(root.findAll((node) => (node.type as unknown) === 'Pressable')).toHaveLength(0)
    })

    it(`reads "0s" the moment the turn starts (${scheme})`, () => {
      vi.setSystemTime(START)
      expect(texts(draw(scheme, line(thinkingAt(1), 1))).map((t) => t.text)).toEqual(['0s', ' · ', '1 running task', ' · thinking…'])
    })

    it(`turns 59s into "1m 0s" at the minute, with the last thinking phrase (${scheme})`, () => {
      vi.setSystemTime(START + 59_000)
      const root = draw(scheme, line(thinkingAt(0), 0))
      expect(texts(root).map((t) => t.text)).toEqual(['59s', ' · thinking some more…'])
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(texts(root).map((t) => t.text)).toEqual(['1m 0s', ' · almost done thinking…'])
    })
  }
})
