import type { ReactTestInstance } from 'react-test-renderer'
import { spToDp } from './android-font-scale.test-support'
import { flatStyle, flattenForPhone, layOut, type PhoneAs } from './mobile-markdown-code-pill-phone.test-support'

/**
 * Where RN 0.86 Android draws each code pill against the words on its line,
 * for the pill row tests. A model, not a capture, and a vertical one: the
 * phone model (mobile-markdown-code-pill-phone.test-support.ts) breaks the
 * lines, and this stacks them.
 *
 * Two layouts of one Text, which Android keeps apart:
 * - The one the words are DRAWN from: the TextView's own, built from a copy
 *   of the spannable (TextView.setText), whose spans are in the order
 *   SpannableStringBuilder.getSpans(Object) returns them, by priority and
 *   then by insertion.
 * - The one a pill is PLACED from: TextLayoutManager.measureText's
 *   StaticLayout over the builder itself, which puts the pill's top at its
 *   line's baseline less the placeholder's height (nextAttachmentMetrics).
 *   StaticLayout reads a paragraph's LineHeightSpans through
 *   getParagraphSpans, which for a builder is getSpans(..., false): spans by
 *   priority, and the ones with none in the order they START.
 *
 * Every span has a priority, SPAN_MAX_PRIORITY (255) less its place from the
 * end of the ops (TextLayoutManager.createSpannableFromAttributedString),
 * clamped to 0 (SetSpanOperation.kt). A Text with more than 255 ops behind a
 * span (about 50 fragments) gives it none. Android applies every
 * LineHeightSpan of a paragraph to each of its lines in that order
 * (StaticLayout.out), and CustomLineHeightSpan re-centres the line on the
 * last one's height. A paragraph whose spans carry two line heights, as a
 * heading's did with the newline after it (the separator's, the prose line
 * height), is laid out at the heading's height when drawn and at the prose's
 * where its pills are placed, deep in a long Text: every heading line above
 * a pill moved it up by the difference (2026-09-28, HANDOVER.md).
 *
 * Line boxes: a line's ascent and descent are its type's (Instrument Sans 970
 * and 250 per 1000, JetBrains Mono 1020 and 300; hhea of the bundled TTFs),
 * an inline view's placeholder as ascent with no descent
 * (TextInlineViewPlaceholderSpan), the largest of each over the line; the
 * line height is shared out around them (CustomLineHeightSpan). In dp,
 * unrounded: whole pixels move all of this by under one.
 *
 * Left out: StaticLayout carrying a line's metrics into the next line of the
 * same span range, which moves a baseline alike in both layouts.
 */

const INSTRUMENT = { ascent: 0.97, descent: 0.25 }
const MONO = { ascent: 1.02, descent: 0.3 }
/** Ops RN makes per text fragment (colour, size, face, line height, tag),
 *  the line height fourth; an inline view makes one. */
const TEXT_FRAGMENT_OPS = 5
const LINE_HEIGHT_OP = 3
const SPAN_MAX_PRIORITY = 255

type Face = { size: number; lineHeight: number; mono: boolean }
type Cell =
  | { kind: 'char'; ch: string; face: Face; fragment: number }
  | { kind: 'pill'; pill: PillShape; fragment: number }

/** A pill as RN lays it out, in dp at the system font size. */
export type PillShape = {
  text: string
  /** Its frame's height: the placeholder is this through toPixelFromSP. */
  frame: number
  placeholder: number
  /** Every translateY on the way down to the bordered box. */
  shift: number
  /** The bordered box, from the frame's top: in flow, so at 0. */
  boxHeight: number
  /** The pill's own baseline, from the box's top. */
  baseline: number
  /** Its text size, in dp. */
  textSize: number
}

export type RowLine = {
  text: string
  top: number
  height: number
  /** Baseline from the line's top. */
  above: number
  /** The largest ascent of the words on it, in dp; 0 for none. */
  wordsAscent: number
  /** The largest type size of the words on it, in sp and in dp. */
  wordsSize: number
  wordsSizeDp: number
  /** Where its baseline would be with no pill on it: a line of its words,
   *  or of its paragraph's type when it holds nothing but pills. */
  plainAbove: number
}

export type PillRow = {
  pill: PillShape
  line: number
  lineText: string
  /** How far the pill's text sits above the words' baseline, in dp. */
  rise: number
  /** The pill's bordered box and its line's box, as drawn, in dp. */
  box: { top: number; bottom: number }
  lineBox: { top: number; bottom: number }
}

