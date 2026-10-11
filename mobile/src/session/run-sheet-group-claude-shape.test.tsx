import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { fontFamily, darkColors, lightColors, type } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatRunSheet } from './MobileNativeChatRunSheet'

// "Ran 5 commands" next to the Claude app's "Ran 4 commands" (2026-10-11,
// 1015x2048, about 2.57 px/dp). Claude: the sheet stands at half the screen
// with the chat above it; a 15 dp line, clearly visible, joins each icon to
// the next; the command glyph is a bracketed text cursor (lucide
// TextCursorInput), not a square terminal; the command is monospace; the
// title is smaller than ours was. Ours opened at 62%, drew a faint 10 dp dash,
// a SquareTerminal, and a sans command under a 1.25x bold title.

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  Object.fromEntries(
    [
      'Briefcase',
      'Eye',
      'FileText',
      'Globe',
      'ListTodo',
      'MessageSquare',
      'Search',
      'Sparkles',
      'SquareTerminal',
      'TextCursorInput',
      'TriangleAlert',
      'Wrench',
      'X'
    ].map((name) => [name, name])
  )
)
const drawerProps: Record<string, unknown>[] = []
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { visible: boolean; header?: ReactNode; children: ReactNode }) => {
    drawerProps.push(props as unknown as Record<string, unknown>)
    return props.visible ? (
      <>
        {props.header}
        {props.children}
      </>
    ) : null
  }
}))

const command = (cmd: string, description?: string): NativeChatBlock[] => [
  { type: 'tool-call', name: 'Bash', input: description ? { command: cmd, description } : { command: cmd }, state: 'completed' },
  { type: 'tool-result', output: 'ok' }
]
const FOUR: NativeChatBlock[] = [
  ...command('cd "/Users/alwinpaul/Desktop/Project/Code UI" && ls'),
  ...command('cd "/Users/alwinpaul/Desktop/Project/Code UI" && git log'),
  ...command('cd "/Users/alwinpaul/Desktop/Project/Code UI" && git status'),
  ...command('cd /Users/alwinpaul/.claude/projects/x && ls')
]

type Scheme = 'light' | 'dark'
function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style
  return Object.assign({}, ...[style].flat(3).filter((entry) => entry && typeof entry === 'object'))
}

describe('the tool group sheet, the Claude app way', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    drawerProps.length = 0
  })
  function render(scheme: Scheme, blocks: NativeChatBlock[] = FOUR, title = 'Ran 4 commands') {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatRunSheet
            visible
            title={title}
            rows={runSheetRows(blocks, [])}
            running={false}
            onSelectPair={vi.fn()}
            onClose={vi.fn()}
          />
        </ThemeProvider>
      )
    })
    return renderer!
  }
  const rowNodes = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => node.props.testID === 'run-sheet-row' && String(node.type) === 'Pressable')
  const connectors = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => node.props.testID === 'run-sheet-connector' && String(node.type) === 'View')
  const textNodes = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'Text')
  const own = (scheme: Scheme) => (scheme === 'dark' ? darkColors : lightColors)

  it('opens at about half the screen, where it opened at 62%', () => {
    render('light')
    expect(drawerProps.at(-1)!.openingShare).toBe(0.5)
    expect(drawerProps.at(-1)!.expandable).toBe(true)
  })

  describe.each(['light', 'dark'] as const)('in %s', (scheme) => {
    it('draws a connector between every pair of consecutive rows and none after the last', () => {
      const tree = render(scheme)
      expect(rowNodes(tree)).toHaveLength(4)
      expect(connectors(tree)).toHaveLength(3)
      const last = rowNodes(tree)[3]!.parent!
      expect(last.findAll((node) => node.props.testID === 'run-sheet-connector')).toHaveLength(0)
    })

    it('draws the connector 15 dp long, centred between two icons, in a colour that shows', () => {
      const [first] = connectors(render(scheme))
      const style = styleOf(first!)
      expect(style.height).toBe(15)
      expect(style.width).toBe(1)
      // Icon bottom at 25 in a 34 dp row, next icon top at 44 + 9: centred on 39.
      expect((style.top as number) + (style.height as number) / 2).toBe(39)
      expect(style.position).toBe('absolute')
      expect(style.left).toBe(7.5)
      expect(style.backgroundColor).toBe(own(scheme).textMuted)
      expect(style.opacity as number).toBeGreaterThanOrEqual(0.5)
    })

    it('draws a lone row with no connector', () => {
      const tree = render(scheme, command('ls'), 'Ran a command')
      expect(rowNodes(tree)).toHaveLength(1)
      expect(connectors(tree)).toHaveLength(0)
    })

    it('marks a command with the bracketed text cursor, 16 dp, not the square terminal', () => {
      const row = rowNodes(render(scheme))[0]!
      const icon = row.findAll((node) => String(node.type) === 'TextCursorInput')
      expect(icon).toHaveLength(1)
      expect(icon[0]!.props.size).toBe(16)
      expect(icon[0]!.props.color).toBe(own(scheme).textMuted)
      expect(row.findAll((node) => String(node.type) === 'SquareTerminal')).toHaveLength(0)
    })

    it('draws the command itself in the monospace face, "Ran" in the regular one', () => {
      const row = rowNodes(render(scheme))[0]!
      const texts = textNodes(row)
      const verb = texts.find((node) => node.props.children === 'Ran')!
      const body = texts.find((node) => String(node.props.children).startsWith('cd "/Users'))!
      expect(styleOf(verb).fontFamily).toBe(fontFamily.regular)
      expect(styleOf(body).fontFamily).toBe(fontFamily.mono)
      expect(styleOf(body).fontSize).toBe(type.mono.size)
      expect(styleOf(body).fontSize as number).toBeLessThan(styleOf(verb).fontSize as number)
    })

    it('keeps a described command in the regular face, since the description is prose', () => {
      const row = rowNodes(render(scheme, command('ls', 'List the files'), 'Ran a command'))[0]!
      const body = textNodes(row).find((node) => node.props.children === 'List the files')!
      expect(styleOf(body).fontFamily).toBe(fontFamily.regular)
    })

    it('sets the title smaller than before: heading size, no 1.25 scale, semibold', () => {
      const tree = render(scheme)
      const title = textNodes(tree.root).find((node) => node.props.children === 'Ran 4 commands')!
      expect(styleOf(title).fontSize).toBe(type.heading.size)
      expect(styleOf(title).fontFamily).toBe(fontFamily.semibold)
    })

    it('pulls the title bar up and the close cross in, like the Claude sheet', () => {
      const tree = render(scheme)
      const bar = tree.root.findAll(
        (node) => String(node.type) === 'View' && styleOf(node).minHeight === 36 && styleOf(node).marginBottom === 2
      )
      expect(bar.length).toBeGreaterThan(0)
      const close = tree.root.find(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Close'
      )
      expect(styleOf(close.parent!).left).toBe(8)
    })
  })
})
