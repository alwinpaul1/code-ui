import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { cutCodePills } from './mobile-markdown-code-chip-split'
import {
  createPhone,
  earlyLineEnds,
  flatStyle,
  overflowingLines,
  sharedLines,
  type ModelLine
} from './mobile-markdown-code-pill-phone.test-support'
import { resetRememberedPillCutsForTests } from './use-markdown-code-pill-runs'

/** The system font size (Settings > Display > Font size), as RN reads it. */
const system = vi.hoisted(() => ({ fontScale: 1 }))
vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => system.fontScale },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// Code pills after the Text they sit in is laid out again: a rotation, split
// screen or pop-up view; a list cell recycled for another message; a system
// font size change; a reply streaming in. The phone is a model
// (mobile-markdown-code-pill-phone.test-support.ts), with layout events only
// when Fabric would send them.

let renderer: ReactTestRenderer | null = null
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  system.fontScale = 1
  resetRememberedPillCutsForTests()
})

function mount(content: string, documentWidth: number, identity?: string) {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content, identity }))
  })
  act(() => device.layOutDocument(documentWidth))
}

function unmount() {
  act(() => renderer?.unmount())
  renderer = null
}

/** The pills a fresh phone settles on at a width, then forgotten. */
function fresh(content: string, width: number, identity?: string): string[] {
  mount(content, width, identity)
  device.settle(width)
  const settled = device.pillTexts()
  unmount()
  resetRememberedPillCutsForTests()
  return settled
}

function mountedText(node: ReactTestInstance): unknown {
  return (node as unknown as { _fiber: { stateNode: unknown } })._fiber.stateNode
}

function whole(lines: ModelLine[], lineWidth: number): string[] {
  return [...sharedLines(lines), ...overflowingLines(lines, lineWidth), ...earlyLineEnds(lines, lineWidth)]
}

