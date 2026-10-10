import { useEffect, useRef, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { ToolRun } from './MobileNativeChatToolRun'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatTasksProvider } from './MobileNativeChatTasksProvider'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { mixedRunWithBackgroundAgent } from './fixtures/claude-mixed-tool-run-agent-2026-10-01'

// 2026-10-10, the user's Claude app screenshots: a tap on one tool row
// ("Ran Read the gate and timing result ›") opens a sheet titled "Bash" over
// "Completed", then Description, Command and Output boxes. A tap on a row of
// the multi-call run sheet opens the same sheet. This drives both through the
// chat's real rows and the real detail sheet; only the sheet's animated shell
// and the drawer are stood in for.

vi.mock('react-native', () => ({
  Animated: {
    Text: 'Text',
    View: 'View',
    Value: class {
      setValue(): void {}
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    sequence: () => ({}),
    timing: () => ({})
  },
  Image: 'Image',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    [
      'ChevronDown', 'ChevronRight', 'Copy', 'Image', 'ListTodo', 'Eye', 'Globe', 'MessageSquare', 'Pencil',
      'Search', 'SquareChevronRight', 'SquareTerminal', 'Wrench', 'X', 'Undo2', 'Sparkles', 'AlertCircle',
      'AlertTriangle', 'Info', 'ArrowUp', 'Briefcase', 'FileText', 'TriangleAlert'
    ].map((name) => [name, name])
  )
)
vi.mock('react-native-gesture-handler', async () => {
  const { createElement: h } = await import('react')
  const builder: unknown = new Proxy({}, { get: () => () => builder })
  return {
    Gesture: { Native: () => builder },
    GestureDetector: (props: Record<string, unknown>) => h('GestureDetector', props)
  }
})
// The sheet's shell: shown while visible, as the real one is once it has slid in.
vi.mock('../components/DraggableDetailSheet', () => ({
  DraggableDetailSheet: ({ visible, header, children }: { visible: boolean; header: ReactNode; children: ReactNode }) =>
    visible ? (
      <>
        {header}
        {children}
      </>
    ) : null
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: function MockDrawer({
    visible,
    header,
    onAfterClose,
    children
  }: {
    visible: boolean
    header?: ReactNode
    onAfterClose?: () => void
    children: ReactNode
  }) {
    const wasVisible = useRef(visible)
    useEffect(() => {
      if (wasVisible.current && !visible) {
        onAfterClose?.()
      }
      wasVisible.current = visible
    }, [visible, onAfterClose])
    return visible ? (
      <>
        {header}
        {children}
      </>
    ) : null
  }
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('./MobileBackgroundTasksSheet', () => ({ MobileBackgroundTasksSheet: 'BackgroundTasksSheet' }))
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  return { MobileMarkdown: ({ content }: { content: string }) => React.createElement('Text', null, content) }
})

const STATUS = {
  state: 'idle',
  prompt: '',
  updatedAt: 0,
  stateStartedAt: 0,
  subagents: []
} as unknown as AgentStatusEntry

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')
}

const textById = (tree: ReactTestRenderer, testID: string): string[] =>
  tree.root.findAllByType('Text' as never).filter((n) => n.props.testID === testID).map((n) => textOf(n))

function boxColors(tree: ReactTestRenderer): unknown[] {
  return tree.root
    .findAll((n) => n.props.testID === 'tool-detail-box' && String(n.type) === 'View')
    .map((n) => Object.assign({}, ...[n.props.style].flat().filter(Boolean)).backgroundColor)
}

const press = async (tree: ReactTestRenderer, testID: string, index = 0) =>
  act(async () => tree.root.findAll((n) => n.props.testID === testID && String(n.type) === 'Pressable')[index]!.props.onPress())

describe('a tool row opens the Claude-app tool sheet', () => {
  let tree: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => tree?.unmount())
    tree = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('opens "Bash", Completed, with Description, Command and Output from a single row (%s)', async (scheme, colors) => {
    const blocks: NativeChatBlock[] = [
      {
        type: 'tool-call',
        name: 'Bash',
        input: { command: 'cat /tmp/gate.log', description: 'Read the gate and timing result' }
      },
      { type: 'tool-result', output: 'PASS\n' }
    ]
    function Row() {
      const styles = useChatMessageStyles()
      return <ToolRun blocks={blocks} defaultExpanded={false} revertScope="m:0" styles={styles} />
    }
    await act(async () => {
      tree = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatTasksProvider messages={[]} agent="claude" agentWorking={false} agentStatus={STATUS}>
            <Row />
          </MobileNativeChatTasksProvider>
        </ThemeProvider>
      )
    })
    expect(textById(tree!, 'tool-detail-title')).toEqual([])
    await press(tree!, 'tool-run-header')
    expect(textById(tree!, 'tool-detail-title')).toEqual(['Bash'])
    expect(textById(tree!, 'tool-detail-status')).toEqual(['Completed'])
    expect(textById(tree!, 'tool-detail-section-label')).toEqual(['Description', 'Command', 'Output'])
    expect(textById(tree!, 'tool-detail-output')).toEqual(['PASS\n'])
    expect(boxColors(tree!)).toEqual([colors.bgSunken, colors.bgSunken, colors.bgSunken])
  })

  it('opens the same sheet from a row of the multi-call run sheet', async () => {
    const list: NativeChatMessage[] = [
      {
        id: 'mixed-1',
        role: 'assistant',
        timestamp: Date.parse('2026-10-01T09:00:00.000Z'),
        source: 'transcript',
        blocks: [{ type: 'text', text: 'Cancelling the old jobs.' }, ...mixedRunWithBackgroundAgent()]
      }
    ]
    await act(async () => {
      tree = create(
        <ThemeProvider initialPreference="dark">
          <MobileNativeChatTasksProvider messages={list} agent="claude" agentWorking={false} agentStatus={STATUS}>
            <MobileNativeChatMessage message={foldMobileNativeChatMessages(list).at(-1)!} />
          </MobileNativeChatTasksProvider>
        </ThemeProvider>
      )
    })
    await press(tree!, 'tool-run-header')
    await press(tree!, 'run-sheet-row', 1)
    expect(tree!.root.findAll((n) => n.props.testID === 'run-sheet')).toHaveLength(0)
    expect(textById(tree!, 'tool-detail-title')).toEqual(['Bash'])
    expect(textById(tree!, 'tool-detail-section-label').slice(0, 2)).toEqual(['Description', 'Command'])
    expect(textById(tree!, 'tool-detail-section-label')).not.toContain('Inputs')
  })
})
