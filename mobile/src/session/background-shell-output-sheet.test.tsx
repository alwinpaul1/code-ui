import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { READ_SHELL, readShellRows } from './fixtures/claude-shell-output-reads'
import { capturedShellOutput } from './mobile-background-shell-output'
import { BackgroundShellOutputBody } from './MobileBackgroundShellOutputSheet'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import { ToolDetailBody } from './MobileNativeChatToolDetailSheet'
import { NativeChatTranscriptProvider } from './native-chat-transcript-context'

// Parity gap G27: the Claude app's finished shell row is tappable ("Show
// output", with a chevron) and opens the shell's output: "Loading output…",
// "No output captured", "Output truncated" (1.261009.20, `cu2`, `wy20`). The
// phone has no call for it; it shows the agent's own last read of the output
// file (mobile-background-shell-output.ts), from the Background tasks sheet and
// from the launching Bash call's own sheet. Real session rows only.

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: 'DraggableDetailSheet' }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard' }))
vi.mock('react-native-gesture-handler', async () => {
  const { createElement: h } = await import('react')
  const builder: unknown = new Proxy({}, { get: (_, key) => (key === 'kind' ? 'native' : () => builder) })
  return {
    Gesture: { Native: () => builder },
    GestureDetector: (props: Record<string, unknown>) => h('GestureDetector', props)
  }
})
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  Terminal: 'Terminal',
  X: 'X'
}))

function renderTree(children: ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{children}</ThemeProvider>)
  })
  return renderer
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') {
    return node
  }
  return node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')
}

function flat(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style
  const entries = (Array.isArray(style) ? style.flat() : [style]) as (Record<string, unknown> | null | undefined)[]
  return Object.assign({}, ...entries.filter(Boolean))
}

const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType('Text' as never).map((n) => textOf(n))
const byTestId = (renderer: ReactTestRenderer, id: string) =>
  renderer.root.findAll((n) => n.props.testID === id && typeof n.type === 'string')

const NOW = Date.UTC(2026, 9, 12, 9, 0, 0)

const ROSTER: AgentSessionBackgroundTaskState = {
  state: 'monitoring',
  supportsTaskStop: true,
  tasks: [{ id: 'sh-live', kind: 'command', description: 'pnpm dev --port 8081', startedAt: NOW - 41_000 }],
  settledTasks: [
    { id: 'sh-done', kind: 'command', description: 'pnpm test', state: 'done' },
    { id: 'ag-done', kind: 'agent', description: 'Audit the release notes', state: 'done' }
  ]
}

const showOutputButtons = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType('Pressable' as never).filter((n) => String(n.props.accessibilityLabel ?? '').endsWith('Show output'))

describe('a finished shell row opens its output, as the Claude app’s does', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['light', 'dark'] as const)('makes only the finished shell tappable, with a chevron, and hands its task to the opener (%s)', (scheme) => {
    const opened: string[] = []
    renderer = renderTree(
      createElement(MobileBackgroundTasksSheetBody, {
        messages: [],
        hostBackgroundTasks: ROSTER,
        onShowOutput: (task: { id: string }) => opened.push(task.id)
      }),
      scheme
    )
    const buttons = showOutputButtons(renderer)
    expect(buttons.map((n) => n.props.accessibilityLabel)).toEqual(['pnpm test, Show output'])
    expect(buttons[0]!.findAllByType('ChevronRight' as never)).toHaveLength(1)
    act(() => {
      ;(buttons[0]!.props.onPress as () => void)()
    })
    expect(opened).toEqual(['sh-done'])
  })

  it('makes no row tappable where nothing opens output', () => {
    renderer = renderTree(createElement(MobileBackgroundTasksSheetBody, { messages: [], hostBackgroundTasks: ROSTER }))
    expect(showOutputButtons(renderer)).toHaveLength(0)
  })
})

describe('the shell output sheet', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['light', 'dark'] as const)("draws the agent's read of the file in the code face, and says the shell was still running (%s)", (scheme) => {
    const colors = scheme === 'light' ? lightColors : darkColors
    renderer = renderTree(<BackgroundShellOutputBody capture={capturedShellOutput(readShellRows(), READ_SHELL)} />, scheme)
    const output = byTestId(renderer, 'shell-output-text').find((n) => String(n.type) === 'Text')
    expect(textOf(output!).split('\n')[0]).toBe('lint=1')
    expect(texts(renderer)).toContain('Read while the shell was still running')
    const box = byTestId(renderer, 'shell-output-box').find((n) => String(n.type) === 'View')
    expect(flat(box!).backgroundColor).toBe(colors.bgSunken)
  })

  it('says "No output captured", and why, when the agent never read the file on its own', () => {
    renderer = renderTree(<BackgroundShellOutputBody capture={{ kind: 'none' }} />)
    expect(texts(renderer)).toContain('No output captured')
    expect(texts(renderer).join('\n')).toMatch(/desktop does not share/)
  })

  it('says "Output truncated" over a part of the file', () => {
    renderer = renderTree(
      <BackgroundShellOutputBody capture={{ kind: 'captured', text: '[exited with code 0]', truncated: true, whileRunning: false, via: 'Bash' }} />
    )
    expect(texts(renderer)).toContain('Output truncated')
    expect(texts(renderer)).not.toContain('Read while the shell was still running')
  })
})

describe("the launching Bash call's sheet shows the shell's output too", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const rows = readShellRows()
  const launch: NativeChatToolPair = {
    call: rows[0]!.blocks[0] as NativeChatToolPair['call'],
    result: rows[1]!.blocks[0] as NativeChatToolPair['result']
  }

  it('adds a Shell output section from the transcript the chat holds', () => {
    renderer = renderTree(
      <NativeChatTranscriptProvider messages={rows}>
        <ToolDetailBody pair={launch} />
      </NativeChatTranscriptProvider>
    )
    const labels = byTestId(renderer, 'tool-detail-section-label').map((n) => textOf(n))
    expect(labels).toContain('Shell output')
    const output = byTestId(renderer, 'shell-output-text').find((n) => String(n.type) === 'Text')
    expect(textOf(output!).split('\n')[0]).toBe('lint=1')
  })

  it('adds nothing to a foreground command, or where no transcript is at hand', () => {
    const foreground: NativeChatMessage[] = []
    renderer = renderTree(
      <NativeChatTranscriptProvider messages={foreground}>
        <ToolDetailBody
          pair={{
            call: { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
            result: { type: 'tool-result', output: 'a\nb\n' }
          }}
        />
      </NativeChatTranscriptProvider>
    )
    expect(byTestId(renderer, 'tool-detail-section-label').map((n) => textOf(n))).not.toContain('Shell output')
    act(() => renderer?.unmount())
    renderer = renderTree(<ToolDetailBody pair={launch} />)
    expect(byTestId(renderer, 'tool-detail-section-label').map((n) => textOf(n))).not.toContain('Shell output')
  })
})
