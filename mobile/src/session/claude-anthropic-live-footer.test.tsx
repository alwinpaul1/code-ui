import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { claudeStatusFooterPalette } from '../theme/claude-status-footer-palette'
import { CCR_IDLE_LIVE_STATE } from './ccr-live-state'
import { ClaudeChatLiveContext, claudeChatLive, type ClaudeChatLive } from './claude-chat-live'
import { NativeChatTasksContext } from './native-chat-tasks-context'

// The footer above the composer, as the Claude app drew it on 2026-10-15 with the relay down:
// spinner, "15s · 2 running tasks · still thinking…" (nl7.java:188-224: stats and status in the
// muted `pl7.Q`, the count in link blue `ad5.C0()`), and the running count from Anthropic's
// `background_tasks_changed` when the relay's sources are stale.

const running = vi.hoisted(() => ({ tasks: [] as { id: string; kind: string }[] }))

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./use-mobile-running-task-count', () => ({ useMobileRunningTasks: () => running.tasks }))
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: () => null }))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: () => null }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('./MobileBackgroundShellOutputSheet', () => ({ MobileBackgroundShellOutputSheet: () => null }))
vi.mock('./MobileNativeChatAgentToolCalls', () => ({ MobileNativeChatAgentToolCalls: () => null }))
vi.mock('./subagent-transcript-store', () => ({ followSubagentTranscriptRunning: () => () => {}, openSubagentTranscript: () => {} }))

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

/** Each drawn string with its colour, in order. */
function texts(root: ReactTestInstance): Array<{ text: string; color: string }> {
  return root
    .findAllByType('Text' as never)
    .filter((node) => typeof node.props.children === 'string')
    .map((node) => {
      const style = ([] as unknown[]).concat(node.props.style).flat() as Array<{ color?: string } | undefined>
      const color = style.reduce<string>((found, part) => part?.color ?? found, '')
      return { text: node.props.children as string, color }
    })
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
      expect(root.findAll((node) => node.props.testID === 'claude-spinner-sprite-strip').length).toBe(1)
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

describe('the running count while the relay is down', () => {
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

  it('with the relay up, stays the relay’s', () => {
    running.tasks = [{ id: 'shell-1', kind: 'shell' }]
    const relayUp = claudeChatLive({ live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt: START, thinking: true, runningTasks: 2 }, linkPhase: 'live', connectionStatus: null, relayConnected: true })
    const root = draw('light', providerLine(relayUp))
    expect(texts(root).map((t) => t.text)).toContain('1 running task')
  })
})
