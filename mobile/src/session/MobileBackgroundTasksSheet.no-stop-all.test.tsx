// No "Stop all" on the Background tasks sheet (the user, 2026-10-11, beside screenshots of the
// Claude Android app: "stop all and view transcript remove those"). The Claude app's Running
// header is the word and its chevron, nothing at its right; each running row keeps its own Stop.
// It replaces the 2026-10-10 Stop all, the fork's own addition over upstream's strip.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'

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

const NOW = Date.UTC(2026, 9, 11, 7, 48, 40)

function roster(ids: string[], settled: string[] = []): AgentSessionBackgroundTaskState {
  return {
    state: 'monitoring',
    supportsTaskStop: true,
    tasks: ids.map((id) => ({ id, kind: 'command', description: `npm run ${id}`, startedAt: NOW - 5_000 })),
    settledTasks: settled.map((id) => ({ id, kind: 'command', description: `npm run ${id}`, state: 'done' }))
  }
}

describe('the Background tasks sheet has no Stop all, as the Claude app has none', () => {
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

  async function mount(state: AgentSessionBackgroundTaskState, scheme: 'light' | 'dark' = 'light') {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider as never,
          { initialPreference: scheme },
          createElement(MobileBackgroundTasksSheetBody, { messages: [], hostBackgroundTasks: state, onStopTask: vi.fn(async () => true) })
        )
      )
    })
  }

  const labels = () =>
    renderer!.root
      .findAllByType('Pressable' as never)
      .map((node) => node.props.accessibilityLabel)
      .filter((label): label is string => typeof label === 'string')
  const texts = () =>
    renderer!.root
      .findAllByType('Text' as never)
      .map((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string')

  for (const scheme of ['light', 'dark'] as const) {
    it(`draws no Stop all over three running rows, and each row keeps its own Stop (${scheme})`, async () => {
      await mount(roster(['dev', 'watch', 'lint'], ['old']), scheme)

      expect(texts()).not.toContain('Stop all')
      expect(labels()).not.toContain('Stop all running tasks')
      expect(labels().filter((label) => label.startsWith('Stop '))).toEqual(['Stop npm run dev', 'Stop npm run watch', 'Stop npm run lint'])
    })
  }

  it('draws none over a single running row, nor over an empty Running section', async () => {
    await mount(roster(['dev']))
    expect(texts()).not.toContain('Stop all')
    expect(labels().filter((label) => label.startsWith('Stop '))).toEqual(['Stop npm run dev'])
    act(() => renderer?.unmount())

    await mount(roster([], ['old']))
    expect(texts()).not.toContain('Stop all')
    expect(texts()).toContain('Nothing running.')
  })
})
