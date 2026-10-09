import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import {
  isToolCallBlock,
  type NativeChatBlock,
  type NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import { darkColors, fontFamily, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'

// The Claude Android app's row while a command runs (user screenshot,
// 2026-10-09): a terminal icon, "Running" with the moving shimmer, a chevron.
// Ours draws that row (ToolRun's active branch); these pin the places it
// drifted from the running-agent row it is meant to match.

vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {},
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
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Circle: 'Circle',
  CircleCheck: 'CircleCheck',
  CircleDot: 'CircleDot',
  ListChecks: 'ListChecks',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

const RUNNING_BASH: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'Bash',
    input: { command: 'pnpm test', description: 'Run the unit tests' },
    state: 'running'
  }
]
const FINISHED_BASH: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'Bash',
    input: { command: 'pnpm test', description: 'Run the unit tests' },
    state: 'completed'
  },
  { type: 'tool-result', output: 'ok' }
]
// A mixed run whose newest step is the running command.
const MIXED_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' }, state: 'completed' },
  { type: 'tool-result', output: 'ok' },
  {
    type: 'tool-call',
    name: 'Edit',
    input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
    state: 'completed'
  },
  { type: 'tool-result', output: 'ok' },
  { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'running' }
]
// A turn's earlier run, settled, while a later run of the same turn still works.
const EARLIER_RUN: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls' }, state: 'completed' },
  { type: 'tool-result', output: 'a' },
  { type: 'tool-call', name: 'Bash', input: { command: 'pwd' }, state: 'completed' },
  { type: 'tool-result', output: '/' }
]

function Harness({
  blocks,
  activeCall
}: {
  blocks: NativeChatBlock[]
  activeCall: NativeChatToolCallBlock | null
}): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded: false, activeCall, styles })
}

describe('the collapsed row of a command that is still running', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    blocks: NativeChatBlock[],
    scheme: 'light' | 'dark' = 'light',
    activeCall: NativeChatToolCallBlock | null = selectActiveToolCall(blocks, {
      activeTurnIsWorking: true
    })
  ): ReactTestRenderer {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Harness blocks={blocks} activeCall={activeCall} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  const header = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) => node.props?.testID === 'tool-run-active-header' && String(node.type) === 'Pressable'
    )
  const label = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) => node.props?.testID === 'tool-run-active-label' && String(node.type) === 'Text'
    )
  const glyphs = (tree: ReactTestRenderer): string =>
    label(tree)
      .findAll((node) => String(node.type) === 'Text' && node !== label(tree))
      .map((node) => String(node.props.children))
      .join('')
  const flat = (style: unknown): Record<string, unknown> =>
    Object.assign({}, ...[style].flat(4).filter((entry) => entry && typeof entry === 'object'))
  const texts = (tree: ReactTestRenderer): string[] =>
    tree.root
      .findAllByType('Text' as never)
      .map((node) =>
        [node.props.children]
          .flat()
          .filter((child) => typeof child === 'string' || typeof child === 'number')
          .join('')
      )

  it('draws the shimmering word "Running" for a running Bash call', () => {
    const tree = render(RUNNING_BASH)
    expect(glyphs(tree)).toBe('Running')
    expect(header(tree).findAll((node) => String(node.type) === 'SquareTerminal')).toHaveLength(1)
    expect(header(tree).findAll((node) => String(node.type) === 'ChevronRight')).toHaveLength(1)
  })

  it('stops the shimmer once the command finishes, and says "Ran a command"', () => {
    const tree = render(FINISHED_BASH)
    expect(tree.root.findAll((node) => node.props?.testID === 'tool-run-active-label')).toEqual([])
    expect(texts(tree)).toContain('Ran Run the unit tests')
  })

  it('draws it for a mixed run whose newest step is the running command', () => {
    const tree = render(MIXED_RUN)
    expect(glyphs(tree)).toBe('Running')
    expect(texts(tree).some((text) => text.startsWith('Ran '))).toBe(false)
  })

  it('leaves an earlier settled run of the same turn on its own sentence', () => {
    // The turn's live call belongs to the later run. Handed to this one as
    // well, it drew a second "Running" row over a run that had finished.
    const live = selectActiveToolCall(RUNNING_BASH, { activeTurnIsWorking: true })
    const tree = render(EARLIER_RUN, 'light', live)
    expect(tree.root.findAll((node) => node.props?.testID === 'tool-run-active-label')).toEqual([])
    expect(texts(tree)).toContain('Ran 2 commands')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('is worded like the running-agent row, in %s', (scheme, palette) => {
    const style = flat(label(render(RUNNING_BASH, scheme)).props.style)
    // The agent row's face and size (toolRunLabel: Medium 13), not a lighter
    // one that makes the word change weight when the row settles into "Ran …".
    expect(style.fontFamily).toBe(fontFamily.medium)
    expect(style.fontSize).toBe(13)
    expect(style.color).toBe(palette.textSecondary)
  })

  it.each([
    ['with a description', RUNNING_BASH, 'Running command, Run the unit tests'],
    ['with only a command', MIXED_RUN, 'Running command, pnpm test']
  ] as const)('says what is running to a screen reader, %s', (_name, blocks, spoken) => {
    expect(header(render([...blocks])).props.accessibilityLabel).toBe(spoken)
  })

  it('names a non-command tool by its own word to a screen reader', () => {
    const read: NativeChatBlock[] = [
      { type: 'tool-call', name: 'Read', input: { file_path: 'src/app.ts' }, state: 'running' }
    ]
    const call = read.find(isToolCallBlock)!
    expect(header(render(read, 'light', call)).props.accessibilityLabel).toBe(
      'Running Read, src/app.ts'
    )
  })
})
