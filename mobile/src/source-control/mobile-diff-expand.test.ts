import { describe, expect, it } from 'vitest'
import type { MobileDiffLine } from '../session/mobile-diff-lines'
import {
  NO_MOBILE_DIFF_EXPANSION,
  buildMobileDiffDisplayRows,
  expandMobileDiffGap,
  mobileDiffGapAction,
  mobileDiffGapLabel,
  type MobileDiffDisplayRow,
  type MobileDiffGap
} from './mobile-diff-expand'

/**
 * Hunks with a fold between them, as the Claude app's diff draws them (com.anthropic.claude
 * 1.261009.20, `jye.c` builds the gap rows and `iye` expands them, `jlc.e` draws the control):
 *
 * - three unchanged lines stay beside every change;
 * - a run between two changes folds to one row that offers "Expand all";
 * - the run above the first change offers "Expand down", and the run below the last one "Expand
 *   up", each three lines per tap (`iye` cases 1 and 2 read `list[i..i + 2]`).
 */

function context(from: number, to: number): MobileDiffLine[] {
  return Array.from({ length: to - from + 1 }, (_, index) => ({
    kind: 'context' as const,
    text: `line ${from + index}`,
    oldLineNumber: from + index,
    newLineNumber: from + index
  }))
}

function added(line: number): MobileDiffLine {
  return { kind: 'add', text: `new ${line}`, newLineNumber: line }
}

function removed(line: number): MobileDiffLine {
  return { kind: 'delete', text: `old ${line}`, oldLineNumber: line }
}

function shape(rows: readonly MobileDiffDisplayRow<MobileDiffLine>[]): string[] {
  return rows.map((row) =>
    row.kind === 'gap'
      ? `gap:${row.gap.position}:${row.gap.hiddenLines}`
      : `${row.line.kind[0]}:${row.line.newLineNumber ?? row.line.oldLineNumber}`
  )
}

function gapsOf(rows: readonly MobileDiffDisplayRow<MobileDiffLine>[]): MobileDiffGap[] {
  return rows.flatMap((row) => (row.kind === 'gap' ? [row.gap] : []))
}

describe('a diff folded into hunks', () => {
  it('keeps three unchanged lines beside a change and folds the rest into one row', () => {
    // 1..50 unchanged, line 51 changed, 52..100 unchanged.
    const lines = [...context(1, 50), added(51), ...context(52, 100)]
    const { rows } = buildMobileDiffDisplayRows(lines)

    expect(shape(rows)).toEqual([
      'gap:top:47',
      'c:48',
      'c:49',
      'c:50',
      'a:51',
      'c:52',
      'c:53',
      'c:54',
      'gap:bottom:46'
    ])
  })

  it('offers one control per fold, named for where the hidden lines are', () => {
    const lines = [...context(1, 20), added(21), ...context(22, 60), removed(61), ...context(62, 80)]
    const gaps = gapsOf(buildMobileDiffDisplayRows(lines).rows)

    expect(gaps.map((gap) => [gap.position, gap.canExpandUp, gap.canExpandDown])).toEqual([
      ['top', false, true],
      ['between', true, true],
      ['bottom', true, false]
    ])
    expect(gaps.map(mobileDiffGapAction)).toEqual(['down', 'all', 'up'])
  })

  it('says how many lines a fold hides as "+N lines", with a thousands comma', () => {
    const lines = [added(1), ...context(2, 3_003)]
    const [gap] = gapsOf(buildMobileDiffDisplayRows(lines).rows)

    expect(mobileDiffGapLabel(gap!)).toBe('+2,999 lines')
    // The app's own fallback when it does not know the count yet.
    expect(mobileDiffGapLabel({ ...gap!, hiddenLines: 0 })).toBe('Expand')
  })

  it('reveals three more lines beside the first change per tap on the top fold', () => {
    const lines = [...context(1, 30), added(31), ...context(32, 34)]
    const first = buildMobileDiffDisplayRows(lines)
    const gap = gapsOf(first.rows)[0]!
    expect(gap).toMatchObject({ position: 'top', hiddenLines: 27 })

    const once = buildMobileDiffDisplayRows(
      lines,
      expandMobileDiffGap(NO_MOBILE_DIFF_EXPANSION, gap, 'down')
    )
    expect(shape(once.rows).slice(0, 8)).toEqual([
      'gap:top:24',
      'c:25',
      'c:26',
      'c:27',
      'c:28',
      'c:29',
      'c:30',
      'a:31'
    ])
  })

  it('reveals three more lines beside the last change per tap on the bottom fold', () => {
    const lines = [...context(1, 3), added(4), ...context(5, 40)]
    const gap = gapsOf(buildMobileDiffDisplayRows(lines).rows).find((g) => g.position === 'bottom')!
    expect(gap.hiddenLines).toBe(33)

    const once = buildMobileDiffDisplayRows(
      lines,
      expandMobileDiffGap(NO_MOBILE_DIFF_EXPANSION, gap, 'up')
    )
    expect(shape(once.rows)).toEqual([
      'c:1',
      'c:2',
      'c:3',
      'a:4',
      'c:5',
      'c:6',
      'c:7',
      'c:8',
      'c:9',
      'c:10',
      'gap:bottom:30'
    ])
  })

  it('opens a fold between two changes whole', () => {
    const lines = [added(1), ...context(2, 41), added(42)]
    const gap = gapsOf(buildMobileDiffDisplayRows(lines).rows).find((g) => g.position === 'between')!
    const { rows } = buildMobileDiffDisplayRows(
      lines,
      expandMobileDiffGap(NO_MOBILE_DIFF_EXPANSION, gap, 'all')
    )

    expect(gapsOf(rows)).toEqual([])
    expect(rows).toHaveLength(lines.length)
  })

  it('lets a fold that would be left with one hidden line go, as a row for it saves nothing', () => {
    // Top fold hides 4: one tap of three leaves 1, which is drawn instead of a "+1 lines" row.
    const lines = [...context(1, 7), added(8)]
    const gap = gapsOf(buildMobileDiffDisplayRows(lines).rows)[0]!
    expect(gap.hiddenLines).toBe(4)

    const { rows } = buildMobileDiffDisplayRows(
      lines,
      expandMobileDiffGap(NO_MOBILE_DIFF_EXPANSION, gap, 'down')
    )
    expect(gapsOf(rows)).toEqual([])
    expect(rows).toHaveLength(lines.length)
  })

  it('does not fold a run that hides fewer than two lines', () => {
    // 7 unchanged between two changes: 3 + 3 kept, 1 hidden.
    const sevenBetween = [added(1), ...context(2, 8), added(9)]
    expect(gapsOf(buildMobileDiffDisplayRows(sevenBetween).rows)).toEqual([])
    // 8 unchanged: 2 hidden.
    const eightBetween = [added(1), ...context(2, 9), added(10)]
    expect(gapsOf(buildMobileDiffDisplayRows(eightBetween).rows).map((g) => g.hiddenLines)).toEqual([2])
  })

  it('keeps a line that carries a comment on screen, with its own three lines around it', () => {
    // The note sits on unchanged line 30, far from the change on line 90.
    const lines = [...context(1, 89), added(90), ...context(91, 95)]
    const pinned = new Set([29])
    const { rows } = buildMobileDiffDisplayRows(lines, NO_MOBILE_DIFF_EXPANSION, pinned)

    expect(shape(rows)).toEqual([
      'gap:top:26',
      'c:27',
      'c:28',
      'c:29',
      'c:30',
      'c:31',
      'c:32',
      'c:33',
      'gap:between:53',
      'c:87',
      'c:88',
      'c:89',
      'a:90',
      'c:91',
      'c:92',
      'c:93',
      'gap:bottom:2'
    ])
  })

  it('keeps what the reader opened open when a comment lands inside it and splits the fold', () => {
    // Between the two changes: lines 2..41. The reader opens all of it, then comments on line 20.
    const lines = [added(1), ...context(2, 41), added(42)]
    const gap = gapsOf(buildMobileDiffDisplayRows(lines).rows)[0]!
    const opened = expandMobileDiffGap(NO_MOBILE_DIFF_EXPANSION, gap, 'all')

    const { rows } = buildMobileDiffDisplayRows(lines, opened, new Set([19]))
    expect(gapsOf(rows)).toEqual([])
    expect(rows).toHaveLength(lines.length)
  })

  it('maps a raw row to the row that draws it, so a hunk jump lands on the change', () => {
    const lines = [...context(1, 50), added(51), ...context(52, 100)]
    const { rows, displayIndexOfRaw } = buildMobileDiffDisplayRows(lines)

    const changeRaw = lines.findIndex((line) => line.kind === 'add')
    expect(rows[displayIndexOfRaw(changeRaw)]).toMatchObject({ kind: 'line', rawIndex: changeRaw })
  })
})

