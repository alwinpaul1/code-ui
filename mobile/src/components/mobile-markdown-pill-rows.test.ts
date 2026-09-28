import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { createPhone, flatStyle, hostParent, overflowingLines, type PhoneAs } from './mobile-markdown-code-pill-phone.test-support'
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

/** The type size a pill's words are set in: the nearest Text above it that
 *  names one. */
function wordsSizeAround(pill: ReactTestInstance): number {
  for (let node = hostParent(pill); node; node = hostParent(node)) {
    const size = flatStyle(node.props.style).fontSize
    if (typeof size === 'number') {
      return size
    }
  }
  return Number.NaN
}

const SHAPES = {
  paragraph: 'Run `pnpm install` before `x` and the rest.',
  h1: '# Run `pnpm install` first',
  h2: '## Run `pnpm install` first',
  h3: '### 1. Large-file line count (`+93` where the phone showed `+61`)',
  h4: '#### Run `pnpm install` first',
  'list item': '- **Worktree:** `.claude/worktrees/agent-a44e72e208010c6a9`, branch\n  `worktree-agent-a44e72e208010c6a9`, 25 commits past main, all committed.',
  quote: '> Run `pnpm install` first.',
  'table cell': '| Step |\n| --- |\n| Run `pnpm install` |'
} as const

// 2026-09-28: the user, beside the Claude app: its pill's text is set from
// the words around it and sits on their row, and the pill fits inside the
// line, so the line spacing does not change and nothing overlaps. Code UI's
// was 14 sp wherever it was, a third smaller than an h1's words, and a
// placeholder taller than the words' ascent.
describe("a pill's text", () => {
  it.each(Object.entries(SHAPES))('is sized from the words around it in a %s', (_, content) => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content }))
    })
    const found = device.pills().map((pill) => {
      const label = flatStyle(pill.findByType('Text' as never).props.style)
      return Number(label.fontSize) / wordsSizeAround(pill)
    })
    expect(found.length).toBeGreaterThan(0)
    // The Claude app's pill against its words (x-height 17 px to 20) is
    // 0.85; Code UI's words are set to wrap where its narrower face wraps,
    // and at 0.9 of them the pill's text is the Claude pill's size in dp.
    for (const ratio of found) {
      expect(ratio).toBeCloseTo(0.9, 6)
    }
  })
})

describe('a pill in its line', () => {
  const LINE_SHAPES = {
    paragraph: SHAPES.paragraph,
    heading: SHAPES.h3,
    'list item': SHAPES['list item'],
    // Degenerate: a line of nothing but a pill, a pill starting a heading,
    // and a one-character pill.
    'line of pills alone': 'See `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/md-pill-row/mobile/src/components/mobile-markdown-prose-scale.ts` now.',
    'heading that starts with a pill': '## `first` then words',
    'one-character pill': 'a `x` b',
    // Review of 2ebd5ce6: an h1's pill, set from its words, filled its line
    // at 150% to 200% on Android 14's curve, 0.23 dp from each edge; these
    // wrap, so a pill sits over a pill.
    h1: '# See `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/md-pill-row/mobile/src` now',
    h2: '## See `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/md-pill-row/mobile/src` now'
  } as const

  const changed = (content: string, as: PhoneAs = {}) =>
    rows(content, READER_WIDTH, as)
      .drawn.filter((line) => line.text.includes('￼'))
      .filter((line) => Math.abs(line.above - line.plainAbove) > 0.05)
      .map((line) => `"${line.text}" baseline ${line.above.toFixed(2)} dp down, ${line.plainAbove.toFixed(2)} without its pills`)

  it.each(Object.entries(LINE_SHAPES))('does not change the line it sits on, in a %s', (_, content) => {
    expect(changed(content)).toEqual([])
  })

  it('does not change a line in HANDOVER.md', () => {
    expect(changed(HANDOVER_2026_09_26_LINES_18_TO_68)).toEqual([])
  })

  /** The system font size at its largest (Android 14's curve at 200%) and the
   *  reader's zoom at both ends, with the default between. */
  const SCALES: readonly [string, PhoneAs & { api?: number }][] = [
    ['the default size', {}],
    ['150% system font size', { fontScale: 1.5 }],
    ['the largest system font size', { fontScale: 2 }],
    ['the largest zoom', { textScale: 1.8 }],
    ['the smallest zoom', { textScale: 0.8 }],
    ['the largest system font size and zoom', { fontScale: 2, textScale: 1.8 }]
  ]

  const overlaps = (content: string, as: PhoneAs) => {
    system.fontScale = as.fontScale ?? 1
    return rows(content, READER_WIDTH, as)
      .pills.filter((row) => row.box.top < row.lineBox.top + 0.5 || row.box.bottom > row.lineBox.bottom - 0.5)
      .map(
        (row) =>
          `${row.pill.text} [${(row.box.top - row.lineBox.top).toFixed(2)}, ${(row.box.bottom - row.lineBox.top).toFixed(2)}] in a ${(row.lineBox.bottom - row.lineBox.top).toFixed(2)} dp line "${row.lineText}"`
      )
  }

  /** Pills on consecutive lines of one Text: 2 dp of clear air, the
   *  collision test's floor (mobile-markdown-chip-clipping.test.ts). */
  const crowded = (content: string, as: PhoneAs) => {
    system.fontScale = as.fontScale ?? 1
    const { pills } = rows(content, READER_WIDTH, as)
    return pills.flatMap((row) =>
      pills
        .filter((below) => below.line === row.line + 1 && below.box.top - row.box.bottom < 2 - 1e-6)
        .map((below) => `${row.pill.text} over ${below.pill.text}: ${(below.box.top - row.box.bottom).toFixed(2)} dp`)
    )
  }

  for (const [name, as] of SCALES) {
    it.each(Object.entries(LINE_SHAPES))(`stays inside its line, clear of the lines above and below, in a %s at ${name}`, (_, content) => {
      expect(overlaps(content, as)).toEqual([])
    })
    it.each(Object.entries(LINE_SHAPES))(`keeps 2 dp from a pill on the next line, in a %s at ${name}`, (_, content) => {
      expect(crowded(content, as)).toEqual([])
    })
    it(`stays inside its line throughout HANDOVER.md at ${name}`, () => {
      expect(overlaps(HANDOVER_2026_09_26_LINES_18_TO_68, as)).toEqual([])
    })
  }
})

