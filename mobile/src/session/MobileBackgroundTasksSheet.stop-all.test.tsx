// "Stop all" on the Background tasks sheet (the user's ask, 2026-10-10, from upstream's strip).
//
// It sits in the Running section's header, offered only while at least one running row takes a
// Stop. Each task goes through the same per-task stop as its own button; more than one is confirmed
// first; a task that did not stop is named on the sheet's failure line, one line per task.

import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheet, MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'

const alert = vi.hoisted(() => vi.fn((..._args: unknown[]) => undefined))

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  Alert: { alert },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('Drawer', null, header, children) : null
  }
})
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

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

function roster(
  tasks: { id: string; stoppable?: boolean }[],
  settled: string[] = []
): AgentSessionBackgroundTaskState {
  return {
    state: 'monitoring',
    supportsTaskStop: true,
    tasks: tasks.map(({ id, stoppable }) => ({
      id,
      kind: 'command',
      description: `npm run ${id}`,
      startedAt: NOW - 5_000,
      ...(stoppable === false ? { stoppable: false } : {})
    })),
    settledTasks: settled.map((id) => ({ id, kind: 'command', description: `npm run ${id}`, state: 'done' }))
  }
}

type AlertButton = { text: string; style?: string; onPress?: () => void }

describe('Stop all on the background tasks sheet', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    alert.mockReset()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  async function mountBody(
    state: AgentSessionBackgroundTaskState,
    onStopTask?: (taskId: string, report?: (message: string) => void) => Promise<boolean> | void,
    scheme: 'light' | 'dark' = 'light'
  ) {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider as never,
          { initialPreference: scheme },
          createElement(MobileBackgroundTasksSheetBody, { messages: [], hostBackgroundTasks: state, onStopTask })
        )
      )
    })
  }

  const stopAll = (): ReactTestInstance | undefined =>
    renderer!.root
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Stop all running tasks')

  const texts = () =>
    renderer!.root
      .findAllByType('Text' as never)
      .map((node) => node.props.children)
      .filter((child): child is string => typeof child === 'string')

  for (const scheme of ['light', 'dark'] as const) {
    it(`confirms before stopping more than one, then stops each through its own Stop (${scheme})`, async () => {
      const onStopTask = vi.fn(async (_taskId: string) => true)
      await mountBody(roster([{ id: 'dev' }, { id: 'watch' }, { id: 'fg', stoppable: false }], ['old']), onStopTask, scheme)
      const button = stopAll()!
      expect(button).toBeDefined()
      const label = button.findByType('Text' as never)
      const palette = scheme === 'dark' ? darkColors : lightColors
      expect(label.props.children).toBe('Stop all')
      const flat = Object.assign({}, ...[label.props.style].flat().filter(Boolean))
      expect(flat.color).toBe(palette.textSecondary)

      await act(async () => {
        button.props.onPress()
      })
      expect(onStopTask).not.toHaveBeenCalled()
      expect(alert).toHaveBeenCalledTimes(1)
      const [title, , buttons] = alert.mock.calls[0] as [string, string, AlertButton[]]
      expect(title).toBe('Stop 2 background tasks?')
      expect(buttons.map((entry) => entry.text)).toEqual(['Cancel', 'Stop all'])
      await act(async () => {
        buttons[1]!.onPress?.()
      })
      // Only the rows that take a Stop; never the row the host marked unstoppable or a finished one.
      expect(onStopTask.mock.calls.map((call) => call[0]).sort()).toEqual(['dev', 'watch'])
    })
  }

  it('cancelling the confirmation stops nothing', async () => {
    const onStopTask = vi.fn(async (_taskId: string) => true)
    await mountBody(roster([{ id: 'dev' }, { id: 'watch' }]), onStopTask)
    await act(async () => {
      stopAll()!.props.onPress()
    })
    const buttons = alert.mock.calls[0]![2] as AlertButton[]
    await act(async () => {
      buttons[0]!.onPress?.()
    })
    expect(onStopTask).not.toHaveBeenCalled()
  })

  it('stops a single running task at once, with no confirmation', async () => {
    const onStopTask = vi.fn(async (_taskId: string) => true)
    await mountBody(roster([{ id: 'dev' }, { id: 'fg', stoppable: false }]), onStopTask)
    await act(async () => {
      stopAll()!.props.onPress()
    })
    expect(alert).not.toHaveBeenCalled()
    expect(onStopTask.mock.calls.map((call) => call[0])).toEqual(['dev'])
  })

  it('is not offered when no running row takes a Stop, or with no stop handler', async () => {
    await mountBody(roster([{ id: 'fg', stoppable: false }], ['old']), vi.fn(async () => true))
    expect(stopAll()).toBeUndefined()
    act(() => renderer?.unmount())
    await mountBody(roster([{ id: 'dev' }]))
    expect(stopAll()).toBeUndefined()
  })

  it('names each task that did not stop on the sheet, one line per task', async () => {
    const onStopTask = vi.fn(async (taskId: string, report?: (message: string) => void) => {
      if (taskId === 'watch') {
        report?.("The background task wasn't stopped.")
        return false
      }
      if (taskId === 'serve') {
        report?.('Stop unconfirmed — check chat before retrying')
        return false
      }
      return true
    })
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider as never,
          { initialPreference: 'light' },
          createElement(MobileBackgroundTasksSheet, {
            visible: true,
            messages: [],
            hostBackgroundTasks: roster([{ id: 'dev' }, { id: 'watch' }, { id: 'serve' }]),
            onStopTask,
            reportStopFailure: vi.fn(),
            scopeKey: 'tab-1',
            onClose: vi.fn()
          })
        )
      )
    })
    await act(async () => {
      stopAll()!.props.onPress()
    })
    const buttons = alert.mock.calls[0]![2] as AlertButton[]
    await act(async () => {
      buttons[1]!.onPress?.()
    })
    expect(texts()).toContain(
      "2 of 3 tasks didn't stop.\nnpm run watch: The background task wasn't stopped.\nnpm run serve: Stop unconfirmed — check chat before retrying"
    )
  })

  // Review finding: with nowhere to name the failures, a collecting reporter would swallow them, so
  // each Stop keeps its own reporter (the lane's default: the chat's banner).
  it('leaves each Stop its own failure path when the sheet has nowhere to collect them', async () => {
    const onStopTask = vi.fn(async (_taskId: string, _report?: (message: string) => void) => false)
    await mountBody(roster([{ id: 'dev' }]), onStopTask)
    await act(async () => {
      stopAll()!.props.onPress()
    })
    expect(onStopTask).toHaveBeenCalledTimes(1)
    expect(onStopTask.mock.calls[0]![1]).toBeUndefined()
  })
})