describe('the degenerate diffs', () => {
  it('draws nothing for an empty diff', () => {
    const { rows, displayIndexOfRaw } = buildMobileDiffDisplayRows([])
    expect(rows).toEqual([])
    expect(displayIndexOfRaw(0)).toBe(0)
  })

  it('draws a one-line diff as that line, with no fold', () => {
    const { rows } = buildMobileDiffDisplayRows([added(1)])
    expect(shape(rows)).toEqual(['a:1'])
  })

  it('draws a one-line file whose only line changed as its two rows', () => {
    const { rows } = buildMobileDiffDisplayRows([removed(1), added(1)])
    expect(shape(rows)).toEqual(['d:1', 'a:1'])
  })

  it('leaves a file with nothing changed whole, since there is no hunk to fold toward', () => {
    const lines = context(1, 40)
    const { rows } = buildMobileDiffDisplayRows(lines)
    expect(rows).toHaveLength(40)
    expect(gapsOf(rows)).toEqual([])
  })

  it('leaves a diff the mobile cap already folded alone: those lines are not in the rows', () => {
    const lines: MobileDiffLine[] = [
      ...context(1, 3),
      { kind: 'context', text: '2,896 unchanged lines', note: { kind: 'collapsed', hiddenLines: 2_896 } },
      ...context(2_900, 2_902),
      added(2_903)
    ]
    const { rows } = buildMobileDiffDisplayRows(lines)
    expect(rows).toHaveLength(lines.length)
    expect(gapsOf(rows)).toEqual([])
  })

  it('treats a no-newline note as part of the change above it', () => {
    const lines: MobileDiffLine[] = [
      ...context(1, 20),
      added(21),
      { kind: 'context', text: '\\ No newline at end of file', note: { kind: 'no-newline' } }
    ]
    const { rows } = buildMobileDiffDisplayRows(lines)
    expect(shape(rows)).toEqual(['gap:top:17', 'c:18', 'c:19', 'c:20', 'a:21', 'c:undefined'])
  })

  it('offers no action on a fold that cannot expand either way', () => {
    expect(mobileDiffGapAction({ canExpandUp: false, canExpandDown: false })).toBeNull()
  })
})
