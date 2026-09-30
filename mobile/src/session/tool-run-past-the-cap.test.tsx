import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'

// A tool run shows its first six calls. Past them the body ended at "… 6 more
// tool calls", plain text with no onPress, so calls 7-12 — a failed one among
// them, and its detail sheet — could not be reached at all, while the header
// said "1 failed". The plan preview was read over the same first six, so a
// TodoWrite or update_plan later in a long run drew no plan line (review,
// 2026-09-30). The cap is this client's own: the desktop's NativeChatToolRun
// draws every call, and src/shared's pairToolBlocks takes no limit unless
// asked for one.

vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
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
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

function Harness({ blocks }: { blocks: NativeChatBlock[] }): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded: false, activeCall: null, styles })
}

/** `count` Bash calls, `cmd-1` … `cmd-N`; the ones listed in `failed` error. */
function commands(count: number, failed: readonly number[] = []): NativeChatBlock[] {
  return Array.from({ length: count }, (_, i) => i + 1).flatMap((n): NativeChatBlock[] => [
    { type: 'tool-call', name: 'Bash', input: { command: `cmd-${n}` } },
    {
      type: 'tool-result',
      output: failed.includes(n) ? 'exit 1' : 'ok',
      ...(failed.includes(n) ? { isError: true } : {})
    }
  ])
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(blocks: NativeChatBlock[], scheme: 'light' | 'dark'): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <Harness blocks={blocks} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

function openRun(root: ReactTestInstance): void {
  act(() => root.findByProps({ testID: 'tool-run-header' }).props.onPress())
}

const lines = (root: ReactTestInstance): ReactTestInstance[] => root.findAllByProps({ testID: 'tool-line' })

/** The row that stands in for the calls past the cap, as a button. */
const moreButtons = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityRole === 'button' &&
      /more tool call/.test(String(node.props.accessibilityLabel ?? ''))
  )

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('a tool run longer than its first six calls, %s', (scheme, palette) => {
  it('opens every call of a 12-command run from its "more" row, the failed 9th included', () => {
    const root = render(commands(12, [9]), scheme)
    // The header says a call failed ("Ran 12 commands (1 failed)").
    expect(toolRunSentence(commands(12, [9]))).toBe('Ran 12 commands (1 failed)')
    openRun(root)
    expect(lines(root)).toHaveLength(6)
    const [more] = moreButtons(root)
    expect(more?.props.accessibilityLabel).toBe('Show 6 more tool calls')
    const label = more!.findByType('Text' as never)
    expect(label.props.children).toBe('Show 6 more tool calls')
    expect(flat(label.props.style).color).toBe(palette.accentText)
    act(() => more!.props.onPress())
    expect(lines(root)).toHaveLength(12)
    expect(moreButtons(root)).toHaveLength(0)
    // The failed call's detail sheet is one tap away.
    act(() => lines(root)[8]!.props.onPress())
    const sheet = root.findByType('MobileNativeChatToolDetailSheet' as never)
    expect(sheet.props.pair.call.input).toEqual({ command: 'cmd-9' })
    expect(sheet.props.pair.result.isError).toBe(true)
  })

  it('draws a plan made after the sixth call as the run\'s plan line', () => {
    const blocks: NativeChatBlock[] = [
      ...commands(7),
      {
        type: 'tool-call',
        name: 'TodoWrite',
        input: { todos: [{ content: 'Write the test', status: 'in_progress', activeForm: 'Writing the test' }] }
      },
      { type: 'tool-result', output: 'ok' }
    ]
    const root = render(blocks, scheme)
    const plan = root.findAllByProps({ testID: 'tool-run-member-arg' })
    expect(plan.map((node) => String(node.props.children))).toEqual(['0/1 · Writing the test'])
  })

  it('draws no "more" row for exactly six calls, and one for exactly seven', () => {
    const six = render(commands(6), scheme)
    openRun(six)
    expect(lines(six)).toHaveLength(6)
    expect(moreButtons(six)).toHaveLength(0)
    act(() => renderer?.unmount())
    const seven = render(commands(7), scheme)
    openRun(seven)
    expect(lines(seven)).toHaveLength(6)
    const [more] = moreButtons(seven)
    expect(more?.props.accessibilityLabel).toBe('Show 1 more tool call')
    act(() => more!.props.onPress())
    expect(lines(seven)).toHaveLength(7)
  })

  it('keeps a one-call run as it was', () => {
    const one = render(commands(1), scheme)
    expect(moreButtons(one)).toHaveLength(0)
    expect(lines(one)).toHaveLength(0)
  })
})
