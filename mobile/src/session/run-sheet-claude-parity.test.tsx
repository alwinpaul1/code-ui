import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { runSheetRows } from './mobile-native-chat-run-sheet-rows'
import { toolRunSentence } from './mobile-native-chat-tool-sentence'
import { darkColors, fontFamily, lightColors, space, type, type ThemeColors } from '../theme/tokens'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatRunSheet } from './MobileNativeChatRunSheet'

// The Claude app's tool-run sheet and ours, same session, side by side
// (2026-10-09, 1015x2048, about 2.57 px/dp). Claude: a centred bold title on as
// many lines as it needs; rows 44 dp apart in smaller type; a failed step marked
// by a warning triangle after its icon and the verb in the danger colour; a file
// row in the monospace face with +N / −N chips; ToolSearch as "Loaded tools".
// Ours cut the title to one line, spaced rows 56 dp apart, wrote "Failed" at the
// right edge, drew the file name in the sans face with a pencil, and said
// "Used ToolSearch  max_results".

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
      'TriangleAlert',
      'Wrench',
      'X'
    ].map((name) => [name, name])
  )
)
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children: ReactNode }) =>
    visible ? (
      <>
        {header}
        {children}
      </>
    ) : null
}))

const call = (name: string, input: unknown, output: string, isError = false): NativeChatBlock[] => [
  { type: 'tool-call', name, input, state: isError ? 'failed' : 'completed' },
  { type: 'tool-result', output, ...(isError ? { isError: true } : {}) }
]

/** The run of the screenshot: two failed commands, a ToolSearch, a command, a
 *  created file and an agent. */
const RUN: NativeChatBlock[] = [
  ...call('Bash', { command: 'ls phase3', description: 'Check whether phase 3 has finished' }, 'exit 1', true),
  ...call('Bash', { command: 'cat brief', description: 'Read the earlier reviewer brief' }, 'exit 1', true),
  ...call('ToolSearch', { query: 'select:WebFetch', max_results: 1 }, 'ok'),
  ...call('Bash', { command: 'diff a b', description: 'Snapshot the phase 3 draft' }, 'ok'),
  ...call(
    'Write',
    { file_path: '/repo/REVIEW3_BRIEF.md', content: Array.from({ length: 32 }, (_, i) => `l${i}`).join('\n') + '\n' },
    'File created successfully at: /repo/REVIEW3_BRIEF.md'
  ),
  ...call('Agent', { description: 'Review: story flow', prompt: 'p' }, 'launched')
]

type Scheme = 'light' | 'dark'

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  // A Pressable's style may be a function of its pressed state.
  const style = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style
  return Object.assign({}, ...[style].flat(3).filter((entry) => entry && typeof entry === 'object'))
}

