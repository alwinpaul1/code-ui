import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { claudeStatusFooterPalette } from '../theme/claude-status-footer-palette'
import { CCR_IDLE_LIVE_STATE } from './ccr-live-state'
import { ClaudeChatLiveContext, claudeChatLive, type ClaudeChatLive } from './claude-chat-live'
import { NativeChatTasksContext } from './native-chat-tasks-context'
import { NativeChatConnectionNoticeContext } from './native-chat-connection-notice'
import { BASH_CALL_UUID, RUNNING_ROWS_SHELL_DESCRIPTION, runningRowsMessages } from './fixtures/claude-running-rows-2.1.296'

// The working footer's live tool row, as the Claude app draws it (com.anthropic.claude 1.261013.20,
// `wm7.c`'s r0x branch; every value's decompile line is in claude-live-tool-row.ts): the running
// tool's label in `ad5.x0()`, the turn's clock from 2 s in `ad5.y()`, a chevron that opens the
// call's details, and no "N running tasks" meanwhile. Behind CLAUDE_LIVE_TOOL_ROW_ENABLED, which is
// off because the user's app drew "Noodling..." while the Agent tool ran (2026-10-16).

vi.mock('react-native', () => ({
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
vi.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight' }))
vi.mock('./MobileNativeChatShimmerText', () => ({ ShimmerText: 'ShimmerText' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))

import { MobileNativeChatWorkingFooter } from './MobileNativeChatWorkingFooter'
import { ClaudeWorkingMark } from './ClaudeWorkingMark'

const START = Date.parse('2026-10-11T15:51:16Z')

let id = 0
function message(role: NativeChatMessage['role'], blocks: NativeChatBlock[], timestamp: number | null = null): NativeChatMessage {
  id += 1
  return { id: `r${id}`, role, blocks, timestamp, source: 'transcript' } as NativeChatMessage
}
const prompt = (at: number | null) => message('user', [{ type: 'text', text: 'go' }], at)

function liveWith(turnStartedAt: number | null): ClaudeChatLive {
  return claudeChatLive({
    live: { ...CCR_IDLE_LIVE_STATE, working: true, turnStartedAt, thinking: false },
    linkPhase: 'live',
    connectionStatus: null,
    relayConnected: true
  })!
}

let renderer: ReactTestRenderer | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START + 12_000)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

type Draw = {
  messages: readonly NativeChatMessage[]
  runningCount?: number
  scheme?: 'light' | 'dark'
  agent?: string
  liveToolRow?: boolean
  awaitingApproval?: boolean
  working?: boolean
  live?: ClaudeChatLive | null
  notice?: { text: string; kind: 'connecting' | 'lost' | 'offline' } | null
}

function draw(args: Draw): ReactTestInstance {
  const footer = createElement(MobileNativeChatWorkingFooter, {
    messages: args.messages,
    working: args.working ?? true,
    thinking: false,
    agent: args.agent ?? 'claude',
    awaitingApproval: args.awaitingApproval ?? false,
    ...(args.liveToolRow === undefined ? {} : { liveToolRow: args.liveToolRow })
  })
  const tree = createElement(
    ClaudeChatLiveContext.Provider,
    { value: args.live === undefined ? liveWith(START) : args.live },
    createElement(
      NativeChatConnectionNoticeContext.Provider,
      { value: (args.notice ?? null) as never },
      createElement(NativeChatTasksContext.Provider, { value: { runningCount: args.runningCount ?? 3, openSheet: () => {} } }, footer)
    )
  )
  act(() => {
    renderer?.unmount()
    renderer = create(<ThemeProvider initialPreference={args.scheme ?? 'light'}>{tree}</ThemeProvider>)
  })
  return renderer!.root
}

const byTestId = (root: ReactTestInstance, testID: string) =>
  root.findAll((node) => node.props.testID === testID && typeof node.type === 'string')
const label = (root: ReactTestInstance) => byTestId(root, 'native-chat-tool-row-label')[0]
const clock = (root: ReactTestInstance) =>
  byTestId(root, 'native-chat-tool-row-clock').find((node) => (node.type as unknown) === 'View')
const strings = (root: ReactTestInstance) =>
  root
    .findAll((node) => (node.type as unknown) === 'Text')
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string')
const colorOf = (node: ReactTestInstance) =>
  (([] as unknown[]).concat(node.props.style).flat(3) as Array<{ color?: string } | undefined>).reduce<string>(
    (found, part) => part?.color ?? found,
    ''
  )
const mark = (root: ReactTestInstance) =>
  root.findAll((node) => node.props.testID === 'claude-working-mark' && (node.type as unknown) === 'View')
const markKind = (root: ReactTestInstance) => root.findAllByType(ClaudeWorkingMark)[0]?.props.kind

const bashRunning = () => runningRowsMessages(BASH_CALL_UUID)

describe('the working footer\'s live tool row, flag off (the default)', () => {
  it('keeps the verb and the running-tasks count while a tool runs, and draws no tool row', () => {
    const root = draw({ messages: bashRunning() })
    expect(byTestId(root, 'native-chat-tool-row')).toHaveLength(0)
    expect(strings(root).join('')).toMatch(/^[A-Za-z]+\.\.\. · 3 running tasks$/)
    expect(root.findAll((node) => (node.type as unknown) === 'ToolDetailSheet')).toHaveLength(0)
  })
})

describe('the working footer\'s live tool row, flag on', () => {
  it('names the running tool with the turn\'s clock and a chevron, and drops the running-tasks count', () => {
    const root = draw({ messages: bashRunning(), liveToolRow: true })
    expect(label(root)?.props.text).toBe(`Running ${RUNNING_ROWS_SHELL_DESCRIPTION}`)
    expect(label(root)?.props.active).toBe(true)
    expect(label(root)?.props.ellipsizeMode).toBe('tail')
    expect(clock(root)?.props.accessibilityLabel).toBe('12s')
    expect(byTestId(root, 'native-chat-tool-row-chevron')).toHaveLength(1)
    expect(strings(root).join('')).not.toContain('running task')
    expect(mark(root).length).toBeGreaterThan(0)
    // `d1x.a`: a Bash call draws the Code mark.
    expect(markKind(root)).toBe('code')
  })

  it('shows no time in the first 2 s of the turn', () => {
    vi.setSystemTime(START + 1_500)
    const root = draw({ messages: bashRunning(), liveToolRow: true })
    expect(label(root)?.props.text).toBe(`Running ${RUNNING_ROWS_SHELL_DESCRIPTION}`)
    expect(clock(root)).toBeUndefined()
  })

  it('starts the clock at 2 s and keeps it running', () => {
    vi.setSystemTime(START + 1_500)
    const root = draw({ messages: bashRunning(), liveToolRow: true })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(clock(root)?.props.accessibilityLabel).toBe('2s')
  })

  it('times an Orca-only turn from its prompt when Anthropic gives no turn start', () => {
    const messages = [prompt(START - 3_000), message('assistant', [{ type: 'tool-call', name: 'Read', input: { file_path: '/x/y/app.tsx' }, callId: 't1' }])]
    const root = draw({ messages, liveToolRow: true, live: null })
    expect(label(root)?.props.text).toBe('Reading app.tsx')
    expect(label(root)?.props.ellipsizeMode).toBe('middle')
    expect(clock(root)?.props.accessibilityLabel).toBe('15s')
  })

  it('falls back to the verb and the count when no tool is running', () => {
    const messages = [prompt(START), message('assistant', [{ type: 'text', text: 'Thinking it over.' }])]
    const root = draw({ messages, liveToolRow: true })
    expect(byTestId(root, 'native-chat-tool-row')).toHaveLength(0)
    expect(strings(root).join('')).toMatch(/^[A-Za-z]+\.\.\. · 3 running tasks$/)
  })

  it('falls back to the verb once the call has its result and the agent wrote after it', () => {
    const messages = [
      prompt(START),
      message('assistant', [{ type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' }, callId: 't1' }]),
      message('tool', [{ type: 'tool-result', output: 'x', callId: 't1' }]),
      message('assistant', [{ type: 'text', text: 'Done reading.' }])
    ]
    const root = draw({ messages, liveToolRow: true })
    expect(byTestId(root, 'native-chat-tool-row')).toHaveLength(0)
  })

  it('opens the call\'s detail sheet on a tap', () => {
    const root = draw({ messages: bashRunning(), liveToolRow: true })
    const sheet = () => root.findAll((node) => (node.type as unknown) === 'ToolDetailSheet')[0]!
    expect(sheet().props.pair).toBeNull()
    const row = byTestId(root, 'native-chat-tool-row')[0]!
    expect(row.type).toBe('Pressable')
    expect(row.props.accessibilityHint).toBe('Show details')
    act(() => row.props.onPress())
    expect(sheet().props.pair.call.name).toBe('Bash')
    expect(sheet().props.pair.result).toBeUndefined()
    act(() => sheet().props.onClose())
    expect(sheet().props.pair).toBeNull()
  })

  it('draws the label in ad5.x0() and the clock in ad5.y() of whichever scheme is on', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const root = draw({ messages: bashRunning(), liveToolRow: true, scheme })
      const palette = claudeStatusFooterPalette(scheme)
      expect(label(root)?.props.color).toBe(scheme === 'light' ? '#52514E' : '#C3C2B7')
      const digits = clock(root)!.findAll((node) => (node.type as unknown) === 'Text' && node.props.importantForAccessibility !== 'no')
      expect(colorOf(digits[0]!)).toBe('#898781')
      expect(byTestId(root, 'native-chat-tool-row-chevron')[0]!.props.color).toBe(palette.body)
    }
  })

  it('draws a call awaiting approval with the waiting mark, no clock and no shimmer, even with the turn not working', () => {
    const root = draw({ messages: bashRunning(), liveToolRow: true, awaitingApproval: true, working: false })
    expect(label(root)?.props.text).toBe(`Running ${RUNNING_ROWS_SHELL_DESCRIPTION}`)
    expect(label(root)?.props.active).toBe(false)
    expect(clock(root)).toBeUndefined()
    expect(markKind(root)).toBe('waitingForUser')
  })

  it('gives way to a connection message, as the app\'s footer does', () => {
    const root = draw({ messages: bashRunning(), liveToolRow: true, notice: { text: 'Connecting...', kind: 'connecting' } })
    expect(byTestId(root, 'native-chat-tool-row')).toHaveLength(0)
    expect(strings(root)).toContain('Connecting...')
  })

  it('draws no tool row for Codex, whose turn the Claude app never shows', () => {
    const messages = [prompt(START), message('assistant', [{ type: 'tool-call', name: 'exec_command', input: { cmd: 'ls' }, callId: 'c1' }])]
    const root = draw({ messages, liveToolRow: true, agent: 'codex' })
    expect(byTestId(root, 'native-chat-tool-row')).toHaveLength(0)
    expect(strings(root).join('')).toMatch(/^[A-Za-z]+\.\.\. · 3 running tasks$/)
  })

  it('draws nothing for an idle turn with no tasks, tool call or not', () => {
    const root = draw({ messages: bashRunning(), liveToolRow: true, working: false, runningCount: 0 })
    expect(byTestId(root, 'native-chat-status-line')).toHaveLength(0)
  })
})
