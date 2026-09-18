// Focus view (extension `claudeCode.focusView`): a run of tool calls folds to
// one "N tool calls" row so only the conversation shows, and one tap unfolds
// it. Off, the run reads exactly as it does today — the sentence, the member
// arguments, the pulsing "Running" — which the first test pins by comparing
// the two trees, not by trusting the default.

import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import { ToolRun } from './MobileNativeChatToolRun'

vi.mock('react-native', () => ({
  Animated: {
    Text: 'AnimatedText',
    Value: class {
      constructor(private value: number) {}
      setValue(next: number): void {
        this.value = next
      }
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

const THREE_CALLS: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'completed' },
  { type: 'tool-result', output: 'ok' },
  { type: 'tool-call', name: 'Read', input: { file_path: '/w/src/app.ts' }, state: 'completed' },
  { type: 'tool-result', output: 'const a = 1' },
  { type: 'tool-call', name: 'Grep', input: { pattern: 'TODO' }, state: 'completed' },
  { type: 'tool-result', output: '' }
]

const ONE_CALL: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'completed' },
  { type: 'tool-result', output: 'ok' }
]

const RUNNING: NativeChatToolCallBlock = {
  type: 'tool-call',
  name: 'Bash',
  input: { command: 'pnpm test' },
  state: 'running'
}

type HarnessProps = {
  blocks: NativeChatBlock[]
  focusView?: boolean
  defaultExpanded?: boolean
  activeCall?: NativeChatToolCallBlock | null
}

function Harness({
  blocks,
  focusView,
  defaultExpanded = false,
  activeCall = null
}: HarnessProps): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, {
    blocks,
    defaultExpanded,
    activeCall,
    styles,
    ...(focusView === undefined ? {} : { focusView })
  })
}

describe('Focus view on a run of tool calls', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(props: HarnessProps, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: scheme }, createElement(Harness, props))
      )
    })
    return renderer!
  }

  const texts = (root: ReactTestInstance): string[] =>
    root
      .findAll((node) => node.type === 'Text' || node.type === 'AnimatedText')
      .map((node) => (typeof node.props.children === 'string' ? node.props.children : ''))
      .filter(Boolean)

  const header = (root: ReactTestInstance): ReactTestInstance =>
    root.findAll((node) => node.props?.accessibilityRole === 'button')[0]!

  /** The rendered tree with closures (onPress, Pressable style) normalised, so
   *  two renders of the same thing compare equal. */
  const shape = (tree: ReactTestRenderer): string =>
    JSON.stringify(tree.toJSON(), (_key, value: unknown) =>
      typeof value === 'function' ? '[fn]' : value
    )

  it('leaves the run exactly as it is today when the setting is off', () => {
    const today = shape(render({ blocks: THREE_CALLS }))
    act(() => renderer?.unmount())
    renderer = null
    const off = shape(render({ blocks: THREE_CALLS, focusView: false }))
    expect(off).toBe(today)
    // And "today" is the sentence, not a count.
    expect(texts(renderer!.root)).toContain(toolRunSentence(THREE_CALLS))
    expect(texts(renderer!.root).some((text) => /tool calls?$/.test(text))).toBe(false)
  })

  it('folds the run to its call count and shows nothing of what the tools did', () => {
    const tree = render({ blocks: THREE_CALLS, focusView: true })
    const shown = texts(tree.root)
    expect(shown).toContain('3 tool calls')
    expect(shown).not.toContain(toolRunSentence(THREE_CALLS))
    expect(shown.join(' ')).not.toContain('pnpm test')
    expect(shown.join(' ')).not.toContain('app.ts')
  })

  it('says "1 tool call" for one', () => {
    expect(texts(render({ blocks: ONE_CALL, focusView: true }).root)).toContain('1 tool call')
  })

  it('unfolds to the tool lines on one tap, and folds back on the next', () => {
    const tree = render({ blocks: THREE_CALLS, focusView: true })
    expect(texts(tree.root).join(' ')).not.toContain('pnpm test')
    act(() => header(tree.root).props.onPress())
    expect(texts(tree.root).join(' ')).toContain('pnpm test')
    // The row keeps its count while open, so the label does not jump.
    expect(texts(tree.root)).toContain('3 tool calls')
    act(() => header(tree.root).props.onPress())
    expect(texts(tree.root).join(' ')).not.toContain('pnpm test')
  })

  it('still answers the global Tools toggle: the run opens with the count as its header', () => {
    const tree = render({ blocks: THREE_CALLS, focusView: true, defaultExpanded: true })
    expect(texts(tree.root).join(' ')).toContain('pnpm test')
    expect(texts(tree.root)).toContain('3 tool calls')
  })

  it('reads its count while a call is still running, in place of "Running"', () => {
    const tree = render({ blocks: [RUNNING], focusView: true, activeCall: RUNNING })
    expect(texts(tree.root)).toContain('1 tool call')
    expect(texts(tree.root)).not.toContain('Running')
  })

  it('keeps "Running" while a call runs with the setting off', () => {
    const tree = render({ blocks: [RUNNING], focusView: false, activeCall: RUNNING })
    expect(texts(tree.root)).toContain('Running')
  })

  it('colours the folded row for the theme in use, in light and in dark', () => {
    const colourOf = (root: ReactTestInstance): string | undefined => {
      const label = root
        .findAll((node) => node.type === 'Text' || node.type === 'AnimatedText')
        .find((node) => node.props.children === '3 tool calls')
      const entries = [label?.props.style].flat(3)
      let colour: string | undefined
      for (const entry of entries) {
        const value = (entry as { color?: unknown } | null | undefined)?.color
        if (typeof value === 'string') {
          colour = value
        }
      }
      return colour
    }
    const light = colourOf(render({ blocks: THREE_CALLS, focusView: true }).root)
    act(() => renderer?.unmount())
    renderer = null
    const dark = colourOf(render({ blocks: THREE_CALLS, focusView: true }, 'dark').root)
    expect(light).toBe(lightColors.textSecondary)
    expect(dark).toBe(darkColors.textSecondary)
    expect(light).not.toBe(dark)
  })
})
