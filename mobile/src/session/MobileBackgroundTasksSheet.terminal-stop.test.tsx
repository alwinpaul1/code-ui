// A terminal-driven Claude tab's Background tasks sheet: every running row Claude Code's own
// Background dialog can select carries a Stop, as the Claude app's rows do, and the press hands the
// row's dialog label to the tab's stop (claude-background-task-stop.ts drives the dialog). Before
// 2026-10-11 a terminal tab had no Stop at all. The transcript and the footer readings are the real
// ones of fixtures/claude-busy-lead-tasks-2.1.296.ts.

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
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
  SquareTerminal: 'SquareTerminal',
  Terminal: 'Terminal',
  X: 'X'
}))

import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import { orcaTranscriptRows } from './fixtures/claude-subagent-transcripts-2.1.296'
import { QUICK_AGENT, SLOW_AGENT, busyRecords } from './fixtures/claude-busy-lead-tasks-2.1.296'

// 23:04:20: both lead shells and both agents running, the footer at "3 shells".
const NOW = Date.parse('2026-10-10T23:04:20.000Z')
const agentStatus = {
  state: 'working' as const,
  subagents: [
    { id: QUICK_AGENT, agentType: 'general-purpose', state: 'working' as const, startedAt: Date.parse('2026-10-10T23:04:09.817Z') },
    { id: SLOW_AGENT, agentType: 'general-purpose', state: 'working' as const, startedAt: Date.parse('2026-10-10T23:04:10.685Z') }
  ]
}

function report(footer: number | null): ActiveTabBackgroundTaskReport {
  return { finishedTaskIds: [], runningTaskIds: null, runningTaskIdsAt: null, launchedTaskIds: [], onScreenShellCount: footer }
}

const stopLabels = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => node.type === ('Pressable' as never) && String(node.props.accessibilityLabel ?? '').startsWith('Stop '))
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label) => label !== 'Stop all running tasks')

describe("a terminal Claude tab's Background tasks sheet offers Claude's own Stop", () => {
  let renderer: ReactTestRenderer | null = null
  const onStopTask = vi.fn(async () => true)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    onStopTask.mockClear()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function mount(footer: number | null, scheme: 'light' | 'dark' = 'light', stop: typeof onStopTask | null = onStopTask) {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider as never,
          { initialPreference: scheme },
          createElement(MobileBackgroundTasksSheetBody, {
            messages: orcaTranscriptRows(busyRecords('lead')),
            agentStatus,
            backgroundTaskReport: report(footer),
            onStopTask: stop ?? undefined
          })
        )
      )
    })
    return renderer!
  }

  it('puts a Stop on every running shell and agent while the footer shows its shells pill', () => {
    const tree = mount(3)
    expect(stopLabels(tree)).toEqual(['Stop Busy lead shell A', 'Stop Busy lead shell B', 'Stop Busy probe quick', 'Stop Busy probe slow'])
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Stop all running tasks')).toHaveLength(1)
  })

  it("hands the row's dialog label to the stop: a shell's command, an agent's description", async () => {
    const tree = mount(3)
    const press = (label: string) =>
      act(async () => {
        ;(tree.root.find((node) => node.props.accessibilityLabel === label) as ReactTestInstance).props.onPress()
      })
    await press('Stop Busy lead shell B')
    await press('Stop Busy probe slow')
    expect(onStopTask.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      { kind: 'shell', label: 'sleep 45' },
      { kind: 'agent', label: 'Busy probe slow' }
    ])
  })

  it("draws no Stop on an agent when Claude shows no shells pill to open its list from", () => {
    // The footer off screen (null): the shells still carry theirs; the drive itself
    // refuses when the pill is not there when pressed.
    expect(stopLabels(mount(null))).toEqual(['Stop Busy lead shell A', 'Stop Busy lead shell B'])
  })

  it('draws no Stop at all without a stop handler (a Codex tab)', () => {
    expect(stopLabels(mount(3, 'light', null))).toEqual([])
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)("draws a shell with Claude's terminal-window glyph, in %s ink", (scheme, palette) => {
    const tree = mount(3, scheme)
    const shells = tree.root.findAll((node) => node.type === ('SquareTerminal' as never))
    expect(shells).toHaveLength(2)
    expect(shells.every((node) => node.props.color === palette.textSecondary)).toBe(true)
    expect(tree.root.findAll((node) => node.type === ('Terminal' as never))).toHaveLength(0)
    // The agent keeps its hollow diamond.
    expect(tree.root.findAll((node) => node.type === ('Diamond' as never)).every((node) => node.props.color === palette.textSecondary)).toBe(true)
  })
})
