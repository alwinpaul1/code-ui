// The Background tasks sheet's Stop presses, on the structured lane (the host's roster).
//
// Orca #26780: a Stop the host confirmed (`cancelled: true`) keeps that row's button held from the
// press until the row leaves the list. It used to come back for the moment between the confirmation
// and the roster dropping the row, so it looked pressable on a task that was already stopping. A
// failed, unconfirmed or nothing-stopped answer gives it back at once, and so does a row that leaves
// and comes back (that task was not ended). No timer: the hold is the answer plus the row listed.

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
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
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Terminal: 'Terminal',
  X: 'X'
}))

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

function roster(ids: readonly string[]): AgentSessionBackgroundTaskState {
  return {
    state: 'monitoring',
    supportsTaskStop: true,
    tasks: ids.map((id) => ({ id, kind: 'command', description: `npm run ${id}`, startedAt: NOW - 5_000 }))
  }
}

type Deferred = { resolve: (confirmed: boolean) => void }

describe('a Stop pressed on the background tasks sheet', () => {
  let renderer: ReactTestRenderer | null = null
  let pending: Deferred[] = []
  const onStopTask = vi.fn(
    (_taskId: string) =>
      new Promise<boolean>((resolve) => {
        pending.push({ resolve })
      })
  )

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    pending = []
    onStopTask.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  function body(state: AgentSessionBackgroundTaskState, scheme: 'light' | 'dark' = 'light') {
    return createElement(
      ThemeProvider,
      { initialPreference: scheme },
      createElement(MobileBackgroundTasksSheetBody, {
        messages: [],
        hostBackgroundTasks: state,
        onStopTask
      })
    )
  }

  async function mount(state: AgentSessionBackgroundTaskState, scheme: 'light' | 'dark' = 'light') {
    await act(async () => {
      renderer = create(body(state, scheme))
    })
  }

  async function show(state: AgentSessionBackgroundTaskState) {
    await act(async () => {
      renderer!.update(body(state))
    })
  }

  function stopButton(title: string): ReactTestInstance {
    const found = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === `Stop ${title}`)
    if (!found) {
      throw new Error(`no Stop for ${title}`)
    }
    return found
  }

  const held = (title: string) => stopButton(title).props.disabled === true

  for (const scheme of ['light', 'dark'] as const) {
    it(`holds a confirmed Stop until the row leaves, then a returning row offers it again (${scheme})`, async () => {
      await mount(roster(['dev']), scheme)
      expect(held('npm run dev')).toBe(false)
      await act(async () => {
        stopButton('npm run dev').props.onPress()
      })
      expect(onStopTask.mock.calls[0]?.[0]).toBe('dev')
      expect(held('npm run dev')).toBe(true)
      // A second press while it is on its way sends nothing.
      await act(async () => {
        stopButton('npm run dev').props.onPress()
      })
      expect(onStopTask).toHaveBeenCalledTimes(1)

      await act(async () => pending[0]!.resolve(true))
      // Confirmed, still listed: the button stays held.
      expect(held('npm run dev')).toBe(true)

      await show(roster([]))
      await show(roster(['dev']))
      expect(held('npm run dev')).toBe(false)
    })
  }

  it('gives the Stop back at once when the host did not confirm it', async () => {
    await mount(roster(['dev', 'watch']))
    await act(async () => {
        stopButton('npm run dev').props.onPress()
      })
    expect(held('npm run dev')).toBe(true)
    expect(held('npm run watch')).toBe(false)
    await act(async () => pending[0]!.resolve(false))
    expect(held('npm run dev')).toBe(false)
  })
})
