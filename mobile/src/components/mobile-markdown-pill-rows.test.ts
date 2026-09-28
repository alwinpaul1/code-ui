import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { createPhone, type PhoneAs } from './mobile-markdown-code-pill-phone.test-support'
import { HANDOVER_2026_09_26_LINES_18_TO_68 } from './mobile-markdown-handover-fixture.test-support'
import { pillRows, type PillRow } from './mobile-markdown-pill-rows.test-support'
import { resetRememberedPillCutsForTests } from './use-markdown-code-pill-runs'

const system = vi.hoisted(() => ({ fontScale: 1, api: 34 }))
vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { get: () => 2.8125, getFontScale: () => system.fontScale },
  Platform: {
    OS: 'android',
    get Version() {
      return system.api
    }
  },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

let renderer: ReactTestRenderer | null = null
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  system.fontScale = 1
  system.api = 34
  resetRememberedPillCutsForTests()
})

/** The Files tab's reader on a Galaxy S23 Ultra: 384 dp less its margins. */
const READER_WIDTH = 360

function rows(content: string, width = READER_WIDTH, as: PhoneAs = {}) {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content, textScale: as.textScale ?? 1 }))
  })
  act(() => device.layOutDocument(width))
  const { lineWidth } = device.settle(width, as)
  return pillRows(device.measuredText(), lineWidth, { ...as, api: system.api })
}

const off = (pills: readonly PillRow[]) =>
  pills.filter((row) => Math.abs(row.rise) > 1).map((row) => `${row.pill.text} ${row.rise.toFixed(1)} dp above "${row.lineText}"`)

// 2026-09-28, the phone, HANDOVER.md in the Files tab: every code pill below
// the `## Four pieces` heading sat higher than the words beside it, about
// half a line by the `### 1.` heading, over the line above. RN places a pill
// from its own layout of the Text and draws the words from the TextView's,
// and the two read a heading's line height apart: the newline after a
// heading was the separator's, set at the prose line height, and deep in a
// long Text the placing layout took that one (mobile-markdown-pill-rows.
// test-support.ts). Each heading line above a pill lifted it by the gap
// between the heading's line height and the prose's.
describe('code pills in the HANDOVER.md the phone drew them over', () => {
  it("keeps a heading's code pill on the heading's row", () => {
    const { pills } = rows(HANDOVER_2026_09_26_LINES_18_TO_68)
    const heading = pills.filter((row) => row.pill.text === '+93' || row.pill.text === '+61')
    expect(heading.map((row) => row.pill.text)).toEqual(['+93', '+61'])
    expect(off(heading)).toEqual([])
  })

  it('keeps a pill after a bold list label on its row when it wraps', () => {
    const { pills } = rows(HANDOVER_2026_09_26_LINES_18_TO_68)
    const worktree = pills.filter((row) => /a44e72e208010c6a9/.test(row.pill.text))
    // `.claude/worktrees/agent-a44e72e208010c6a9` in pieces, then the branch.
    expect(worktree.length).toBeGreaterThanOrEqual(2)
    expect(off(worktree)).toEqual([])
  })

  it('keeps a paragraph pill under a heading on its row', () => {
    const { pills } = rows(HANDOVER_2026_09_26_LINES_18_TO_68)
    const scratch = pills.filter((row) => row.pill.text.startsWith('zz-review'))
    expect(scratch).toHaveLength(1)
    expect(off(scratch)).toEqual([])
  })

  it('keeps every pill in the document on its row', () => {
    expect(off(rows(HANDOVER_2026_09_26_LINES_18_TO_68).pills)).toEqual([])
  })

  // Degenerate shapes, in the same document so as much text lies behind them:
  // a heading that is one one-character pill and nothing else, and one that
  // starts with a pill, at each heading level.
  it.each([1, 2, 3, 4])('keeps a pill that starts or is the whole of an h%i on its row', (level) => {
    const hashes = '#'.repeat(level)
    const content = HANDOVER_2026_09_26_LINES_18_TO_68.replace(
      '### 1. Large-file',
      `${hashes} \`x\`\n\n${hashes} \`first\` then words\n\n### 1. Large-file`
    )
    const { pills } = rows(content)
    const degenerate = pills.filter((row) => row.pill.text === 'x' || row.pill.text === 'first')
    expect(degenerate.map((row) => row.pill.text)).toEqual(['x', 'first'])
    expect(off(pills)).toEqual([])
  })

  it('lays every line out at one height, where its pills are placed and where its words are drawn', () => {
    const { drawn, placed } = rows(HANDOVER_2026_09_26_LINES_18_TO_68)
    const apart = drawn
      .map((line, index) => ({ line, placed: placed[index]! }))
      .filter(({ line, placed: other }) => Math.abs(line.height - other.height) > 0.01)
      .map(({ line, placed: other }) => `"${line.text}" drawn ${line.height} dp, placed ${other.height} dp`)
    expect(apart).toEqual([])
  })
})
