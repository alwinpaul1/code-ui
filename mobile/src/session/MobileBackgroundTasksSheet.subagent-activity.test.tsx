import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import {
  orcaTranscriptRows,
  PROBE_A_AGENT,
  PROBE_A_SHELL,
  PROBE_B_AGENT,
  probeARecords,
  probeBRecords,
  recordsThrough
} from './fixtures/claude-subagent-transcripts-2.1.296'

const fakes = vi.hoisted(() => ({ client: null as RpcClient | null, focused: true }))

// The session screen's focus, as expo-router reports it: run on mount while
// focused, cleaned up on unmount.
vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    useEffect(() => (fakes.focused ? effect() : undefined), [effect])
}))

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Animated: {
    View: 'AnimatedView',
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
  Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Sparkles: 'Sparkles',
  Square: 'Square',
  Terminal: 'Terminal',
  X: 'X'
}))
vi.mock('../transport/host-client-hooks', () => ({
  useHostClient: () => ({ client: fakes.client, clientId: 'c1', state: 'connected' })
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => 1000
}))

import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import { MobileSubagentActivityFeeds } from './MobileSubagentActivityFeeds'
import { resetSubagentActivityForTests } from './subagent-activity-store'
import { resetNativeChatTranscriptCacheForTests } from './mobile-native-chat-transcript-cache'

// The two background agents of a real Claude Code 2.1.296 run
// (fixtures/claude-subagent-transcripts-2.1.296.ts), A in the middle of its
// `cd /private/tmp && ls | head -3`, 1m 20s after its background sleep began.
const NOW = Date.parse('2026-10-10T18:46:35.616Z')
const PARENT =
  '/Users/me/.claude/projects/-scratch/59454ec6-195e-419b-92a4-d1c97be7ea47.jsonl'
const SOURCE = { agent: 'claude', parentTranscriptPath: PARENT }

const row = (id: string, description: string): AgentSubagentSnapshot => ({
  id,
  agentType: 'general-purpose',
  description,
  state: 'working',
  startedAt: Date.parse('2026-10-10T18:45:12.000Z')
})
const agentStatus = { state: 'working' as const, subagents: [row(PROBE_A_AGENT, 'Sleep probe A'), row(PROBE_B_AGENT, 'Sleep probe B')] }

function report(onScreenShellCount: number | null, finishedTaskIds: string[] = []): ActiveTabBackgroundTaskReport {
  return { finishedTaskIds, runningTaskIds: null, runningTaskIdsAt: null, launchedTaskIds: [], onScreenShellCount }
}

type Subscription = { params: { sessionId: string; transcriptPath?: string }; emit: (frame: unknown) => void; closed: boolean }

type Rendered = { texts: string[]; colorsByText: Map<string, string | undefined>; labels: string[] }

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  const labels: string[] = []
  const colorsByText = new Map<string, string | undefined>()
  for (const node of renderer.root.findAllByType('Text' as never)) {
    const children: unknown = node.props.children
    if (typeof node.props.accessibilityLabel === 'string') {
      labels.push(node.props.accessibilityLabel)
    }
    if (typeof children !== 'string') {
      continue
    }
    texts.push(children)
    const style: unknown = node.props.style
    const flat = (Array.isArray(style) ? style : [style]) as unknown[]
    const colors = flat
      .map((entry) => (entry && typeof entry === 'object' && 'color' in entry ? (entry as { color: unknown }).color : undefined))
      .filter((value): value is string => typeof value === 'string')
    colorsByText.set(children, colors.at(-1))
  }
  return { texts, colorsByText, labels }
}