// Review of 216a856f, 2026-09-27: Fabric lays the existing tree out at the new
// width and reports its lines (ParagraphShadowNode::layout) before the
// document's onLayout brings the new width to a render. Read against the old
// width, a wider layout looked like overflow and cut every continuation piece
// short, for the rest of the session. Review of f8c968a1: a NARROWER layout
// read against the old, wider width looked like a pill that had room and went
// down a line anyway, so its first piece was capped; that was kept for the
// wide width, and every further turn cut one unit shorter.
describe('turning the phone, or a split screen', () => {
  const ONE_LINE_AT_700 = (tag: string) =>
    `Worktree: \`/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/${tag}\` today.`

  it('keeps the pills it had after turning the phone and back', () => {
    mount(ONE_LINE_AT_700('rotation-probe'), 360)
    device.settle(360)
    const portrait = device.pillTexts()
    device.rotateTo(700)
    device.settle(700)
    device.rotateTo(360)
    const { lines, lineWidth } = device.settle(360)
    expect(device.pillTexts()).toEqual(portrait)
    expect(whole(lines, lineWidth)).toEqual([])
  })

  it('keeps the wide pills it had after narrowing and widening again (700, 360, 700)', () => {
    mount(ONE_LINE_AT_700('narrow-and-back'), 700)
    device.settle(700)
    const wide = device.pillTexts()
    device.rotateTo(360)
    device.settle(360)
    device.rotateTo(700)
    const { lines, lineWidth } = device.settle(700)
    expect(device.pillTexts()).toEqual(wide)
    expect(whole(lines, lineWidth)).toEqual([])
  })

  it('does not cut a unit shorter on every turn', () => {
    mount(ONE_LINE_AT_700('more-turns') + ' And `packages/some-thing/src/index.ts` there.', 360)
    device.settle(360)
    device.rotateTo(700)
    device.settle(700)
    const wide = device.pillTexts()
    for (let turn = 0; turn < 4; turn += 1) {
      device.rotateTo(360)
      device.settle(360)
      device.rotateTo(700)
      const { lines, lineWidth } = device.settle(700)
      expect(device.pillTexts(), `turn ${turn}`).toEqual(wide)
      expect(whole(lines, lineWidth), `turn ${turn}`).toEqual([])
    }
  })

  it('draws a message scrolled away and back after a rotation with its pills whole', () => {
    for (const [first, other] of [
      [360, 700],
      [700, 360]
    ] as const) {
      const content = ONE_LINE_AT_700(`remount-${first}`)
      mount(content, first)
      device.settle(first)
      const settled = device.pillTexts()
      device.rotateTo(other)
      device.settle(other)
      device.rotateTo(first)
      device.settle(first)
      unmount()
      mount(content, first)
      expect(device.pillTexts(), `back at ${first}`).toEqual(settled)
      device.settle(first)
      expect(device.pillTexts(), `back at ${first}`).toEqual(settled)
      unmount()
    }
  })

  it.each([
    [412, 300],
    [360, 520],
    [600, 412]
  ])('keeps its pills through split screen widths %i and %i, back and forth', (big, small) => {
    const content = ONE_LINE_AT_700(`split-${big}-${small}`)
    mount(content, big)
    device.settle(big)
    const reference = device.pillTexts()
    for (const width of [small, big, small, big]) {
      device.rotateTo(width)
      const { lines, lineWidth } = device.settle(width)
      expect(sharedLines(lines), `${width}`).toEqual([])
      expect(overflowingLines(lines, lineWidth), `${width}`).toEqual([])
    }
    expect(device.pillTexts()).toEqual(reference)
  })

  it('keeps two pieces of a span off one line while a reply streams in across turns', () => {
    let content = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/stream-and-turn`'
    mount(content, 700, 'reply')
    device.settle(700)
    ;[360, 700, 360, 700, 360, 700].forEach((width, step) => {
      content += ` then \`step/${step}\``
      act(() => renderer!.update(createElement(MobileMarkdown, { content, identity: 'reply' })))
      device.rotateTo(width)
      const { lines } = device.settle(width)
      expect(sharedLines(lines), `step ${step} at ${width}`).toEqual([])
    })
  })

  // Review of f8c968a1, probe B1: a refused read can be the only layout a
  // width ever gets. When the tree at the new width is the tree at the old
  // one, Fabric lays nothing out again (a new onTextLayout function is not an
  // update), so a pill that could start on the line above stayed down.
  it('reads the new width even when the tree drawn at it is the same', () => {
    const content =
      'the quick brown fox jumps over a lazy dog while reading notes about builds and the quick brown fox jumps over a lazy dog while reading notes about builds and the quick brown fox jumps over a lazy dog while reading notes about builds and the quick brown fox jumps over a lazy dog while reading notes about builds and the quick brown fox jumps over a lazy dogxxxxxxx `src/components/zz-69/pill-runs.ts` then more words to finish the paragraph off here.'
    mount(content, 360)
    device.settle(360)
    device.rotateTo(700)
    const { lines, lineWidth } = device.settle(700)
    expect(whole(lines, lineWidth)).toEqual([])
  })

  // The other order: the width reaches a render first, and the rotation's
  // lines of the tree as it was drawn come after, to the Text that holds
  // the new handler, if it is still the same Text.
  it.each([
    ['Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/width-first` today.'],
    [
      '- Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows-wf`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.'
    ],
    ['Run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-wf.mjs` before committing.']
  ])('ends whole when the width arrives before the rotation lines: %s', (content) => {
    mount(content, 360)
    device.settle(360)
    for (const width of [700, 360, 700, 360, 700]) {
      const before = device.measuredText()
      const { event } = device.lines(width)
      act(() => device.layOutDocument(width))
      const after = device.measuredText()
      if ((before as unknown as { _fiber: { stateNode: unknown } })._fiber.stateNode === (after as unknown as { _fiber: { stateNode: unknown } })._fiber.stateNode) {
        act(() => after.props.onTextLayout?.(event))
      }
      const { lines, lineWidth } = device.settle(width)
      expect(whole(lines, lineWidth), `${width}`).toEqual([])
    }
  })
})

// Review of 3dd68229: between two close widths (a split-screen divider, a
// pop-up view, DeX, a tablet) no pair of stale lines is short enough to prove
// a narrower layout. At 800 -> 600 -> 800 the 600 dp lines reached the 800
// handler; a span that started a line right after the same words there
// looked cut for that room and gone down anyway, and its first piece was
// capped a unit short at 800, remembered, and kept through a remount.
describe('a turn between two close widths', () => {
  const CLOSE = [
    'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.',
    'the fix lives in `mobile/src/components/use-markdown-code-pill-runs.ts` and `mobile/src/components/mobile-markdown-code-pill-fit.ts`, both of them.',
    'run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs` before committing.'
  ]
  const LEAD = 'I checked this again after the last review and it reads the same way on the phone as on the desktop today'.split(' ')

  it('keeps the first line full at 800 after 800, 600, 800, and after scrolling away and back', () => {
    const content = CLOSE[1]!
    const wide = fresh(content, 800)
    mount(content, 800)
    device.settle(800)
    device.rotateTo(600)
    device.settle(600)
    device.rotateTo(800)
    const { lines, lineWidth } = device.settle(800)
    expect(device.pillTexts()).toEqual(wide)
    expect(whole(lines, lineWidth)).toEqual([])
    unmount()
    mount(content, 800)
    expect(device.pillTexts()).toEqual(wide)
  })

  it.each([1.1, 1.2, 1.3, 1.4, 1.6])('leaves no gap after a turn at a width ratio of %s', (ratio) => {
    const found: string[] = []
    for (const wide of [800, 700]) {
      const narrow = Math.round(wide / ratio)
      CLOSE.forEach((base, index) => {
        for (let n = 0; n <= LEAD.length; n += 3) {
          const content = `${LEAD.slice(0, n).join(' ')}${n ? ' ' : ''}${base}`
          const reference = fresh(content, wide)
          mount(content, wide)
          device.settle(wide)
          device.rotateTo(narrow)
          device.settle(narrow)
          device.rotateTo(wide)
          const { lines, lineWidth } = device.settle(wide)
          const problems = whole(lines, lineWidth)
          if (problems.length || device.pillTexts().join('|') !== reference.join('|')) {
            found.push(`${wide} -> ${narrow} c${index} n${n}: ${device.pillTexts().join(' | ')} ${problems.join(' ; ')}`)
          }
          unmount()
          resetRememberedPillCutsForTests()
        }
      })
    }
    expect(found).toEqual([])
  })
})

