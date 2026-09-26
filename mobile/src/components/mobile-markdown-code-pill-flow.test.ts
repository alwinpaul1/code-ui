import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import { cutCodePills } from './mobile-markdown-code-chip-split'
import { rememberedPillTextCount } from './use-markdown-code-pill-runs'

/** The system font size (Settings > Display > Font size), as RN reads it. */
const phone = vi.hoisted(() => ({ fontScale: 1 }))
vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => phone.fontScale },
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
// There is no layout engine under vitest, so this file carries a MODEL of the
// phone: Instrument Sans Regular advances (hmtx of the bundled TTF), greedy
// breaking after spaces and around an inline view (U+FFFC, class CB), no break
// before closing punctuation, and `onTextLayout` lines shaped as
// FontMetricsUtil.kt builds them on Android (RN 0.86): `width` is
// getLineWidth, trailing spaces included, except on a line that ends in a
// newline. It is a model, not a capture; what only the device shows is listed
// in the commit.

const ADVANCE = [
  200, 273, 384, 716, 608, 786, 755, 232, 406, 406, 408, 531, 255, 506, 255, 443,
  666, 391, 545, 574, 600, 574, 599, 532, 582, 610, 255, 255, 531, 531, 531, 567,
  853, 728, 636, 741, 752, 638, 602, 765, 736, 254, 455, 692, 588, 906, 736, 786,
  656, 787, 656, 608, 648, 712, 728, 1089, 688, 676, 623, 406, 443, 406, 531, 426,
  354, 533, 606, 533, 606, 564, 354, 606, 599, 240, 240, 535, 240, 922, 599, 584,
  606, 606, 375, 473, 377, 589, 523, 767, 551, 523, 496, 406, 242, 406, 531
]

function glyphWidth(ch: string, fontSize: number, family = ''): number {
  // JetBrains Mono is 600 units a glyph (hmtx of the bundled TTF).
  if (family.includes('Mono')) {
    return (600 * fontSize) / 1000
  }
  const code = ch.codePointAt(0) ?? 0
  const units = code >= 0x20 && code <= 0x7e ? ADVANCE[code - 0x20]! : 600
  return (units * fontSize) / 1000
}

type Style = Record<string, unknown>
function flat(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat))
  }
  return style && typeof style === 'object' ? (style as Style) : {}
}

type Item =
  | { kind: 'char'; ch: string; width: number }
  | { kind: 'pill'; text: string; width: number }

/** The phone's view of one Text: characters at their span's size, and each
 *  inline View as one placeholder as wide as the pill it draws. `pillError`
 *  is how much wider the phone draws a pill than the app estimates. */
function flatten(node: ReactTestInstance, fontSize: number, pillError: number, out: Item[]): Item[] {
  const size = Number(flat(node.props.style).fontSize ?? fontSize)
  for (const child of node.children) {
    if (typeof child === 'string') {
      for (const ch of Array.from(child)) {
        out.push({ kind: 'char', ch, width: glyphWidth(ch, size) })
      }
    } else if (child.type === ('View' as never)) {
      const box = flat(child.props.style)
      const label = child.findByType('Text' as never)
      const text = label.children.join('')
      const labelStyle = flat(label.props.style)
      const labelSize = Number(labelStyle.fontSize)
      const inset = 2 * (Number(box.paddingHorizontal ?? 0) + Number(box.borderWidth ?? 0))
      const glyphs = Array.from(text).reduce(
        (sum, ch) => sum + glyphWidth(ch, labelSize, String(labelStyle.fontFamily ?? '')),
        0
      )
      out.push({ kind: 'pill', text, width: glyphs * pillError + inset })
    } else {
      flatten(child, size, pillError, out)
    }
  }
  return out
}

type Line = { x: number; y: number; width: number; height: number; text: string; items: Item[]; ink: number }

function isSpace(item: Item): boolean {
  return item.kind === 'char' && item.ch === ' '
}

/** Greedy lines, as Android's `simple` break strategy lays them out. */
function layOut(items: Item[], lineWidth: number): Line[] {
  // Words: a run that cannot break inside, then its trailing spaces.
  const words: Item[][] = []
  let word: Item[] = []
  const flush = () => {
    if (word.length) {
      words.push(word)
    }
    word = []
  }
  for (const item of items) {
    const prev = word.at(-1)
    const gluedPunctuation = item.kind === 'char' && /[.,;:!?)\]]/.test(item.ch)
    if (item.kind === 'char' && item.ch === '\n') {
      flush()
      words.push([item])
      continue
    }
    if (prev && ((isSpace(prev) && !isSpace(item)) || (prev.kind === 'pill' && !isSpace(item) && !gluedPunctuation) || (item.kind === 'pill' && !isSpace(prev)))) {
      flush()
    }
    word.push(item)
  }
  flush()

  const lines: Line[] = []
  let current: Item[] = []
  const widthOf = (list: Item[]) => list.reduce((sum, item) => sum + item.width, 0)
  const inkOf = (list: Item[]) => {
    let end = list.length
    while (end > 0 && isSpace(list[end - 1]!)) {
      end -= 1
    }
    return widthOf(list.slice(0, end))
  }
  const push = (endsWithNewline: boolean) => {
    const text = current.map((item) => (item.kind === 'pill' ? '\uFFFC' : item.ch)).join('')
    lines.push({
      x: 0,
      y: lines.length * 25,
      height: 25,
      width: endsWithNewline ? inkOf(current) : widthOf(current),
      text,
      items: current,
      ink: inkOf(current)
    })
    current = []
  }
  for (const next of words) {
    if (next.length === 1 && next[0]!.kind === 'char' && next[0]!.ch === '\n') {
      current.push(next[0]!)
      push(true)
      continue
    }
    if (current.length && widthOf(current) + inkOf(next) > lineWidth) {
      push(false)
    }
    current.push(...next)
  }
  if (current.length) {
    push(false)
  }
  return lines
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  phone.fontScale = 1
})

