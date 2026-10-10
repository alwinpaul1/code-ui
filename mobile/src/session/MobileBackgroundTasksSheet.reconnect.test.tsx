// The Background tasks sheet while the relay is down (the user's ask, 2026-10-10).
//
// With no connection to the desktop nothing on the sheet is current, so a running row must not keep
// saying it runs: its time becomes "Status unknown" (muted), its Stop goes (a Stop could not be
// sent), and the Running section says it is reconnecting. A finished row stays as it was: that is a
// fact already received. When the connection returns (a new `lastConnectedAt`) the sheet reads the
// roster again on its own, with no tap, and a Stop held from the old connection is let go: its
// answer belonged to a connection that is gone (CLAUDE.md, "Nothing stays stale once the relay
// connects").

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import { MobileBackgroundTaskCard } from './MobileBackgroundTaskCard'

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
  supportsTaskStop: true,
  tasks: [
    { id: 'dev', kind: 'command', description: 'pnpm dev', startedAt: NOW - 41_000 },
    { id: 'watch', kind: 'command', description: 'pnpm watch', startedAt: NOW - 5_000 }
  ],
  settledTasks: [{ id: 'old', kind: 'command', description: 'pnpm test', state: 'done' }]
}

type Connection = { connected: boolean; lastConnectedAt: number | null }

