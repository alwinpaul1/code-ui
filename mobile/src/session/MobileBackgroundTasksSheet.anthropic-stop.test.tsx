// A running row's Stop on the Anthropic lane, as the Claude app's (dt2.b, j7v.t, 1.261013.20).
// The switch that ships it, CCR_STOP_TASK_THROUGH_ANTHROPIC, is off until the control lane lands;
// this file turns it on so the button's behaviour stays pinned meanwhile. With it off the sheet
// draws no Stop (MobileBackgroundTasksSheet.anthropic.test.tsx).

import type { ReactNode } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { BACKGROUND_AGENT } from './fixtures/claude-background-agent-launch-2.1.296'
import { AGENT_CALL, SHELL_ID, SHELL_CALL, agentAndShellStarted, taskNotification } from './fixtures/ccr-background-task-events-2.1.300'
import { NOW, colorOf, pressable, renderSheet, rerenderSheet, textOf, texts } from './MobileBackgroundTasksSheet.anthropic.test-support'
import { CCR_STOP_FAILED_LINE, type CcrStopTask } from './use-ccr-background-task-lane'

vi.mock('./ccr-background-task-stop', async (importOriginal) => ({ ...(await importOriginal<typeof import('./ccr-background-task-stop')>()), CCR_STOP_TASK_THROUGH_ANTHROPIC: true }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    [
      'Activity', 'ArrowLeft', 'Briefcase', 'ChevronDown', 'ChevronRight', 'CircleStop', 'Diamond', 'Eye', 'FileText', 'Globe', 'ListTodo',
      'ListTree', 'MessageSquare', 'Search', 'Sparkles', 'SquareCode', 'SquareTerminal', 'TextCursorInput', 'TriangleAlert', 'Wrench', 'X'
    ].map((name) => [name, name])
  )
)
vi.mock('../components/MobileMarkdown', async () => {
  const { createElement: h } = await import('react')
  return { MobileMarkdown: (props: { content: string }) => h('MobileMarkdown', { content: props.content }) }
})
vi.mock('../components/BottomDrawer', async () => {
  const { createElement: h } = await import('react')
  return { BottomDrawer: (props: { header: ReactNode; children: ReactNode }) => h('BottomDrawer', null, props.header, props.children) }
})
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: 'DraggableDetailSheet' }))
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard' }))

const SHELL_STOP = 'Stop task: Rerun the rpc-recording suite'
const press = async (renderer: ReactTestRenderer, label: string) =>
  act(async () => {
    ;(pressable(renderer, label)[0]!.props.onPress as () => void)()
  })

describe("a running row's Stop sends the app's stop_task, and says when it could not", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('draws the Stop on each running row, sends it for that task, and reads "Stopping…" until the row ends', async () => {
    const stopTask = vi.fn<CcrStopTask>(async () => true)
    const events = agentAndShellStarted()
    renderer = renderSheet({ events, stopTask })
    expect(pressable(renderer, 'Stop task')).toHaveLength(2)
    await press(renderer, 'Stop task')
    expect(stopTask).toHaveBeenCalledWith(expect.objectContaining({ events, accountId: 'acct', sessionId: 'session_01' }), SHELL_ID)
    expect(texts(renderer)).toContain('Stopping…')
    expect(pressable(renderer, 'Stop task')).toHaveLength(1)
  })

  it("names each Stop button's task, so TalkBack says which one it stops", () => {
    renderer = renderSheet({ events: agentAndShellStarted() })
    const labels = pressable(renderer, 'Stop task').map((node) => node.props.accessibilityLabel as string)
    expect(labels).toEqual([SHELL_STOP, `Stop task: ${BACKGROUND_AGENT.description}`])
  })

  it.each(['light', 'dark'] as const)('a refused POST gives the Stop back and says "Couldn’t stop the task. Try again." in the danger ink (%s)', async (scheme) => {
    renderer = renderSheet({ events: agentAndShellStarted(), scheme, stopTask: async () => false })
    await press(renderer, SHELL_STOP)
    expect(texts(renderer)).not.toContain('Stopping…')
    expect(pressable(renderer, 'Stop task')).toHaveLength(2)
    const line = renderer.root.findAllByType('Text' as never).find((node) => textOf(node) === CCR_STOP_FAILED_LINE)
    expect(line && colorOf(line)).toBe((scheme === 'light' ? lightColors : darkColors).danger)
  })

  it('drops "Couldn’t stop the task" once that task has ended anyway', async () => {
    const stopTask: CcrStopTask = async () => false
    const events = agentAndShellStarted()
    renderer = renderSheet({ events, stopTask })
    await press(renderer, SHELL_STOP)
    expect(texts(renderer)).toContain(CCR_STOP_FAILED_LINE)
    rerenderSheet(renderer, { events: [...events, taskNotification({ taskId: SHELL_ID, toolUseId: SHELL_CALL, status: 'completed', at: NOW })], stopTask })
    expect(texts(renderer)).not.toContain(CCR_STOP_FAILED_LINE)
  })

  it('keeps "Couldn’t stop the task" while that task still runs and another ends', async () => {
    const stopTask: CcrStopTask = async () => false
    const events = agentAndShellStarted()
    renderer = renderSheet({ events, stopTask })
    await press(renderer, SHELL_STOP)
    rerenderSheet(renderer, { events: [...events, taskNotification({ taskId: BACKGROUND_AGENT.agentId, toolUseId: AGENT_CALL, status: 'completed', at: NOW })], stopTask })
    expect(texts(renderer)).toContain(CCR_STOP_FAILED_LINE)
  })

  it('keeps "Stopping…" across a brief drop of the stream', async () => {
    const stopTask: CcrStopTask = async () => true
    const events = agentAndShellStarted()
    renderer = renderSheet({ events, stopTask })
    await press(renderer, SHELL_STOP)
    expect(texts(renderer)).toContain('Stopping…')
    rerenderSheet(renderer, { events: null, stopTask })
    rerenderSheet(renderer, { events, stopTask })
    expect(texts(renderer)).toContain('Stopping…')
    expect(pressable(renderer, SHELL_STOP)).toHaveLength(0)
  })

  it('draws no Stop on a finished row', () => {
    renderer = renderSheet({ events: [...agentAndShellStarted(), taskNotification({ taskId: SHELL_ID, toolUseId: 'x', status: 'completed', at: NOW }), taskNotification({ taskId: BACKGROUND_AGENT.agentId, toolUseId: AGENT_CALL, status: 'completed', at: NOW })] })
    expect(pressable(renderer, 'Stop task')).toHaveLength(0)
  })
})
