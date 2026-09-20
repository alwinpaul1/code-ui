import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { inlineCodeChipMaxChars } from './mobile-markdown-code-chip-split'
import { TABLE_CELL_MAX_WIDTH, computeTableColumnWidths, tableCellChipMaxChars } from './mobile-markdown-table-layout'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// From the phone, 2026-09-21: a table whose "Where" cells hold file paths as
// code spans. The prose above the table cuts a span to the measured line; the
// cells cut nothing and used the 34-character fallback, wider than the 260 dp
// a column may be. A pill wider than its cell wraps inside the pill, and
// nested-Text pills then paint over the line below them:
//
//     source-control/          (one pill…
//     use-mobile-commit-        …drawn across
//     message-generation.ts     three lines, overlapping)
//
// The Claude app cuts the same span into pills that each fit the cell.
const TABLE = `| Call | Where | What |
|---|---|---|
| \`git.generateCommitMessage\` | \`source-control/use-mobile-commit-message-generation.ts\` → host runs \`claude -p\` on the staged diff | Text generation |
| \`hostedReview.create\` | \`source-control/mobile-hosted-review-service.ts\` → cloud review | Minutes |`

describe('code spans inside a table cell', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function cellChipTexts(): { text: string; cellWidth: number }[] {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: TABLE }))
    })
    const out: { text: string; cellWidth: number }[] = []
    const cells = renderer!.root.findAll(
      (node: ReactTestInstance) => node.type === 'Text' && Array.isArray(node.props.style) && node.props.style.some((s: unknown) => typeof s === 'object' && s !== null && 'width' in s)
    )
    for (const cell of cells) {
      const width = (cell.props.style as { width?: number }[]).find((s) => typeof s?.width === 'number')?.width ?? 0
      for (const chip of cell.findAll((node: ReactTestInstance) => node.type === 'View' && node.props.style?.borderRadius === 7)) {
        const text = chip.findAll((node: ReactTestInstance) => node.type === 'Text').map((node) => String(node.props.children)).join('')
        out.push({ text, cellWidth: width })
      }
    }
    return out
  }

  it('cuts each span to what its own cell can hold as one pill, never the paragraph fallback', () => {
    const chips = cellChipTexts()
    expect(chips.length).toBeGreaterThan(3)
    for (const chip of chips) {
      const max = tableCellChipMaxChars(chip.cellWidth, 8, 13)
      expect(chip.text.length, `${chip.text} in a ${chip.cellWidth} dp cell`).toBeLessThanOrEqual(max)
    }
  })

  it('derives the cell limit from the cell width minus its padding, the way the paragraph does from its line', () => {
    expect(tableCellChipMaxChars(TABLE_CELL_MAX_WIDTH, 8, 13)).toBe(inlineCodeChipMaxChars(TABLE_CELL_MAX_WIDTH - 16, 13))
    expect(tableCellChipMaxChars(72, 8, 13)).toBe(12)
  })

  it('gives a cell that is one code span enough width for one pill', () => {
    const [callColumn] = computeTableColumnWidths({
      headers: ['Call'],
      rows: [['`git.generateCommitMessage`']],
      columnCount: 1,
      fontSize: 13,
      horizontalPadding: 8
    })
    // 25 mono characters at 0.6 em, the pill's 18 dp of insets, the cell's padding.
    expect(callColumn).toBeGreaterThanOrEqual(Math.ceil(25 * 13 * 0.6) + 18 + 16)
    expect(tableCellChipMaxChars(callColumn!, 8, 13)).toBeGreaterThanOrEqual(25)
  })
})