describe('the background tasks sheet across a disconnect', () => {
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

  function body(connection: Connection, scheme: 'light' | 'dark' = 'light') {
    return createElement(
      ThemeProvider,
      { initialPreference: scheme },
      createElement(MobileBackgroundTasksSheetBody, {
        messages: [],
        hostBackgroundTasks: ROSTER,
        onStopTask,
        connection
      })
    )
  }

  async function show(connection: Connection, scheme: 'light' | 'dark' = 'light') {
    await act(async () => {
      if (renderer) {
        renderer.update(body(connection, scheme))
      } else {
        renderer = create(body(connection, scheme))
      }
    })
  }

  const textNodes = (): ReactTestInstance[] =>
    renderer!.root.findAllByType('Text' as never).filter((node) => typeof node.props.children === 'string')
  const texts = () => textNodes().map((node) => node.props.children as string)
  const stopLabels = () =>
    renderer!.root
      .findAllByType('Pressable' as never)
      .map((node) => String(node.props.accessibilityLabel ?? ''))
      .filter((label) => label.startsWith('Stop '))

  for (const scheme of ['light', 'dark'] as const) {
    it(`says "Status unknown" on running rows and offers no Stop while disconnected (${scheme})`, async () => {
      await show({ connected: true, lastConnectedAt: 1 }, scheme)
      expect(texts()).toEqual(expect.arrayContaining(['41s', '5s']))
      expect(stopLabels()).toEqual(['Stop all running tasks', 'Stop pnpm dev', 'Stop pnpm watch'])

      await show({ connected: false, lastConnectedAt: 1 }, scheme)
      const all = texts()
      expect(all).not.toContain('41s')
      expect(all).not.toContain('5s')
      expect(all.filter((text) => text === 'Status unknown')).toHaveLength(2)
      expect(all).toContain('Status unknown — reconnecting')
      // What already finished stays a fact.
      expect(all).toContain('Completed')
      expect(stopLabels()).toEqual([])
      const palette = scheme === 'dark' ? darkColors : lightColors
      const unknown = textNodes().find((node) => node.props.children === 'Status unknown')!
      const flat = Object.assign({}, ...[unknown.props.style].flat().filter(Boolean))
      expect(flat.color).toBe(palette.textMuted)
    })
  }

  it('reads the roster again by itself when the connection returns, and lets an old Stop go', async () => {
    await show({ connected: true, lastConnectedAt: 1 })
    const stop = renderer!.root
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Stop pnpm dev')!
    await act(async () => {
      stop.props.onPress()
    })
    const held = () =>
      renderer!.root
        .findAllByType('Pressable' as never)
        .find((node) => node.props.accessibilityLabel === 'Stop pnpm dev')!.props.disabled === true
    expect(held()).toBe(true)

    await show({ connected: false, lastConnectedAt: 1 })
    // Time passes while away; the returning connection redraws at once, not on the next tick.
    vi.setSystemTime(NOW + 60_000)
    await show({ connected: true, lastConnectedAt: 2 })
    expect(texts()).toEqual(expect.arrayContaining(['1m 41s', '1m 5s']))
    expect(texts()).not.toContain('Status unknown')
    expect(held()).toBe(false)
  })

  // A structure check: the connection must reach the sheet from the controller, through the overlay,
  // the view and the provider. A dropped prop leaves `connection` undefined, which reads as
  // connected, and every behaviour above would pass while the app still said "Running".
  it('hands the controller connection down to the sheet', () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')
    expect(read('./use-mobile-native-chat-controller.ts')).toMatch(
      /nativeChatHostConnection = useMemo\(\(\) => \(\{ connected: connState === 'connected', lastConnectedAt \}\)/
    )
    expect(read('./MobileNativeChatOverlay.tsx')).toMatch(/hostConnection=\{controller\.nativeChatHostConnection\}/)
    expect(read('./MobileNativeChatView.tsx')).toMatch(/<MobileNativeChatTasksProvider[\s\S]*?hostConnection=\{hostConnection\}/)
    expect(read('./MobileNativeChatTasksProvider.tsx')).toMatch(/<MobileBackgroundTasksSheet[\s\S]*?connection=\{hostConnection\}/)
    expect(read('./MobileBackgroundTasksSheet.tsx')).toMatch(/<MobileBackgroundTasksSheetBody[\s\S]*?connection=\{connection\}/)
  })

  // Review finding (2026-10-10): the reconnect frame that also drops a confirmed row used to put the
  // old connection's holds back (the leave-the-list drop was computed from the pre-reset set).
  it('lets every hold go on a reconnect frame that also drops a confirmed row', async () => {
    const roster2 = (ids: string[]): AgentSessionBackgroundTaskState => ({
      ...ROSTER,
      tasks: (ROSTER.tasks ?? []).filter((task) => ids.includes(task.id))
    })
    const withRoster = (state: AgentSessionBackgroundTaskState, connection: Connection) =>
      createElement(
        ThemeProvider,
        { initialPreference: 'light' },
        createElement(MobileBackgroundTasksSheetBody, { messages: [], hostBackgroundTasks: state, onStopTask, connection })
      )
    await act(async () => {
      renderer = create(withRoster(roster2(['dev', 'watch']), { connected: true, lastConnectedAt: 1 }))
    })
    const press = async (title: string) => {
      const button = renderer!.root
        .findAllByType('Pressable' as never)
        .find((node) => node.props.accessibilityLabel === `Stop ${title}`)!
      await act(async () => {
        button.props.onPress()
      })
    }
    await press('pnpm dev')
    await press('pnpm watch')
    const held = (title: string) =>
      renderer!.root
        .findAllByType('Pressable' as never)
        .find((node) => node.props.accessibilityLabel === `Stop ${title}`)!.props.disabled === true
    expect(held('pnpm watch')).toBe(true)
    await act(async () => {
      renderer!.update(withRoster(roster2(['watch']), { connected: true, lastConnectedAt: 2 }))
    })
    expect(held('pnpm watch')).toBe(false)
  })

  // Review finding: a running Workflow card kept its ticking time while disconnected.
  it('says "Status unknown" on a running workflow card too while disconnected, in both themes', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const card = createElement(MobileBackgroundTaskCard, {
        task: {
          id: 'wf',
          kind: 'workflow',
          title: 'Release review',
          status: 'running',
          startedAt: NOW - 61_000,
          elapsedMs: 61_000,
          workflow: { description: null, phases: null, lanes: null, usage: null }
        } as never,
        statusUnknown: true
      })
      await act(async () => {
        renderer = create(createElement(ThemeProvider, { initialPreference: scheme }, card))
      })
      expect(texts()).toContain('Status unknown')
      expect(texts()).not.toContain('1m 1s')
      act(() => renderer?.unmount())
      renderer = null
    }
  })
})
