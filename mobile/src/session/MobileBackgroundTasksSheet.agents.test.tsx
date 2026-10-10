// Which rows of a structured roster carry a Stop, per agent, on the Background tasks sheet.
//
// The sheet reads the host's legacy roster (`backgroundTasks.tasks`), not upstream's child views,
// which need the child-work codec (#22614) this phone does not advertise. So a Stop is drawn from
// the roster's own flags: `supportsTaskStop` and a row's `stoppable`. These cases pin what each
// agent's host change means there.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('Stop on a structured roster, per agent', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function mount(state: AgentSessionBackgroundTaskState, onStopTask: (id: string) => void) {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileBackgroundTasksSheetBody, {
            messages: [],
            hostBackgroundTasks: state,
            onStopTask
          })
        )
      )
    })
  }

  const stopLabels = () =>
    renderer!.root
      .findAllByType('Pressable')
      .map((node) => String(node.props.accessibilityLabel ?? ''))
      .filter((label) => label.startsWith('Stop '))

  async function pressStop(title: string) {
    const button = renderer!.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === `Stop ${title}`)
    await act(async () => {
      button!.props.onPress()
    })
  }

  // Orca #27026: a Codex sub-agent's Stop needs the host's child records (the strip's child views).
  // On the legacy roster this phone reads, the host marks the sub-agent row `stoppable: false`
  // (`withLegacyIds`: a Stop names an id no host record carries), so only the command beside it
  // offers one. Not a phone limit to work around: a Stop drawn there would be refused.
  it("stops a Codex command by its own id and offers none on the sub-agent's legacy row", async () => {
    const onStopTask = vi.fn()
    await mount(
      {
        state: 'monitoring',
        supportsTaskStop: true,
        supportsStopAll: false,
        tasks: [
          {
            id: 'codex-agent:thread-1',
            kind: 'agent',
            description: 'Review the parser',
            stoppable: false
          },
          { id: 'codex-command:exec-1', kind: 'command', description: 'pnpm dev' }
        ]
      },
      onStopTask
    )
    expect(stopLabels()).toEqual(['Stop pnpm dev'])
    await pressStop('pnpm dev')
    expect(onStopTask.mock.calls[0]?.[0]).toBe('codex-command:exec-1')
  })

  // Orca #27022: a Grok host lists the commands and sub-agents Grok left running with `stoppable`
  // and `supportsTaskStop`, the fields this sheet already reads, and `supportsStopAll: false`. Each
  // row stops by its own id. (No phone opens a Grok structured chat yet: those reach a client only
  // through the registered-agents reader. This pins what the sheet does once one does.)
  it('stops a Grok background command and the Grok sub-agent beside it by their own ids', async () => {
    const onStopTask = vi.fn()
    await mount(
      {
        state: 'monitoring',
        supportsTaskStop: true,
        supportsStopAll: false,
        tasks: [
          { id: 'subagent-1', kind: 'agent', description: 'Review the diff' },
          { id: 'acp-task:01a10366', kind: 'command', description: 'Run the dev server' }
        ]
      },
      onStopTask
    )
    expect(stopLabels()).toEqual(expect.arrayContaining(['Stop Run the dev server', 'Stop Review the diff']))
    await pressStop('Run the dev server')
    expect(onStopTask.mock.calls[0]?.[0]).toBe('acp-task:01a10366')
    await pressStop('Review the diff')
    expect(onStopTask.mock.calls[1]?.[0]).toBe('subagent-1')
  })
})
