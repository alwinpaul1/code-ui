// A running agent's row is titled with the Agent call's description, always, as the Claude app
// titles it. The user, 2026-10-11, beside screenshots of both apps on the same Claude Code 2.1.296
// session: Code UI read "Running cd "/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/ag…"
// on two of four running agents, where Claude read "Running shimmer and stray arrow" and "Show chat
// images like Claude" (the second resumed by SendMessage). "I would like to know what they are
// doing or their tasks, like 'Show chat images like Claude', not the process they are doing."
//
// Cause: the sheet read each running agent's own transcript and put its unanswered tool call on the
// row as `latestStep`, which the card drew over the title. A gate run is one Bash call that stays
// unanswered for minutes, so the row read as the command for minutes. Both paths here are real rows:
// a plain background agent mid-ping (fixtures/claude-busy-lead-tasks-2.1.296.ts) and a resumed one
// mid-gate (fixtures/claude-resumed-agent-bash-in-flight-2.1.296.ts).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'
import { deriveReportedBackgroundTasks } from './mobile-reported-background-tasks'
import { mergeSubagentActivity } from './mobile-subagent-activity'
import { MobileBackgroundTaskCard } from './MobileBackgroundTaskCard'
import { orcaTranscriptRows, recordsThrough } from './fixtures/claude-subagent-transcripts-2.1.296'
import { BUSY_LAUNCHED_AT, SLOW_AGENT, busyRecords } from './fixtures/claude-busy-lead-tasks-2.1.296'
import {
  GATE_ANSWERED_AT,
  GATE_CALLED_AT,
  RESUMED_AGENT,
  RESUMED_AGENT_TITLE,
  RESUMED_AT,
  resumedAgentRows,
  resumedLeadRows
} from './fixtures/claude-resumed-agent-bash-in-flight-2.1.296'

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  SquareCode: 'SquareCode'
}))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/** What the card draws: every string in it. */
function drawn(task: BackgroundTask, scheme: 'light' | 'dark'): string[] {
  act(() => {
    renderer = create(
      createElement(ThemeProvider as never, { initialPreference: scheme }, createElement(MobileBackgroundTaskCard, { task }))
    )
  })
  const strings = renderer!.root
    .findAllByType('Text' as never)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string')
  act(() => renderer?.unmount())
  renderer = null
  return strings
}

for (const scheme of ['light', 'dark'] as const) {
  describe(`a running agent's row reads its description, never the call it is in (${scheme})`, () => {
    it('keeps "Busy probe slow" on the row while its ping -c 50 has no answer yet', () => {
      // 23:04:35: the slow agent's ping was sent at 23:04:12.4 and answered at 23:05:02.
      const now = Date.parse('2026-10-10T23:04:35.000Z')
      const tasks: BackgroundTasks = {
        running: [
          { id: SLOW_AGENT, kind: 'agent', title: 'Busy probe slow', status: 'running', startedAt: BUSY_LAUNCHED_AT, elapsedMs: now - BUSY_LAUNCHED_AT }
        ],
        finished: []
      }
      const slow = orcaTranscriptRows(recordsThrough(busyRecords('agent-slow'), '2be5402f'))
      const card = mergeSubagentActivity(tasks, new Map([[SLOW_AGENT, slow]]), { now }).running.find(
        (task) => task.id === SLOW_AGENT
      )!
      const strings = drawn(card, scheme)
      expect(strings).toContain('Busy probe slow')
      expect(strings.some((text) => text.startsWith('Running'))).toBe(false)
    })

    it('keeps "Show chat images like Claude" on a SendMessage-resumed agent while its gate Bash runs', () => {
      // 15:38:00: resumed at 15:31:21, the gate's `cd "/Users/…/worktrees/agent-af91594a71c8c11d0/mobile"
      // && … pnpm test` sent at 15:36:06 and not answered until 15:40:55.
      const now = GATE_CALLED_AT + 114_000
      expect(now).toBeLessThan(GATE_ANSWERED_AT)
      const status = {
        state: 'working' as const,
        subagents: [{ id: RESUMED_AGENT, agentType: 'general-purpose', state: 'working' as const, startedAt: RESUMED_AT }]
      }
      const lane = deriveReportedBackgroundTasks(resumedLeadRows(), now, status, undefined)
      const row = lane.running.find((task) => task.id === RESUMED_AGENT)
      expect(row?.title).toBe(RESUMED_AGENT_TITLE)
      const merged = mergeSubagentActivity(lane, new Map([[RESUMED_AGENT, resumedAgentRows({ answered: false })]]), { now })
      const strings = drawn(merged.running.find((task) => task.id === RESUMED_AGENT)!, scheme)
      expect(strings).toContain(RESUMED_AGENT_TITLE)
      expect(strings.some((text) => text.startsWith('Running cd '))).toBe(false)
    })

    it('reads the same description once the gate has answered (the case that already worked)', () => {
      const now = GATE_ANSWERED_AT + 1_000
      const status = {
        state: 'working' as const,
        subagents: [{ id: RESUMED_AGENT, agentType: 'general-purpose', state: 'working' as const, startedAt: RESUMED_AT }]
      }
      const lane = deriveReportedBackgroundTasks(resumedLeadRows(), now, status, undefined)
      const merged = mergeSubagentActivity(lane, new Map([[RESUMED_AGENT, resumedAgentRows({ answered: true })]]), { now })
      expect(drawn(merged.running.find((task) => task.id === RESUMED_AGENT)!, scheme)).toContain(RESUMED_AGENT_TITLE)
    })
  })
}
