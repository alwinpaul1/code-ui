import { describe, expect, it } from 'vitest'
import { CODE_BLOCK_SPEC, codeBlockLabel, codeBlockSheetTitle } from './code-block-spec'
import { codeTextRuns } from './mobile-markdown-code-runs'
import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'

// The numbers are the Claude app's (1.261009.20, decompiled 2026-10-14); the
// file that holds them says where each was read. These pin them, so a tidy-up
// cannot drift the card off the app without a test going red.
describe('the code block spec', () => {
  it('has the app’s card, header, button and copy numbers', () => {
    expect(CODE_BLOCK_SPEC.radius).toBe(12)
    expect(CODE_BLOCK_SPEC.header).toEqual({ minHeightSp: 40, minHeightDp: 40, paddingHorizontal: 16 })
    expect(CODE_BLOCK_SPEC.button).toEqual({ sizeSp: 36, glyphSp: 20, touchTargetDp: 40, gap: 4 })
    expect(CODE_BLOCK_SPEC.sheetButton).toEqual({ sizeSp: 40, glyphSp: 24, touchTargetDp: 40 })
    expect(CODE_BLOCK_SPEC.body.padding).toBe(16)
    expect(CODE_BLOCK_SPEC.copy).toEqual({ copiedMs: 2000, tintMs: 300 })
    expect(CODE_BLOCK_SPEC.linesPerText).toBe(24)
  })
})

describe('the label a block carries', () => {
  it.each([
    ['python', 'Python'],
    ['Python', 'Python'],
    ['c', 'C'],
    ['tsx', 'Tsx'],
    ['  sh  ', 'Sh']
  ])('writes the fence language %j as %j', (language, label) => {
    expect(codeBlockLabel(language)).toBe(label)
  })

  it.each([undefined, '', '   '])('writes "Code" for a fence with no language (%j)', (language) => {
    expect(codeBlockLabel(language)).toBe('Code')
    expect(codeBlockSheetTitle(language)).toBe('Code')
  })

  it('titles the sheet "<Language> code" over a named fence', () => {
    expect(codeBlockSheetTitle('python')).toBe('Python code')
    expect(codeBlockSheetTitle('c')).toBe('C code')
  })
})

const plain = (text: string): MobileSyntaxSegment => ({ text, kind: 'plain' })
const joined = (run: MobileSyntaxSegment[]): string => run.map((segment) => segment.text).join('')

describe('the runs a block is cut into', () => {
  it('is no run for no lines', () => {
    expect(codeTextRuns([])).toEqual([])
  })

  it('is one run for one line, with nothing added', () => {
    const [run, ...rest] = codeTextRuns([[plain('ls')]])
    expect(rest).toEqual([])
    expect(joined(run!)).toBe('ls')
  })

  it('gives a lone blank line a space, so an empty block still draws its one line', () => {
    expect(codeTextRuns([[]]).map(joined)).toEqual([' '])
  })

  it('puts a newline between the lines of a run and cuts every 24', () => {
    const lines = Array.from({ length: 49 }, (_, index) => [plain(`l${index}`)])
    const runs = codeTextRuns(lines).map(joined)
    expect(runs).toHaveLength(3)
    expect(runs[0]!.split('\n')).toHaveLength(24)
    expect(runs[1]!.split('\n')).toHaveLength(24)
    expect(runs[2]).toBe('l48')
  })

  it('keeps a blank line in the middle as its two newlines, and marks one at a run’s end', () => {
    expect(codeTextRuns([[plain('a')], [], [plain('b')]]).map(joined)).toEqual(['a\n\nb'])
    const lines = [...Array.from({ length: 23 }, () => [plain('x')]), []]
    expect(joined(codeTextRuns(lines)[0]!).endsWith('\n ')).toBe(true)
  })
})