// Review of 216a856f: the chat list (FlashList 2.3.2, no per-item key in
// MobileNativeChatView) recycles a cell for another message. The cell's
// rooms were used for whatever it drew next at the same width.
describe('a recycled list cell', () => {
  it("draws the next message with that message's own settled pills at once", () => {
    const next = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/recycled-next` for this one.'
    const previous =
      'The branch is at `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/recycled-previous-one` for that one.'
    mount(next, 360, 'next')
    device.settle(360)
    const settled = device.pillTexts()
    unmount()
    mount(previous, 360, 'previous')
    device.settle(360)
    act(() => renderer!.update(createElement(MobileMarkdown, { content: next, identity: 'next' })))
    expect(device.pillTexts()).toEqual(settled)
  })

  // Review of f8c968a1, probe E1: a cell recycled for a message that begins
  // with the whole of the last one looked like the last one streaming on, and
  // the last one's remembered pills were thrown away.
  it('keeps the last message remembered when the next one begins with it', () => {
    const first = 'The worktree for this branch is at `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/recycled-prefix` is ready.'
    mount(first, 360, 'first')
    device.settle(360)
    const settled = device.pillTexts()
    act(() => renderer!.update(createElement(MobileMarkdown, { content: `${first} Then run \`pnpm install\` there.`, identity: 'second' })))
    device.settle(360)
    unmount()
    mount(first, 360, 'first')
    expect(device.pillTexts()).toEqual(settled)
  })
})

// Review of c3e62696: the chat draws the live reply as one row, `id:
// 'streaming'` (mobile-native-chat-render-data.ts), and starts a new segment
// in it for the next reply part, so every streamed part was `streaming:0:0`.
// Part two was cut with part one's pills (whose scale only rises), and part
// one's remembered pills were thrown away as "the same message, edited".
describe('reply parts streaming through one live row', () => {
  const PART_ONE =
    'Checks: `✓ lint ✓ types ✓ tests ✓ build ✓ e2e ✓ size ✓ docs ✓ deps ✓ perf ✓ a11y ✓ i18n ✓ lint ✓ types ✓ tests ✓ build ✓ e2e ✓ size ✓ docs ✓ deps ✓ perf ✓ a11y ✓ i18n ✓ lint ✓ types ✓ tests ✓ build ✓ e2e ✓ size` all green.'
  const partTwo = (k: number) =>
    `Worktree: \`/Users/alwinpaul/Desktop/Project/Code UI/.claude/${'w'.repeat(k)}worktrees/chat-rows/mobile/src/components/pills/index.ts\` is ready.`

  it('cuts the second part as a fresh phone would, at any width', () => {
    const found: string[] = []
    for (let k = 0; k < 30; k += 3) {
      for (const width of [340, 360, 393]) {
        const reference = fresh(partTwo(k), width, 'reference')
        mount(PART_ONE, width, 'streaming:0:0')
        device.settle(width)
        act(() => renderer!.update(createElement(MobileMarkdown, { content: partTwo(k), identity: 'streaming:0:0' })))
        const { lines, lineWidth } = device.settle(width)
        const problems = whole(lines, lineWidth)
        if (device.pillTexts().join('|') !== reference.join('|') || problems.length) {
          found.push(`k${k} @${width}: ${device.pillTexts().join(' | ')} ; ${problems.join(' ; ')}`)
        }
        unmount()
        resetRememberedPillCutsForTests()
      }
    }
    expect(found).toEqual([])
  })

  it('keeps the first part remembered for when it lands in a row of its own', () => {
    mount(partTwo(0), 360, 'streaming:0:0')
    device.settle(360)
    const settled = device.pillTexts()
    act(() => renderer!.update(createElement(MobileMarkdown, { content: 'And then `pnpm install` ran in the worktree.', identity: 'streaming:0:0' })))
    device.settle(360)
    unmount()
    mount(partTwo(0), 360, 'streaming:0:0')
    expect(device.pillTexts()).toEqual(settled)
  })
})

