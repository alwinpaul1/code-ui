import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { codePillWidth, cutCodePills } from './mobile-markdown-code-chip-split'
import { computeTableColumnWidths } from './mobile-markdown-table-layout'
import { markdownTableCellPillPadding } from './mobile-markdown-prose-scale'

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
// cells cut nothing and used the paragraph's fallback, wider than the 260 dp
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
      (node: ReactTestInstance) => String(node.type) === 'Text' && Array.isArray(node.props.style) && node.props.style.some((s: unknown) => typeof s === 'object' && s !== null && 'width' in s)
    )
    for (const cell of cells) {
      const width = (cell.props.style as { width?: number }[]).find((s) => typeof s?.width === 'number')?.width ?? 0
      for (const chip of cell.findAll((node: ReactTestInstance) => String(node.type) === 'View' && node.props.style?.borderRadius === 7)) {
        const text = chip.findAll((node: ReactTestInstance) => String(node.type) === 'Text').map((node) => String(node.props.children)).join('')
        out.push({ text, cellWidth: width })
      }
    }
    return out
  }

  // A cell's pill is set at the cell's own 13 dp, with the prose pill's 4 dp
  // padding and 1 dp border a side; its line is the cell less its 8 dp of
  // padding a side and its 1 dp right border.
  const CELL_PILL = { fontSize: 13, insets: 10 }
  const inner = (cellWidth: number) => cellWidth - 16 - 1

  it('cuts each span to what its own cell can hold, never the paragraph line', () => {
    const chips = cellChipTexts()
    expect(chips.length).toBeGreaterThan(3)
    for (const chip of chips) {
      expect(codePillWidth(chip.text, CELL_PILL), `${chip.text} in a ${chip.cellWidth} dp cell`).toBeLessThanOrEqual(
        inner(chip.cellWidth) - 1
      )
    }
  })

  it('gives a cell that is one code span enough width for one pill', () => {
    const [callColumn] = computeTableColumnWidths({
      headers: ['Call'],
      rows: [['`git.generateCommitMessage`']],
      columnCount: 1,
      fontSize: 13,
      horizontalPadding: 8
    })
    const room = inner(callColumn!)
    expect(cutCodePills('git.generateCommitMessage', room, room, CELL_PILL).pieces).toEqual([
      'git.generateCommitMessage'
    ])
  })

  // 2026-09-27 review: at a zoom a cell's text keeps its size and its pills
  // grow, so a pill hangs out of its line; the room for that goes to the
  // cells that hold one, not to every cell.
  it('gives a cell holding a pill room below it at the largest zoom, and no other cell', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: TABLE, textScale: 1.8 }))
    })
    const cells = renderer!.root.findAll(
      (node: ReactTestInstance) =>
        String(node.type) === 'Text' &&
        Array.isArray(node.props.style) &&
        node.props.style.some((s: unknown) => typeof s === 'object' && s !== null && 'width' in s)
    )
    const bottom = (cell: ReactTestInstance) =>
      Object.assign({}, ...(cell.props.style as object[]).filter(Boolean)).paddingBottom as number
    const holding = cells.filter((cell) => cell.findAll((node: ReactTestInstance) => String(node.type) === 'View').length > 0)
    const plain = cells.filter((cell) => !holding.includes(cell))
    expect(holding.length).toBeGreaterThan(0)
    expect(plain.length).toBeGreaterThan(0)
    for (const cell of holding) {
      expect(bottom(cell)).toBe(markdownTableCellPillPadding(1.8))
    }
    for (const cell of plain) {
      expect(bottom(cell)).toBe(markdownTableCellPillPadding(1))
    }
    expect(markdownTableCellPillPadding(1.8)).toBeGreaterThan(markdownTableCellPillPadding(1))
  })
})