// A heading's pill is set from the heading's size, so it is cut for that
// size too (use-markdown-code-pill-runs.ts): cut as a paragraph's, an h1's
// first piece ran past the line on the first layout and the Text laid out
// again to learn it.
describe("a heading's long pill", () => {
  it.each([1, 2, 3])('is cut for the h%i it is in from the first layout', (level) => {
    const content = `${'#'.repeat(level)} See \`/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/md-pill-row/mobile/src/components\` now`
    for (const width of [320, 360, 400]) {
      act(() => {
        renderer = create(createElement(MobileMarkdown, { content }))
      })
      act(() => device.layOutDocument(width))
      const { lines, lineWidth } = device.lines(width)
      expect(overflowingLines(lines, lineWidth), `at ${width} dp`).toEqual([])
      act(() => renderer?.unmount())
      renderer = null
      resetRememberedPillCutsForTests()
    }
  })
})

// Review of 2ebd5ce6: the View the Text holds was the frame, shorter than
// the pill, and carried the pill's shift. A transform forms a native view
// (ViewShadowNode.cpp), so the frame was mounted with its own short bounds
// and the pill inside it; Android hit-tests a child only inside its
// parent's bounds (ViewGroup.dispatchTouchEvent), and a hold on the lower
// 40% of a pill (69% at 200%) fell through to the prose under it and
// selected around the pill instead of the code in it, undoing 18c2d365.
describe('a hold on a pill', () => {
  /** What makes Fabric mount a View as a native view of its own
   *  (ViewShadowNode.cpp, formsView and formsStackingContext), of what a
   *  style or a prop here could carry. */
  const FORMS_A_VIEW = ['transform', 'opacity', 'backgroundColor', 'borderWidth', 'borderColor', 'zIndex', 'overflow']
  const PROPS_FORMING_A_VIEW = ['collapsable', 'pointerEvents', 'nativeID', 'testID', 'accessible', 'onLayout']

  it('reaches the code anywhere on the pill, top to bottom', () => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: SHAPES['list item'] }))
    })
    const frames = device.pills()
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) {
      // The frame Android lays out on the line is layout only, so Fabric
      // flattens it and mounts the pill itself, with the pill's bounds.
      const style = flatStyle(frame.props.style)
      expect(Object.keys(style).filter((key) => FORMS_A_VIEW.includes(key))).toEqual([])
      expect(Object.keys(frame.props).filter((key) => PROPS_FORMING_A_VIEW.includes(key))).toEqual([])
      // The pill carries its own shift, so the view hit-tested is where the
      // pill is drawn.
      const pill = frame.findAll((node) => node !== frame && node.type === ('View' as never))[0]!
      const own = flatStyle(pill.props.style)
      expect(own.borderWidth).toBeGreaterThan(0)
      expect((own.transform as { translateY?: number }[] | undefined)?.some((entry) => entry.translateY !== undefined)).toBe(true)
    }
  })

  it('rests on Fabric forming a native view for a transform and a border, and not for a height', () => {
    const source = readFileSync(
      resolve(__dirname, '../../node_modules/react-native/ReactCommon/react/renderer/components/view/ViewShadowNode.cpp'),
      'utf8'
    )
    const stacking = /bool formsStackingContext =([\s\S]*?);\n/.exec(source)![1]!
    const view = /bool formsView =([\s\S]*?);\n/.exec(source)![1]!
    expect(stacking).toContain('viewProps.transform != Transform{}')
    expect(view).toContain('hasBorder()')
    expect(`${stacking}${view}`).not.toMatch(/height|yogaStyle\.dimension/)
  })
})