function pillShape(outer: ReactTestInstance, dp: (sp: number) => number): PillShape {
  const views = [outer, ...outer.findAll((node) => node !== outer && node.type === ('View' as never))]
  const bordered = views.find((view) => flatStyle(view.props.style).borderWidth !== undefined) ?? outer
  const border = flatStyle(bordered.props.style)
  const label = outer.findByType('Text' as never)
  const own = flatStyle(label.props.style)
  const textSize = dp(Number(own.fontSize))
  const line = dp(Number(own.lineHeight))
  const b = Number(border.borderWidth ?? 0)
  const pad = Number(border.paddingVertical ?? 0)
  const boxHeight = line + 2 * (b + pad)
  const shift = views.reduce((sum, view) => {
    const transform = flatStyle(view.props.style).transform as { translateY?: number }[] | undefined
    return sum + (transform ?? []).reduce((each, entry) => each + (entry.translateY ?? 0), 0)
  }, 0)
  const height = flatStyle(outer.props.style).height
  const frame = typeof height === 'number' ? height : boxHeight
  return {
    text: label.children.join(''),
    frame,
    // TextLayoutManager.kt: PixelUtil.toPixelFromSP(the frame's height).
    placeholder: dp(frame),
    shift,
    boxHeight,
    baseline: b + pad + INSTRUMENT.ascent * textSize + (line - (INSTRUMENT.ascent + INSTRUMENT.descent) * textSize) / 2,
    textSize
  }
}

function cells(node: ReactTestInstance, face: Face, dp: (sp: number) => number, out: Cell[], counter: { next: number }): Cell[] {
  const own = flatStyle(node.props.style)
  const here: Face = {
    size: Number(own.fontSize ?? face.size),
    lineHeight: Number(own.lineHeight ?? face.lineHeight),
    mono: typeof own.fontFamily === 'string' ? own.fontFamily.includes('Mono') : face.mono
  }
  for (const child of node.children) {
    if (typeof child === 'string') {
      const fragment = counter.next++
      for (const ch of Array.from(child)) {
        out.push({ kind: 'char', ch, face: here, fragment })
      }
    } else if (child.type === ('View' as never)) {
      out.push({ kind: 'pill', pill: pillShape(child, dp), fragment: counter.next++ })
    } else {
      cells(child, here, dp, out, counter)
    }
  }
  return out
}

/** The line height a paragraph is laid out at, drawn and placed. */
function paragraphLineHeights(paragraph: readonly Cell[], priorityOf: (fragment: number) => number) {
  const fragments: { fragment: number; lineHeight: number; priority: number }[] = []
  for (const cell of paragraph) {
    if (cell.kind === 'char' && fragments.at(-1)?.fragment !== cell.fragment) {
      fragments.push({ fragment: cell.fragment, lineHeight: cell.face.lineHeight, priority: priorityOf(cell.fragment) })
    }
  }
  const lowest = Math.min(...fragments.map((entry) => entry.priority))
  // Drawn: by priority, then by insertion, and the ops were run last first,
  // so of the lowest priority the earliest fragment is applied last.
  const drawn = fragments.find((entry) => entry.priority === lowest)!
  // Placed: prioritised spans first, then the ones with none by where they
  // start, so the latest of those is applied last; with none unprioritised,
  // the earliest of the lowest.
  const unprioritised = fragments.filter((entry) => entry.priority === 0)
  const placed = unprioritised.length > 0 ? unprioritised.at(-1)! : drawn
  return { drawn: drawn.lineHeight, placed: placed.lineHeight }
}

/**
 * Every pill in `text` (the outermost Text holding pills), where it is
 * drawn against the words of its line, at `documentWidth` and the system
 * font size in `as` (`api` 34 or later draws sp on Android 14's curve).
 */
