// Per-task token counts on the Background tasks sheet (the user's ask, 2026-10-10, from upstream's
// strip, which draws "18.1k · 2m").
//
// Only where the host states them: a structured roster row's `totalTokens` (provider-reported,
// cumulative). A row without it shows no figure, never a guess, and neither does a terminal tab's
// row (its transcript reader has no per-task usage; a Workflow's totals stay on its own card).

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import { projectStructuredBackgroundTasks } from './mobile-structured-background-tasks'

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
  Terminal: 'Terminal',
  X: 'X'
}))

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

const ROSTER: AgentSessionBackgroundTaskState = {
  state: 'monitoring',
  tasks: [
    { id: 'ag-1', kind: 'agent', description: 'Audit the release notes', startedAt: NOW - 120_000, totalTokens: 18_100 },
    { id: 'sh-1', kind: 'command', description: 'pnpm dev', startedAt: NOW - 5_000 }
  ],
  settledTasks: [{ id: 'ag-0', kind: 'agent', description: 'Explore the repo', state: 'done', totalTokens: 1_250_000 }]
}

describe('per-task token counts on the background tasks sheet', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('carries the host figure through the projection, and nothing where the host gave none', () => {
    const projected = projectStructuredBackgroundTasks(
      {
        ...ROSTER,
        tasks: [...(ROSTER.tasks ?? []), { id: 'bad', kind: 'command', description: 'x', totalTokens: Number.NaN }]
      },
      NOW
    )!
    expect(projected.running.map((task) => task.totalTokens)).toEqual([18_100, undefined, undefined])
    expect(projected.finished[0]!.totalTokens).toBe(1_250_000)
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`shows the figure beside the time on a row that has one, and none on a row without (${scheme})`, async () => {
      await act(async () => {
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: scheme },
            createElement(MobileBackgroundTasksSheetBody, { messages: [], hostBackgroundTasks: ROSTER })
          )
        )
      })
      const nodes = renderer!.root
        .findAllByType('Text' as never)
        .filter((node) => typeof node.props.children === 'string')
      const texts = nodes.map((node) => node.props.children as string)
      expect(texts).toContain('18K tokens')
      expect(texts).toContain('1.3M tokens')
      expect(texts.filter((text) => text.endsWith(' tokens'))).toHaveLength(2)
      const palette = scheme === 'dark' ? darkColors : lightColors
      const figure = nodes.find((node) => node.props.children === '18K tokens')!
      const flat = Object.assign({}, ...[figure.props.style].flat().filter(Boolean))
      expect(flat.color).toBe(palette.textMuted)
    })
  }

  it('drops a running row figure while disconnected, with its time', async () => {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileBackgroundTasksSheetBody, {
            messages: [],
            hostBackgroundTasks: ROSTER,
            connection: { connected: false, lastConnectedAt: 1 }
          })
        )
      )
    })
    const texts = renderer!.root
      .findAllByType('Text' as never)
      .map((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string')
    expect(texts).not.toContain('18K tokens')
    expect(texts).toContain('1.3M tokens')
  })
})
