import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import {
  createPhone,
  earlyLineEnds,
  sharedLines,
  type ModelLine,
  type PhoneAs
} from './mobile-markdown-code-pill-phone.test-support'
import { resetRememberedPillCutsForTests, rememberedPillTextCount } from './use-markdown-code-pill-runs'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => 1 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// 2026-09-26, two screenshots side by side: "See blue pill leaves a lot of
// space but Claude mobile app doesn't show like that." The Claude app starts
// `/Users/alwinpaul/Desktop/Project/Code` on the "Worktree:" line and carries
// "UI/.claude/worktrees/chat-rows" to the next. Code UI cut the pill to a
// whole line's width wherever it started, so the pill did not fit after
// "Worktree:", jumped whole to the next line, and left that line mostly empty;
// the same happened to every pill after it.
//
// The phone is a model (mobile-markdown-code-pill-phone.test-support.ts):
// widths from the bundled font, Android's greedy lines, and layout events as
// Fabric sends them. What only the device shows is listed in the commits.

let renderer: ReactTestRenderer | null = null
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetRememberedPillCutsForTests()
})

const pills = () => device.pills()
const pillTexts = () => device.pillTexts()
const pillKeys = () => device.pillKeys()
const measuredText = () => device.measuredText()
const phoneLines = (documentWidth: number, as: PhoneAs = {}) => device.lines(documentWidth, as)
const settleMounted = (documentWidth: number, as: PhoneAs = {}) => device.settle(documentWidth, as)

function mount(content: string, documentWidth: number, onOpenFile?: (path: string) => void, textScale = 1) {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content, onOpenFile, textScale }))
  })
  act(() => device.layOutDocument(documentWidth))
}

/** Mount, measure, and lay out until the Text has nothing new to report. */
function settle(content: string, documentWidth: number, pillError = 1, onOpenFile?: (path: string) => void, textScale = 1) {
  mount(content, documentWidth, onOpenFile, textScale)
  return settleMounted(documentWidth, { pillError, textScale })
}

const WORKTREE_ITEM =
  '- Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.'