describe("the Background tasks sheet reads its running agents' transcripts", () => {
  let renderer: ReactTestRenderer | null = null
  let subscriptions: Subscription[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    resetSubagentActivityForTests()
    resetNativeChatTranscriptCacheForTests()
    subscriptions = []
    fakes.focused = true
    fakes.client = {
      subscribe: vi.fn((_method: string, params: Subscription['params'], onData: (frame: unknown) => void) => {
        const subscription: Subscription = { params, emit: onData, closed: false }
        subscriptions.push(subscription)
        return () => {
          subscription.closed = true
        }
      }),
      sendRequest: vi.fn(async () => ({ ok: true, result: { messages: [], hasMore: false } })),
      getState: () => 'connected'
    } as unknown as RpcClient
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function tree(props: {
    scheme?: 'light' | 'dark'
    open: boolean
    messages?: NativeChatMessage[]
    status?: typeof agentStatus
    footer?: number | null
    finished?: string[]
  }) {
    return (
      <ThemeProvider initialPreference={props.scheme ?? 'light'}>
        <MobileSubagentActivityFeeds hostId="h1" worktreeId="w1" />
        <MobileBackgroundTasksSheetBody
          messages={props.messages ?? []}
          agentStatus={props.status ?? agentStatus}
          backgroundTaskReport={report(props.footer ?? null, props.finished)}
          subagentSource={props.open ? SOURCE : null}
        />
      </ThemeProvider>
    )
  }

  async function mount(props: Parameters<typeof tree>[0]): Promise<void> {
    await act(async () => {
      renderer = create(tree(props))
    })
  }

  const live = () => subscriptions.filter((subscription) => !subscription.closed)

  function answer(agentId: string, messages: NativeChatMessage[]): void {
    const subscription = live().find((entry) => entry.params.sessionId === `agent-${agentId}`)
    if (!subscription) {
      throw new Error(`no live read of ${agentId}`)
    }
    act(() => subscription.emit({ type: 'snapshot', messages, hasMore: false }))
  }

  it('titles agent A with its latest step and lists its background sleep as "Shell 1m 20s"', async () => {
    await mount({ open: true, footer: 2 })
    answer(PROBE_A_AGENT, orcaTranscriptRows(recordsThrough(probeARecords(), 'b8efa9d2')))
    answer(PROBE_B_AGENT, orcaTranscriptRows(recordsThrough(probeBRecords(), '1f61a477')))
    const { texts, labels } = readTree(renderer!)
    expect(texts).toContain('Running cd /private/tmp && ls | head -3')
    expect(texts).not.toContain('Sleep probe A')
    expect(labels).toContain('Sleep probe A, Running cd /private/tmp && ls | head -3')
    expect(texts).toContain('Start a 120-second background sleep')
    expect(texts).toContain('1m 20s')
    // B's latest step was its TaskStop; the shell it stopped is in Finished.
    expect(texts).toContain('Running TaskStop')
    expect(texts).toContain('Start 200s sleep in background')
    // Both footer shells are listed now: no "+N shells in subagents" left over.
    expect(texts.some((text) => text.includes('in subagents'))).toBe(false)
    // A subagent's shell has no Stop: nothing can reach it.
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Stop Start a 120-second background sleep')).toHaveLength(0)
  })

  it("moves A's shell out of Running once the status line reports it finished, with no footer count", async () => {
    // The footer is gone (it paints no count at zero); the beacon's done= names A's shell.
    await mount({ open: true, footer: null, finished: [PROBE_A_SHELL] })
    answer(PROBE_A_AGENT, orcaTranscriptRows(recordsThrough(probeARecords(), 'b8efa9d2')))
    const { texts } = readTree(renderer!)
    // Still listed, now as a finished row with no live clock.
    expect(texts).toContain('Start a 120-second background sleep')
    expect(texts).not.toContain('1m 20s')
    expect(texts).toContain('Running cd /private/tmp && ls | head -3')
  })

  it('keeps the description when the read is refused or never answers', async () => {
    await mount({ open: true })
    const subscription = live().find((entry) => entry.params.sessionId === `agent-${PROBE_A_AGENT}`)!
    act(() => subscription.emit({ type: 'error', error: 'Unknown method' }))
    const { texts } = readTree(renderer!)
    expect(texts).toContain('Sleep probe A')
    expect(texts).toContain('Sleep probe B')
    expect(texts.some((text) => /error|unknown method|could not/i.test(text))).toBe(false)
  })

  it('reads only while the sheet is open, only running agents, and stops each read when its agent finishes', async () => {
    await mount({ open: false })
    expect(subscriptions).toHaveLength(0)
    await act(async () => renderer!.update(tree({ open: true })))
    expect(live().map((entry) => entry.params.sessionId).toSorted()).toEqual([`agent-${PROBE_A_AGENT}`, `agent-${PROBE_B_AGENT}`])
    expect(live()[0]!.params.transcriptPath).toMatch(/\/59454ec6-195e-419b-92a4-d1c97be7ea47\/subagents\/agent-a[0-9a-f]+\.jsonl$/)
    // B finished: its row left the roster, and its read stops with it.
    const onlyA = { state: 'working' as const, subagents: [row(PROBE_A_AGENT, 'Sleep probe A')] }
    await act(async () => renderer!.update(tree({ open: true, status: onlyA })))
    expect(live().map((entry) => entry.params.sessionId)).toEqual([`agent-${PROBE_A_AGENT}`])
    // A ticking clock re-derives every second; it must not re-open the reads.
    const opened = subscriptions.length
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(subscriptions).toHaveLength(opened)
    // The sheet closes: nothing is left reading.
    await act(async () => renderer!.update(tree({ open: false, status: onlyA })))
    expect(live()).toHaveLength(0)
  })

  it('keeps the step and the shell rows through a read that fails after it answered', async () => {
    await mount({ open: true })
    answer(PROBE_A_AGENT, orcaTranscriptRows(recordsThrough(probeARecords(), 'b8efa9d2')))
    const subscription = live().find((entry) => entry.params.sessionId === `agent-${PROBE_A_AGENT}`)!
    act(() => subscription.emit({ type: 'error', error: 'connection lost' }))
    const { texts } = readTree(renderer!)
    expect(texts).toContain('Running cd /private/tmp && ls | head -3')
    expect(texts).toContain('Start a 120-second background sleep')
  })

  it('a session screen that is not in focus reads nothing, even with the sheet open', async () => {
    fakes.focused = false
    await mount({ open: true })
    expect(subscriptions).toHaveLength(0)
  })

  it('stops every read when the sheet unmounts', async () => {
    await mount({ open: true })
    expect(live()).toHaveLength(2)
    act(() => renderer?.unmount())
    renderer = null
    expect(live()).toHaveLength(0)
  })

  it('draws the step title in the primary ink of the active theme, light and dark', async () => {
    for (const [scheme, colors] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      await mount({ open: true, scheme })
      answer(PROBE_A_AGENT, orcaTranscriptRows(recordsThrough(probeARecords(), 'b8efa9d2')))
      const { colorsByText } = readTree(renderer!)
      expect(colorsByText.get('Running cd /private/tmp && ls | head -3')).toBe(colors.text)
      expect(colorsByText.get('1m 20s')).toBe(colors.textMuted)
      act(() => renderer?.unmount())
      renderer = null
      resetSubagentActivityForTests()
      subscriptions = []
    }
  })
})