describe('the run sheet, the Claude app way', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(scheme: Scheme = 'light', blocks: NativeChatBlock[] = RUN, title?: string) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatRunSheet
            visible
            title={title ?? toolRunSentence(blocks, 0)}
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
  const textNodes = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'Text')
  const hasIcon = (root: ReactTestInstance, name: string) => root.findAll((node) => String(node.type) === name).length > 0
  const own = (scheme: Scheme): ThemeColors => (scheme === 'dark' ? darkColors : lightColors)

  describe('the title', () => {
    it('shows the whole sentence, centred, on as many lines as it needs', () => {
      const tree = render('light', RUN, 'Ran 3 commands (2 failed), used 2 tools, created a file')
      const title = textNodes(tree.root).find(
        (node) => node.props.children === 'Ran 3 commands (2 failed), used 2 tools, created a file'
      )
      expect(title).toBeDefined()
      // No line cap: a numberOfLines of any number cuts it with an ellipsis.
      expect(title!.props.numberOfLines).toBeUndefined()
      expect(styleOf(title!).textAlign).toBe('center')
    })

    it('draws it bold and larger than the heading face, with the close cross kept at the left', () => {
      const tree = render('light', RUN, 'Ran a command')
      const title = textNodes(tree.root).find((node) => node.props.children === 'Ran a command')!
      expect(styleOf(title).fontFamily).toBe(fontFamily.bold)
      expect(styleOf(title).fontSize as number).toBeGreaterThan(type.heading.size)
      const close = tree.root.findAll(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Close'
      )
      expect(close).toHaveLength(1)
    })

    it('keeps the cross for a one-row sheet with a one-line title', () => {
      const tree = render('light', call('Bash', { command: 'ls' }, 'ok'), 'Ran a command')
      expect(rowNodes(tree)).toHaveLength(1)
      expect(tree.root.findAll((node) => node.props.accessibilityLabel === 'Close').length).toBeGreaterThan(0)
    })
  })

  describe('the density', () => {
    it('sets a row 34 dp high, 44 dp from the next with its connector, where it was 44 plus 10', () => {
      const tree = render()
      const rows = rowNodes(tree)
      expect(rows).toHaveLength(6)
      for (const row of rows) {
        expect(styleOf(row).minHeight).toBe(34)
      }
    })

    it('keeps each row a 44 dp touch target through its slop', () => {
      for (const row of rowNodes(render())) {
        const slop = row.props.hitSlop as { top: number; bottom: number }
        expect((styleOf(row).minHeight as number) + slop.top + slop.bottom).toBeGreaterThanOrEqual(44)
      }
    })
  })

  // Measured on claude-sheet3.png at 2.57 px/dp (2026-10-09): the icon 27 dp
  // from the sheet's edge and 16 wide, the verb 15 dp after it in the regular
  // weight and the main colour, the detail 11 dp after the verb in the muted
  // colour, the words at the transcript's prose size. Ours had the icon at 15,
  // 18 wide, a bold verb and the detail in the secondary colour at the label
  // size (13), which sat under the 15 prose above it.
  describe.each(['light', 'dark'] as const)('the row geometry, in %s', (scheme) => {
    const firstRow = (tree: ReactTestRenderer) => rowNodes(tree)[3]!
    const words = (row: ReactTestInstance) => {
      const verb = textNodes(row).find((node) => node.props.children === 'Ran')!
      const detail = textNodes(row).find((node) => node.props.children === 'Snapshot the phase 3 draft')!
      return { verb, detail }
    }

    it('puts the icon 27 dp from the sheet edge, 16 dp wide', () => {
      const tree = render(scheme)
      const content = tree.root.find((node) => node.props.testID === 'run-sheet')
      // The drawer itself pads its content by space.md; the sheet adds the rest.
      expect((styleOf(content).paddingLeft as number) + space.md).toBe(27)
      const icon = firstRow(tree).find((node) => String(node.type) === 'SquareTerminal')
      expect(icon.props.size).toBe(16)
      expect(icon.props.color).toBe(own(scheme).textMuted)
    })

    it('keeps the connector centred under the icon', () => {
      const tree = render(scheme)
      const connectors = tree.root.findAll(
        (node) => String(node.type) === 'View' && styleOf(node).width === 1 && styleOf(node).height === 10
      )
      // Six rows, five joints.
      expect(connectors).toHaveLength(5)
      // The line is 1 dp wide, so its left edge sits half a dp before the icon's centre.
      expect((styleOf(connectors[0]!).marginLeft as number) + 0.5).toBe(8)
      expect(styleOf(connectors[0]!).backgroundColor).toBe(own(scheme).border)
    })

    it('draws the verb in the regular weight and the main colour, 15 dp after the icon', () => {
      const { verb } = words(firstRow(render(scheme)))
      expect(styleOf(verb).fontFamily).toBe(fontFamily.regular)
      expect(styleOf(verb).color).toBe(own(scheme).text)
      expect(styleOf(verb).marginLeft).toBe(15)
    })

    it('draws the detail in the muted colour, 11 dp after the verb, on one line', () => {
      const { detail } = words(firstRow(render(scheme)))
      expect(styleOf(detail).color).toBe(own(scheme).textMuted)
      expect(styleOf(detail).marginLeft).toBe(11)
      expect(detail.props.numberOfLines).toBe(1)
    })

    it("sets the words at the transcript's prose size, which the label size sat under", () => {
      const { verb, detail } = words(firstRow(render(scheme)))
      for (const word of [verb, detail]) {
        expect(styleOf(word).fontSize).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.prose.fontSize)
        expect(styleOf(word).lineHeight).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.prose.lineHeight)
      }
      expect(type.label.size).toBeLessThan(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.prose.fontSize)
    })

    // Yoga's rule for a row of fixed-basis items that overflow it: each shrinks
    // by its flexShrink times its basis, an item that reaches 0 stops, and the
    // rest take what it could not give. (A Text has no minimum width.) Checked
    // against yoga-layout 3.2.1 at 384 dp: with the verb at flexShrink 0 a 330 dp
    // verb ended 16 dp past the row and its detail had 0 width.
    function shrunk(items: { basis: number; shrink: number }[], room: number): number[] {
      const widths = items.map((item) => item.basis)
      const frozen = items.map(() => false)
      for (;;) {
        const over = widths.reduce((sum, w) => sum + w, 0) - room
        const live = items.map((_, i) => i).filter((i) => !frozen[i] && items[i]!.shrink > 0)
        const weight = live.reduce((sum, i) => sum + items[i]!.shrink * items[i]!.basis, 0)
        if (over <= 1e-9 || weight === 0) {
          return widths
        }
        let hitZero = false
        for (const i of live) {
          const next = widths[i]! - (over * items[i]!.shrink * items[i]!.basis) / weight
          if (next <= 0) {
            widths[i] = 0
            frozen[i] = true
            hitZero = true
          } else {
            widths[i] = next
          }
        }
        if (!hitZero) {
          return widths
        }
      }
    }

    it.each([1, 1.3])(
      'keeps a long tool name inside the row and gives the detail up first, at font scale %s',
      (fontScale) => {
        const name = 'mcp__claude_ai_Google_Drive__get_file_metadata'
        const tree = render(scheme, call(name, { fileId: 'abc' }, 'ok'))
        const row = rowNodes(tree)[0]!
        const verb = textNodes(row).find((node) => node.props.children === `Used ${name}`)!
        const detail = textNodes(row).find((node) => node.props.children === 'fileId')!
        expect(verb.props.numberOfLines).toBe(1)
        expect(detail.props.numberOfLines).toBe(1)
        // 384 dp screen: the drawer's padding and the sheet's inset leave the row this wide.
        const rowWidth = 384 - 2 * space.md - ((styleOf(tree.root.find((n) => n.props.testID === 'run-sheet')).paddingLeft as number) ?? 0)
        const glyph = 0.55 * (styleOf(verb).fontSize as number) * fontScale
        const icon = 16
        const sizes = shrunk(
          [
            { basis: name.length * glyph + 5 * glyph, shrink: styleOf(verb).flexShrink as number },
            { basis: 'fileId'.length * glyph, shrink: styleOf(detail).flexShrink as number }
          ],
          rowWidth - icon - (styleOf(verb).marginLeft as number) - (styleOf(detail).marginLeft as number)
        )
        const verbRight = icon + (styleOf(verb).marginLeft as number) + sizes[0]!
        expect(verbRight).toBeLessThanOrEqual(rowWidth)
        expect(sizes[1]).toBeGreaterThanOrEqual(0)
        // The detail is what gave way: gone before the verb lost a glyph's width more than it must.
        expect(sizes[1]).toBe(0)
        expect(sizes[0]).toBeGreaterThan(0)
      }
    )

    it('lets the verb of a short row keep its whole word beside a long detail', () => {
      const tree = render(scheme)
      const { verb, detail } = words(firstRow(tree))
      const glyph = 0.55 * (styleOf(verb).fontSize as number)
      const sizes = shrunk(
        [
          { basis: 3 * glyph, shrink: styleOf(verb).flexShrink as number },
          { basis: 120 * glyph, shrink: styleOf(detail).flexShrink as number }
        ],
        200
      )
      // Under a tenth of a dp off its measured width: well inside one pixel, which layout rounds up for text.
      expect(3 * glyph - sizes[0]!).toBeLessThan(0.1)
      expect(sizes[1]!).toBeLessThan(200)
    })

    it('lets a verb with no detail shrink too, so a long tool name is cut, not clipped', () => {
      const tree = render(scheme)
      const loaded = textNodes(rowNodes(tree)[2]!).find((node) => node.props.children === 'Loaded tools')!
      expect(styleOf(loaded).flexShrink).toBe(1)
      expect(loaded.props.numberOfLines).toBe(1)
    })
  })

  describe.each(['light', 'dark'] as const)('a failed row, in %s', (scheme) => {
    it('puts a warning triangle after the tool icon and the verb in the danger colour', () => {
      const tree = render(scheme)
      const failed = rowNodes(tree)[0]!
      const triangle = failed.findAll((node) => String(node.type) === 'TriangleAlert')
      expect(triangle).toHaveLength(1)
      expect(triangle[0]!.props.color).toBe(own(scheme).danger)
      const verb = textNodes(failed).find((node) => node.props.children === 'Ran')!
      expect(styleOf(verb).color).toBe(own(scheme).danger)
      // The triangle comes after the tool icon, before the words.
      const order = failed.findAll((node) => ['SquareTerminal', 'TriangleAlert'].includes(String(node.type)))
      expect(order.map((node) => String(node.type))).toEqual(['SquareTerminal', 'TriangleAlert'])
    })

    it('writes no "Failed" at the right edge, and still says the step failed to a screen reader', () => {
      const tree = render(scheme)
      const failed = rowNodes(tree)[0]!
      expect(textNodes(failed).some((node) => node.props.children === 'Failed')).toBe(false)
      expect(String(failed.props.accessibilityLabel)).toContain('Failed')
    })

    it('marks only the failed rows, and draws a passing verb in the ordinary ink', () => {
      const tree = render(scheme)
      const rows = rowNodes(tree)
      expect(rows.map((row) => hasIcon(row, 'TriangleAlert'))).toEqual([true, true, false, false, false, false])
      const ok = textNodes(rows[3]!).find((node) => node.props.children === 'Ran')!
      expect(styleOf(ok).color).toBe(own(scheme).text)
    })
  })

  describe.each(['light', 'dark'] as const)('a created file row, in %s', (scheme) => {
    it('shows a document icon, the name in the monospace face and the +N / −N chips', () => {
      const tree = render(scheme)
      const file = rowNodes(tree)[4]!
      expect(hasIcon(file, 'FileText')).toBe(true)
      const name = textNodes(file).find((node) => String(node.props.children).includes('REVIEW3_BRIEF.md'))!
      expect(styleOf(name).fontFamily).toBe(fontFamily.mono)
      const added = textNodes(file).find((node) => node.props.testID === 'tool-run-diff-added')!
      const removed = textNodes(file).find((node) => node.props.testID === 'tool-run-diff-removed')!
      expect(added.props.children).toBe('+32')
      expect(removed.props.children).toBe('−0')
      expect(styleOf(added).color).toBe(own(scheme).diffAddText)
      expect(styleOf(added).backgroundColor).toBe(own(scheme).diffAddBg)
      expect(styleOf(removed).color).toBe(own(scheme).diffDelText)
      expect(styleOf(removed).backgroundColor).toBe(own(scheme).diffDelBg)
    })

    it('draws no chips and no mono name on a row that is not a file edit', () => {
      const tree = render(scheme)
      for (const index of [0, 3, 5]) {
        expect(textNodes(rowNodes(tree)[index]!).some((node) => node.props.testID === 'tool-run-diff-added')).toBe(false)
      }
      const command = textNodes(rowNodes(tree)[3]!).find((node) => String(node.props.children).includes('Snapshot'))!
      expect(styleOf(command).fontFamily).not.toBe(fontFamily.mono)
    })
  })

  it('draws a ToolSearch as "Loaded tools" with a toolbox and no detail', () => {
    const tree = render()
    const row = rowNodes(tree)[2]!
    expect(hasIcon(row, 'Briefcase')).toBe(true)
    const words = textNodes(row).flatMap((node) => [node.props.children].flat()).filter((child) => typeof child === 'string')
    expect(words).toEqual(['Loaded tools'])
    expect(String(row.props.accessibilityLabel)).toBe('Loaded tools')
  })
})