/** The nearest host ancestor; the pill component sits between a pill's View
 *  and the Text it is drawn in. */
function hostParent(node: ReactTestInstance): ReactTestInstance | null {
  let parent = node.parent
  while (parent && typeof parent.type !== 'string') {
    parent = parent.parent
  }
  return parent
}

function pills(): ReactTestInstance[] {
  return renderer!.root.findAll(
    (node) => node.type === ('View' as never) && hostParent(node)?.type === ('Text' as never)
  )
}

function pillTexts(): string[] {
  return pills().map((pill) => pill.findByType('Text' as never).children.join(''))
}

/** The prose Text the pills are drawn in: the outermost Text holding one. */
function measuredText(): ReactTestInstance {
  let text = hostParent(pills()[0]!)!
  for (let up = hostParent(text); up?.type === ('Text' as never); up = hostParent(up)) {
    text = up
  }
  return text
}

/** The width a Text's lines are broken to: the document's, less a quote's
 *  bar and indent, or a table cell's own width less its padding and border. */
function textWidth(text: ReactTestInstance, documentWidth: number): number {
  const own = flat(text.props.style)
  if (typeof own.width === 'number') {
    return own.width - 2 * Number(own.paddingHorizontal ?? 0) - Number(own.borderRightWidth ?? 0)
  }
  const box = hostParent(text)
  const quote = box ? flat(box.props.style) : {}
  return documentWidth - Number(quote.borderLeftWidth ?? 0) - Number(quote.paddingLeft ?? 0)
}

type Phone = { pillError?: number; textScale?: number }

/** The lines the phone reports for the tree as it stands, broken to `documentWidth`. */
function phoneLines(documentWidth: number, { pillError = 1, textScale = 1 }: Phone = {}) {
  const text = measuredText()
  const lineWidth = textWidth(text, documentWidth)
  const lines = layOut(flatten(text, 15 * textScale, pillError, []), lineWidth)
  const event = { nativeEvent: { lines: lines.map(({ items: _items, ink: _ink, ...line }) => line) } }
  return { text, lines, lineWidth, event }
}

/** The document's own onLayout, as Fabric sends it after a layout. */
function layOutDocument(documentWidth: number) {
  const root = renderer!.root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
  root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: documentWidth, height: 400 } } })
}

/** Hand the phone's lines back until nothing moves. */
function settleMounted(documentWidth: number, phoneAs: Phone = {}): { lines: Line[]; rounds: number; lineWidth: number } {
  for (let round = 0; round < 12; round += 1) {
    const { text, lines, lineWidth, event } = phoneLines(documentWidth, phoneAs)
    if (typeof text.props.onTextLayout !== 'function') {
      // A Text that does not read its layout is drawn as first cut.
      return { lines, rounds: round, lineWidth }
    }
    const before = pillTexts().join('|')
    act(() => text.props.onTextLayout(event))
    if (pillTexts().join('|') === before) {
      return { lines, rounds: round, lineWidth }
    }
  }
  throw new Error('the pills never settled')
}

function mount(content: string, documentWidth: number, onOpenFile?: (path: string) => void, textScale = 1) {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content, onOpenFile, textScale }))
  })
  act(() => layOutDocument(documentWidth))
}

/** Mount, measure, and hand the phone's lines back until nothing moves. */
function settle(
  content: string,
  documentWidth: number,
  pillError = 1,
  onOpenFile?: (path: string) => void,
  textScale = 1
): { lines: Line[]; rounds: number; lineWidth: number } {
  mount(content, documentWidth, onOpenFile, textScale)
  return settleMounted(documentWidth, { pillError, textScale })
}

/** Nothing on the next line could have fitted at the end of this one. For a
 *  pill that means its first unbreakable piece (up to a slash or a space),
 *  since a pill can be cut there. */