export function pillRows(text: ReactTestInstance, lineWidth: number, as: PhoneAs & { api?: number } = {}) {
  const system = as.fontScale ?? 1
  const curve = (as.api ?? 34) >= 34
  const dp = (sp: number) => spToDp(sp, system, curve)
  const root = flatStyle(text.props.style)
  const all = cells(
    text,
    { size: Number(root.fontSize), lineHeight: Number(root.lineHeight), mono: false },
    dp,
    [],
    { next: 0 }
  )
  const broken = layOut(flattenForPhone(text, Number(root.fontSize), as, []), lineWidth)

  // Each fragment's ops, in order, and its line height span's priority.
  const opsBefore: number[] = []
  let ops = 0
  let lastFragment = -1
  for (const cell of all) {
    if (cell.fragment !== lastFragment) {
      opsBefore[cell.fragment] = ops
      ops += cell.kind === 'pill' ? 1 : TEXT_FRAGMENT_OPS
      lastFragment = cell.fragment
    }
  }
  const priorityOf = (fragment: number) =>
    Math.max(0, SPAN_MAX_PRIORITY - (ops - 1 - (opsBefore[fragment]! + LINE_HEIGHT_OP)))

  // The lines, each with its cells, and each Android paragraph's two heights.
  let at = 0
  const lineCells = broken.map((line) => {
    const mine = all.slice(at, at + line.items.length)
    at += line.items.length
    return mine
  })
  const heights: { drawn: number; placed: number }[] = []
  const faces: Face[] = []
  let paragraphStart = 0
  lineCells.forEach((mine, index) => {
    const last = mine.at(-1)
    if (index === lineCells.length - 1 || (last?.kind === 'char' && last.ch === '\n')) {
      const paragraph = lineCells.slice(paragraphStart, index + 1)
      const resolved = paragraphLineHeights(paragraph.flat(), priorityOf)
      // The paragraph's words, past a list marker's mono.
      const chars = paragraph.flat().filter((cell) => cell.kind === 'char')
      const face = chars.find((cell) => !cell.face.mono && cell.ch.trim() !== '') ?? chars[0]
      for (let line = paragraphStart; line <= index; line += 1) {
        heights[line] = resolved
        faces[line] = face?.kind === 'char' ? face.face : { size: Number(root.fontSize), lineHeight: Number(root.lineHeight), mono: false }
      }
      paragraphStart = index + 1
    }
  })

  const stack = (which: 'drawn' | 'placed'): RowLine[] => {
    let top = 0
    return lineCells.map((mine, index) => {
      let ascent = 0
      let descent = 0
      let wordsAscent = 0
      let wordsDescent = 0
      let wordsSize = 0
      let wordsSizeDp = 0
      for (const cell of mine) {
        if (cell.kind === 'pill') {
          ascent = Math.max(ascent, cell.pill.placeholder)
        } else {
          const metrics = cell.face.mono ? MONO : INSTRUMENT
          const size = dp(cell.face.size)
          ascent = Math.max(ascent, metrics.ascent * size)
          descent = Math.max(descent, metrics.descent * size)
          wordsAscent = Math.max(wordsAscent, metrics.ascent * size)
          wordsDescent = Math.max(wordsDescent, metrics.descent * size)
          if (!cell.face.mono && cell.ch.trim() !== '') {
            wordsSize = Math.max(wordsSize, cell.face.size)
            wordsSizeDp = Math.max(wordsSizeDp, size)
          }
        }
      }
      const height = dp(heights[index]![which])
      let [plainAscent, plainDescent] = [wordsAscent, wordsDescent]
      if (wordsAscent === 0) {
        const face = faces[index]!
        const metrics = face.mono ? MONO : INSTRUMENT
        plainAscent = metrics.ascent * dp(face.size)
        plainDescent = metrics.descent * dp(face.size)
      }
      const line: RowLine = {
        text: broken[index]!.text,
        top,
        height,
        above: ascent + (height - ascent - descent) / 2,
        wordsAscent,
        wordsSize,
        wordsSizeDp,
        plainAbove: plainAscent + (height - plainAscent - plainDescent) / 2
      }
      top += height
      return line
    })
  }
  const drawn = stack('drawn')
  const placed = stack('placed')
  const pills: PillRow[] = []
  lineCells.forEach((mine, index) => {
    for (const cell of mine) {
      if (cell.kind !== 'pill') {
        continue
      }
      const baseline = placed[index]!.top + placed[index]!.above
      const boxTop = baseline - cell.pill.placeholder + cell.pill.shift
      const words = drawn[index]!.top + drawn[index]!.above
      pills.push({
        pill: cell.pill,
        line: index,
        lineText: drawn[index]!.text,
        rise: words - (boxTop + cell.pill.baseline),
        box: { top: boxTop, bottom: boxTop + cell.pill.boxHeight },
        lineBox: { top: drawn[index]!.top, bottom: drawn[index]!.top + drawn[index]!.height }
      })
    }
  })
  return { pills, drawn, placed }
}
