// No Stop on any row of the Background tasks sheet (the user, 2026-10-11, beside screenshots of the
// Claude Android app on the same Claude Code 2.1.296 session: "remove this … button from here", on
// the round Stop of "Locate plugin API types · Shell 5m 26s", and earlier on an Agent row). The
// Claude app's rows are the glyph, the title and the kind with its time, nothing at the right. Stop
// all and the "+N" line went the same way earlier the same day (no-stop-all.test.tsx).
//
// Both lanes: a structured tab's host roster (every kind it names) and a terminal Claude tab's
// transcript read with the footer's shells pill up, the case that used to draw a Stop on every row
// (the real records of fixtures/claude-busy-lead-tasks-2.1.296.ts).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { ThemeProvider } from '../theme/theme-context'
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
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  X: 'X'
}))

import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import { orcaTranscriptRows } from './fixtures/claude-subagent-transcripts-2.1.296'
import { QUICK_AGENT, SLOW_AGENT, busyRecords } from './fixtures/claude-busy-lead-tasks-2.1.296'

// 23:04:20: both lead shells and both agents running, the footer at "3 shells".
const BUSY_NOW = Date.parse('2026-10-10T23:04:20.000Z')
const busyStatus = {
  state: 'working' as const,
  subagents: [
    { id: QUICK_AGENT, agentType: 'general-purpose', state: 'working' as const, startedAt: Date.parse('2026-10-10T23:04:09.817Z') },
    { id: SLOW_AGENT, agentType: 'general-purpose', state: 'working' as const, startedAt: Date.parse('2026-10-10T23:04:10.685Z') }
  ]
}
const footerAt3: ActiveTabBackgroundTaskReport = {
  finishedTaskIds: [],
  runningTaskIds: null,
  runningTaskIdsAt: null,
  launchedTaskIds: [],
  onScreenShellCount: 3
}

function roster(now: number): AgentSessionBackgroundTaskState {
  return {
    state: 'monitoring',
    supportsTaskStop: true,
    tasks: [
      { id: 'shell', kind: 'command', description: 'Locate plugin API types', startedAt: now - 326_000 },
      { id: 'agent', kind: 'agent', description: 'Hide agent hand-back row', startedAt: now - 60_000 },
      { id: 'monitor', kind: 'monitor', description: 'Watch the build', startedAt: now - 5_000 },
      { id: 'workflow', kind: 'workflow', description: 'Review the outbox', startedAt: now - 5_000 },
      { id: 'other', kind: 'unknown', description: 'Something else', startedAt: now - 5_000 }
    ]
  }
}

const pressableLabels = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAllByType('Pressable' as never)
    .map((node) => String(node.props.accessibilityLabel ?? ''))

describe('the Background tasks sheet draws no Stop on any row, as the Claude app draws none', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  for (const scheme of ['light', 'dark'] as const) {
    describe(scheme, () => {
      beforeEach(() => {
        vi.useFakeTimers()
      })

      it('a structured roster: no Stop on a running shell, agent, monitor, workflow or unknown row', () => {
        const now = Date.UTC(2026, 9, 11, 9, 0, 0)
        vi.setSystemTime(now)
        act(() => {
          renderer = create(
            createElement(
              ThemeProvider as never,
              { initialPreference: scheme },
              createElement(MobileBackgroundTasksSheetBody, { messages: [], hostBackgroundTasks: roster(now) })
            )
          )
        })
        const texts = renderer!.root.findAllByType('Text' as never).map((node) => node.props.children)
        // The rows are there, with their titles; only the button is gone.
        expect(texts).toContain('Locate plugin API types')
        expect(texts).toContain('Hide agent hand-back row')
        expect(pressableLabels(renderer!).filter((label) => label.startsWith('Stop'))).toEqual([])
      })

      it("a terminal Claude tab with the footer's shells pill up: no Stop on its shells or its agents", () => {
        vi.setSystemTime(BUSY_NOW)
        act(() => {
          renderer = create(
            createElement(
              ThemeProvider as never,
              { initialPreference: scheme },
              createElement(MobileBackgroundTasksSheetBody, {
                messages: orcaTranscriptRows(busyRecords('lead')),
                agentStatus: busyStatus,
                backgroundTaskReport: footerAt3
              })
            )
          )
        })
        expect(renderer!.root.findAllByProps({ testID: 'background-task-card' }).length).toBeGreaterThanOrEqual(4)
        expect(pressableLabels(renderer!).filter((label) => label.startsWith('Stop'))).toEqual([])
      })
    })
  }
})