function earlyLineEnds(lines: Line[], lineWidth: number, scale = 1, pillError = 1): string[] {
  const found: string[] = []
  lines.forEach((line, index) => {
    const next = lines[index + 1]
    if (!next || line.text.endsWith('\n')) {
      return
    }
    const room = lineWidth - line.width
    const head = next.items[0]!
    let need: number
    if (head.kind === 'pill') {
      const unit = /^[^/\s]*[/\s]?/.exec(head.text)![0]
      need = Array.from(unit.trimEnd()).reduce((sum, ch) => sum + glyphWidth(ch, 14 * scale), 0) * pillError + 10 * scale
      if (unit.length === head.text.length) {
        // The whole pill, and the punctuation glued after it, which cannot break away.
        for (const item of next.items.slice(1)) {
          if (item.kind !== 'char' || item.ch === ' ') {
            break
          }
          need += item.width
        }
      }
    } else {
      const word = /^\S+/.exec(next.text)?.[0] ?? ''
      need = Array.from(word).reduce((sum, ch) => sum + glyphWidth(ch, 15 * scale), 0)
    }
    if (need <= room - 2) {
      found.push(`line ${index} "${line.text}" left ${room.toFixed(1)} dp for "${next.text.slice(0, 12)}" (${need.toFixed(1)} dp)`)
    }
  })
  return found
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
    expect(earlyLineEnds(lines, width)).toEqual([])
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

/** The key React holds each pill by; a changed key is a remount. */
function pillKeys(): string[] {
  return pills().map((pill) => String((pill.parent as unknown as { _fiber: { key: string | null } })._fiber.key))
}

function noSharedLines(lines: Line[]): void {
  for (const line of lines) {
    expect(line.text, 'two pieces of one span on one line').not.toContain('\uFFFC\uFFFC')
  }
}

// Review of 216a856f, 2026-09-27. On a rotation, split screen or pop-up view,
// Fabric lays the existing tree out at the new width and reports its lines
// (ParagraphShadowNode::layout) before the document's onLayout brings the new
// width to a render. Read against the old width, every line with a pill looked
// like it ran past the edge, the continuation width dropped from 360 to about
// 185, and that was kept for the old width, in memory too: back at 360 the
// pills were chopped ("UI/.claude/worktrees/" then "rotation-probe", two
// pieces on one line), and still after scrolling away and back.
describe('a change of window width', () => {
  // One line at 700 dp, ending on a word: its whole width reads as overflow.
  const ROTATE = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/rotation-probe` today.'

  function rotateTo(documentWidth: number): void {
    // One beat: the lines of the tree as drawn, broken to the new width, to
    // the handler of the last render; then the document's own onLayout.
    act(() => {
      const { text, event } = phoneLines(documentWidth)
      text.props.onTextLayout(event)
      layOutDocument(documentWidth)
    })
  }

  it('keeps the pills it had after turning the phone and back', () => {
    mount(ROTATE, 360)
    settleMounted(360)
    const portrait = pillTexts()
    rotateTo(700)
    settleMounted(700)
    rotateTo(360)
    const { lines } = settleMounted(360)
    expect(pillTexts()).toEqual(portrait)
    noSharedLines(lines)
  })

  it('draws a message scrolled away and back after a rotation with its pills whole', () => {
    // Its own document, one line at 700 dp too, so nothing is carried over.
    const content = ROTATE.replace('rotation-probe', 'remount-probe')
    mount(content, 360)
    settleMounted(360)
    const portrait = pillTexts()
    rotateTo(700)
    act(() => renderer?.unmount())
    renderer = null
    mount(content, 360)
    expect(pillTexts()).toEqual(portrait)
    const { lines } = settleMounted(360)
    expect(pillTexts()).toEqual(portrait)
    noSharedLines(lines)
  })
})

// Review of 216a856f: the chat list (FlashList 2.3.2, no per-item key in
// MobileNativeChatView) recycles a cell for another message. The cell's
// rooms were used for whatever it drew next at the same width, so the next
// message was first cut with the last one's rooms, not its own settled cut.
describe('a recycled list cell', () => {
  it("draws the next message with that message's own settled pills at once", () => {
    const next = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/recycled-next` for this one.'
    const previous =
      'The branch is at `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/recycled-previous-one` for that one.'
    mount(next, 360)
    settleMounted(360)
    const settled = pillTexts()
    act(() => renderer?.unmount())
    mount(previous, 360)
    settleMounted(360)
    act(() => renderer!.update(createElement(MobileMarkdown, { content: next })))
    expect(pillTexts()).toEqual(settled)
  })
})

describe('a system font size change', () => {
  it('does not reuse the pills learnt at the old size', () => {
    const content = 'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/font-size-probe` here.'
    mount(content, 360)
    settleMounted(360)
    act(() => renderer?.unmount())
    phone.fontScale = 1.3
    mount(content, 360)
    // Nothing learnt at this size: cut to a whole line, as on a first mount.
    expect(pillTexts()).toEqual(
      cutCodePills('/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/font-size-probe', 360, 360, {
        fontSize: 14,
        insets: 10
      }).pieces
    )
  })
})

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
    act(() => layOutDocument(360))
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