describe('a system font size change', () => {
  it('does not reuse the pills learnt at the old size', () => {
    const content = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/font-size-probe` here.'
    mount(content, 360)
    device.settle(360)
    unmount()
    system.fontScale = 1.3
    mount(content, 360)
    // Nothing learnt at this size: cut to a whole line, as on a first mount.
    expect(device.pillTexts()).toEqual(
      cutCodePills('/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/font-size-probe', 360, 360, {
        fontSize: 14,
        insets: 10
      }).pieces
    )
  })
})

// Review of c3e62696: every zoom step remounted every pill-holding table
// cell (80 of 82 Texts in a 40-row table, about 240 native views a step, up
// to 16 steps in a pinch), because the width in a Text's key moved with the
// cells' zoomed columns. A cell's width moves only with the zoom, which
// changes its pills' style too, so Fabric lays it out anyway.
describe('a table of pills', () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| \`fix/branch-${i}\` | \`mobile/src/file-${i}.ts\` | ok |`).join('\n')
  const TABLE = `Intro with \`a/b\` pill.\n\n| Branch | File | State |\n| --- | --- | --- |\n${rows}\n\nOutro with \`c/d\` pill.`
  const reading = () =>
    renderer!.root.findAll((node) => node.type === ('Text' as never) && typeof node.props.onTextLayout === 'function')

  it('remounts no Text on any step of a pinch', () => {
    mount(TABLE, 360)
    let before = new Set(reading().map(mountedText))
    for (const zoom of [1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8]) {
      act(() => renderer!.update(createElement(MobileMarkdown, { content: TABLE, textScale: zoom })))
      const now = reading()
      expect(now.filter((text) => !before.has(mountedText(text))).length, `zoom ${zoom}`).toBe(0)
      before = new Set(now.map(mountedText))
    }
  })

  it('keeps its cells, and their pills whole, through a rotation: a cell is as wide as its column', () => {
    mount(TABLE, 360)
    const cells = reading().filter((text) => typeof flatStyle(text.props.style).width === 'number')
    expect(cells.length).toBeGreaterThan(40)
    device.rotateTo(700)
    const after = new Set(reading().map(mountedText))
    expect(cells.every((cell) => after.has(mountedText(cell)))).toBe(true)
    expect(cells.every((cell) => flatStyle(cell.props.style).width === flatStyle(reading().find((text) => mountedText(text) === mountedText(cell))!.props.style).width)).toBe(true)
  })
})

// Review of f8c968a1, probe S1: greedy breaking came on the moment a
// streaming paragraph's first code span closed, re-breaking its earlier lines
// then. It is decided by the first backtick instead, which arrives before the
// span closes, and stays on.
describe('a paragraph streaming in', () => {
  it('breaks its lines the same way before and after its first code span closes', () => {
    const head = 'While the reply streams this paragraph has no closed code yet, then '
    const runText = () =>
      renderer!.root
        .findAll((node) => typeof node.props.onLayout === 'function')[0]!
        .children.find((child): child is ReactTestInstance => typeof child !== 'string' && child.type === ('Text' as never))!
    mount(`${head}\`pnpm`, 360)
    const open = runText().props.textBreakStrategy
    act(() => renderer!.update(createElement(MobileMarkdown, { content: `${head}\`pnpm install\`` })))
    expect(runText().props.textBreakStrategy).toBe(open)
    expect(open).toBe('simple')
  })
})

// Review of f8c968a1, probe I1: a figure drawn inside a prose run would be a
// second U+FFFC, and the run's pills would never be read. No run draws one:
// a figure the phone can draw is a block of its own (buildProseRuns), and an
// image left in a run has nothing to draw it from, so it is its link. The
// reader relies on that, and this pins it.
describe('an image link beside a pill in the same run', () => {
  it('is text, not a view, so the run reads its pills', () => {
    mount('A figure: ![plot](fig/plot.png)\n\nWorktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/figure-run` here.', 360)
    const run = device.measuredText()
    const views = run.findAll((node) => node.type === ('View' as never))
    expect(views.length).toBe(device.pills().length)
    expect(views.length).toBeGreaterThan(0)
    const { lines, lineWidth } = device.settle(360)
    expect(lines.some((line) => /Worktree: ￼/.test(line.text))).toBe(true)
    expect(whole(lines, lineWidth)).toEqual([])
  })
})