describe('inline code flows with the words around it, as in the Claude app', () => {
  it.each([
    [360, 1],
    [320, 1],
    [390, 1.06],
    [300, 0.95]
  ])('starts the Worktree pill on the "Worktree:" line and leaves no early line end (%i dp, pills drawn ×%s)', (width, error) => {
    const { lines, rounds } = settle(WORKTREE_ITEM, width, error)
    // The pill starts right after the word before it, on the same line.
    expect(lines[0]!.text).toMatch(/Worktree: \uFFFC$/)
    expect(earlyLineEnds(lines, width, 1, error)).toEqual([])
    // Two pieces of one span never sit on the same line (2026-09-20).
    for (const line of lines) {
      expect(line.text).not.toContain('\uFFFC\uFFFC')
    }
    // Nothing is lost or reordered between the pieces.
    expect(pillTexts().join('').replace(/\s/g, '')).toBe(
      '/Users/alwinpaul/Desktop/Project/CodeUI/.claude/worktrees/chat-rowsfix/chat-rows68a160e506b32d5emain4f46fd47'
    )
    // No line's ink runs past the paragraph (trailing spaces hang, as on Android).
    for (const line of lines) {
      expect(line.ink, line.text).toBeLessThanOrEqual(width + 0.5)
    }
    expect(rounds).toBeLessThanOrEqual(8)
  })

  it('cuts a span longer than a whole line to fill each line it crosses', () => {
    const width = 300
    const { lines } = settle(
      'The review probes are in `/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/scratchpad/chat-rows-review-probes/`. Copy them in.',
      width
    )
    expect(lines[0]!.text).toMatch(/are in \uFFFC$/)
    expect(earlyLineEnds(lines, width)).toEqual([])
    for (const line of lines) {
      expect(line.ink, line.text).toBeLessThanOrEqual(width + 0.5)
    }
  })

  it('keeps a short span whole and moves it down like a word when it does not fit', () => {
    const width = 200
    const { lines } = settle('A long lead-in sentence that nearly fills commits `68a160e5` and more.', width)
    expect(pillTexts()).toEqual(['68a160e5'])
    expect(earlyLineEnds(lines, width)).toEqual([])
  })

  it('opens the whole path from every piece of a split file pill on a tap, and not on a hold', () => {
    const opened: string[] = []
    settle(
      'The follow rule lives in `mobile/src/session/use-mobile-chat-following-controller.ts` today.',
      220,
      1,
      (path) => opened.push(path)
    )
    const pieces = pills().map((pill) => pill.findByType('Text' as never))
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) {
      expect(typeof piece.props.onLongPress).toBe('function')
      act(() => piece.props.onLongPress())
    }
    expect(opened).toEqual([])
    for (const piece of pieces) {
      act(() => piece.props.onPress())
    }
    expect(new Set(opened)).toEqual(new Set(['mobile/src/session/use-mobile-chat-following-controller.ts']))
  })

  it.each([
    ['a quote', '> Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows` for this.', 1],
    ['a paragraph at the reader\'s zoom', 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows` for this.', 1.3]
  ] as const)('does the same in %s', (_where, content, scale) => {
    const { lines, lineWidth } = settle(content, 360, 1, undefined, scale)
    expect(lines[0]!.text).toMatch(/Worktree: \uFFFC$/)
    expect(earlyLineEnds(lines, lineWidth, scale)).toEqual([])
    for (const line of lines) {
      expect(line.text).not.toContain('\uFFFC\uFFFC')
      expect(line.ink, line.text).toBeLessThanOrEqual(lineWidth + 0.5)
    }
  })

  it('does the same in a table cell, cut to the cell', () => {
    const table = ['| Where | What |', '| --- | --- |', '| at `source-control/use-mobile-commit-message-generation.ts` today | text |'].join('\n')
    const { lines, lineWidth } = settle(table, 360)
    expect(lineWidth).toBeLessThan(260)
    expect(lines[0]!.text).toMatch(/^at \uFFFC$/)
    for (const line of lines) {
      expect(line.text).not.toContain('\uFFFC\uFFFC')
      expect(line.ink, line.text).toBeLessThanOrEqual(lineWidth + 0.5)
    }
  })
})

describe('settling costs a few layouts once, not on every mount', () => {
  it('draws a message scrolled away and back with its settled pills at once', () => {
    const content = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows-remount` here.'
    settle(content, 350)
    const settled = pillTexts()
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content }))
    })
    const root = renderer!.root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
    act(() => root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 350, height: 400 } } }))
    // No layout has been read on this mount yet.
    expect(pillTexts()).toEqual(settled)
  })

  it('stops re-cutting a Text whose layout never settles', () => {
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/never-settles` here.'
        })
      )
    })
    const root = renderer!.root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
    act(() => root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 400 } } }))
    const cuts: string[] = []
    for (let event = 0; event < 30; event += 1) {
      // A phone that always says the pill went down a line, with the room
      // above it swinging back and forth.
      const pieces = pillTexts().length
      const lines = [
        { x: 0, y: 0, width: event % 2 ? 80 : 240, height: 25, text: 'Worktree: ' },
        ...Array.from({ length: pieces }, (_, index) => ({ x: 0, y: 25 * (index + 1), width: 200, height: 25, text: '\uFFFC' }))
      ]
      act(() => measuredText().props.onTextLayout({ nativeEvent: { lines } }))
      cuts.push(pillTexts().join('|'))
    }
    // Capped: the last ten layouts changed nothing.
    expect(new Set(cuts.slice(-10)).size).toBe(1)
  })
})

function noSharedLines(lines: ModelLine[]): void {
  expect(sharedLines(lines), 'two pieces of one span on one line').toEqual([])
}

// Review of 216a856f: every settle round remounted every pill in the Text
// (88 pills for a 52-span message), and a remount drops a selection or a
// press in progress. A span re-cut to its line moves only what comes after it.
describe('re-cutting a pill', () => {
  it('leaves the pills before it mounted', () => {
    mount('Run `pnpm install` then see `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/remount-probe` for more.', 360)
    const before = pillKeys()
    const { text, event } = phoneLines(360)
    act(() => text.props.onTextLayout(event))
    const after = pillKeys()
    expect(pillTexts().slice(1)).not.toEqual([])
    expect(after[0]).toBe(before[0])
    expect(after.slice(1)).not.toEqual(before.slice(1))
  })
})

// Review of 216a856f, probe C2, and a sweep of the model over widths and
// pill-width errors: when the phone draws pills narrower than estimated, two
// continuation pieces of one span shared a line ("\uFFFC\uFFFC "); wider, a lone piece
// ran past the edge of its line. Only the span's first line was read back.
describe('the phone drawing pills narrower or wider than estimated', () => {
  const COMMAND =
    'Run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs` before committing.'
  const PROBES =
    'The review probes are in `/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/scratchpad/chat-rows-review-probes/`. Copy them in.'
  it.each([
    ['the Worktree item', 304, 0.9, WORKTREE_ITEM],
    ['a long command', 384, 0.9, COMMAND],
    ['the Worktree item', 336, 1.1, WORKTREE_ITEM],
    ['a long token', 376, 0.95, PROBES],
    ['a long token', 332, 1.1, PROBES],
    ['a long command', 420, 1.1, COMMAND]
  ] as const)('keeps %s on whole lines at %i dp, pills drawn ×%s', (_what, width, error, content) => {
    const { lines, lineWidth } = settle(content, width, error)
    noSharedLines(lines)
    expect(earlyLineEnds(lines, lineWidth, 1, error)).toEqual([])
    for (const line of lines) {
      expect(line.ink, line.text).toBeLessThanOrEqual(lineWidth + 0.5)
    }
  })
})

// Review of 216a856f: greedy breaking went on every prose Text. It is there
// so a line takes every pill that fits; a paragraph with no pill keeps
// Android's own breaking.
describe("a paragraph's line breaking", () => {
  it('stays as Android breaks it where there is no code, and is greedy where there is', () => {
    act(() => {
      renderer = create(
        createElement(MobileMarkdown, {
          content: ['A paragraph with no code at all.', '', '```sh', 'ls', '```', '', 'A paragraph with `code` in it.'].join('\n')
        })
      )
    })
    act(() => device.layOutDocument(360))
    const document = renderer!.root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
    const runs = document.children.filter(
      (child): child is ReactTestInstance => typeof child !== 'string' && child.type === ('Text' as never)
    )
    expect(runs.map((run) => run.props.textBreakStrategy)).toEqual([undefined, 'simple'])
  })
})

// Review of 216a856f: a streaming reply wrote a remembered cut for every
// accepted round, each under a document that is never drawn again, pushing
// other messages' settled pills out of the 300 kept.
describe('what is remembered for a streaming reply', () => {
  it('is one settled cut per Text, not one per update', () => {
    const before = rememberedPillTextCount()
    let content = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/stream-probe`'
    mount(content, 360)
    settleMounted(360)
    for (let update = 0; update < 12; update += 1) {
      content += ` then \`step/${update}/of/the/streaming/reply/with/a/long/enough/path\``
      act(() => renderer!.update(createElement(MobileMarkdown, { content })))
      settleMounted(360)
    }
    expect(rememberedPillTextCount() - before).toBe(1)
  })
})

