import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { NativeChatRunSheetContext, type NativeChatRunSheetControl } from './native-chat-tasks-context'
import { mixedRunWithBackgroundAgent } from './fixtures/claude-mixed-tool-run-agent-2026-10-01'

vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      setValue(): void {}
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

// 2026-10-01, the user's screenshots: tapping a run of several calls in the
// Claude app opens a sheet that lists them; Code UI unfolded the row inline
// with raw tool names and inputs. The sheet is the chat provider's
// (`openRun`); the row only asks for it.

const BASH_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls', description: 'List the files' } },
  { type: 'tool-result', output: 'a.ts' },
  { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
  { type: 'tool-result', output: 'x' }
]
const SINGLE_BASH: NativeChatBlock[] = BASH_RUN.slice(0, 2)
const PLAN_AND_BASH: NativeChatBlock[] = [
  { type: 'tool-call', name: 'TodoWrite', input: { todos: [{ content: 'Write the test' }] } },
  { type: 'tool-result', output: 'ok' },
  ...SINGLE_BASH
]

describe('tapping the header of a run of several calls', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function Harness({
    blocks,
    openRun,
    defaultExpanded = false,
    focusView
  }: {
    blocks: NativeChatBlock[]
    openRun?: NativeChatRunSheetControl['open']
    defaultExpanded?: boolean
    focusView?: boolean
  }) {
    const styles = useChatMessageStyles()
    const control: NativeChatRunSheetControl | null = openRun ? { open: openRun, sync: () => {} } : null
    return createElement(
      NativeChatRunSheetContext.Provider,
      { value: control },
      createElement(ToolRun, { blocks, defaultExpanded, focusView, activeCall: null, styles })
    )
  }

  function render(props: Parameters<typeof Harness>[0]): ReactTestRenderer {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <Harness {...props} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  const header = (tree: ReactTestRenderer) => tree.root.findByProps({ testID: 'tool-run-header' })
  const lines = (tree: ReactTestRenderer) => tree.root.findAllByProps({ testID: 'tool-line' })
  const detailPair = (tree: ReactTestRenderer) => tree.root.findByType('MobileNativeChatToolDetailSheet' as never).props.pair

  it('opens the run sheet from a multi-call header, with the run it was tapped on', () => {
    const openRun = vi.fn()
    const tree = render({ blocks: BASH_RUN, openRun })
    act(() => header(tree).props.onPress())
    expect(openRun).toHaveBeenCalledTimes(1)
    expect(openRun.mock.calls[0]![0]).toBe(BASH_RUN)
  })

  it('does not unfold the raw tool rows inline when it opens the sheet', () => {
    const tree = render({ blocks: BASH_RUN, openRun: vi.fn() })
    act(() => header(tree).props.onPress())
    expect(lines(tree)).toHaveLength(0)
  })

  it('opens the run sheet from a mixed run with a plan call, which has its own card inline', () => {
    const openRun = vi.fn()
    const tree = render({ blocks: PLAN_AND_BASH, openRun })
    act(() => header(tree).props.onPress())
    expect(openRun).toHaveBeenCalledTimes(1)
  })

  // exec_command and its poll are two calls but one row of the sheet.
  it('opens the command\'s detail, not a one-row sheet, for a Codex command and its failed poll', () => {
    const openRun = vi.fn()
    const blocks: NativeChatBlock[] = [
      { type: 'tool-call', name: 'exec_command', input: { cmd: 'sleep 90' } },
      { type: 'tool-result', output: 'Process running with session ID 7' },
      { type: 'tool-call', name: 'write_stdin', input: { session_id: 7, chars: '' } },
      { type: 'tool-result', output: 'Process exited with code 1', isError: true }
    ]
    const tree = render({ blocks, openRun })
    act(() => header(tree).props.onPress())
    expect(openRun).not.toHaveBeenCalled()
    expect(detailPair(tree)?.call?.name).toBe('exec_command')
    expect(detailPair(tree)?.result?.output).toContain('Process exited with code 1')
  })

  it('opens the detail sheet straight from a one-call header, as before', () => {
    const openRun = vi.fn()
    const tree = render({ blocks: SINGLE_BASH, openRun })
    act(() => header(tree).props.onPress())
    expect(openRun).not.toHaveBeenCalled()
    expect(detailPair(tree)?.call?.name).toBe('Bash')
  })

  it('opens the run sheet for the five-call run of the 2026-10-01 screenshot once the agent reported', () => {
    const openRun = vi.fn()
    const blocks = mixedRunWithBackgroundAgent()
    const tree = render({ blocks, openRun })
    act(() => header(tree).props.onPress())
    expect(openRun.mock.calls[0]![0]).toBe(blocks)
  })

  it('still closes a run the Tools toggle opened, instead of opening a sheet over it', () => {
    const openRun = vi.fn()
    const tree = render({ blocks: BASH_RUN, openRun, defaultExpanded: true })
    expect(lines(tree)).toHaveLength(2)
    act(() => header(tree).props.onPress())
    expect(openRun).not.toHaveBeenCalled()
    expect(lines(tree)).toHaveLength(0)
  })

  it('keeps focus view unfolding inline, where the row names no call', () => {
    const openRun = vi.fn()
    const tree = render({ blocks: BASH_RUN, openRun, focusView: true })
    act(() => header(tree).props.onPress())
    expect(openRun).not.toHaveBeenCalled()
    expect(lines(tree).length).toBeGreaterThan(0)
  })

  it('unfolds inline where no chat provides a sheet, a subagent transcript for one', () => {
    const tree = render({ blocks: BASH_RUN })
    act(() => header(tree).props.onPress())
    expect(lines(tree)).toHaveLength(2)
  })
})
