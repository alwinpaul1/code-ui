import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { placeholderWidth, type Placeholder } from './android-font-scale.test-support'
import { INSTRUMENT_SANS_ASCII_ADVANCE, INSTRUMENT_SANS_OTHER_ADVANCE } from './instrument-sans-regular-advances'

/**
 * A model of the phone for code pill tests. There is no layout engine under
 * vitest, so this stands in for Android's, and it is a model, not a capture:
 *
 * - Widths: Instrument Sans Regular advances (hmtx of the bundled TTF), an em
 *   for a wide character from a fallback font; a pill as its text times
 *   `pillError` (how much wider the phone draws it than the app estimates),
 *   plus kerning when given, plus its padding and border. At a system font
 *   size (`fontScale`) all type is that much wider, prose and pill text
 *   alike, and padding and border are not (Android scales sp, not dp).
 * - Lines: greedy breaking (`textBreakStrategy="simple"`) after spaces and
 *   around an inline view (U+FFFC, class CB), no break before closing
 *   punctuation, as FontMetricsUtil.kt reports them (RN 0.86): `width` is
 *   getLineWidth, trailing spaces included, except on a line that ends in a
 *   newline, where it is getLineMax, without them or the newline.
 * - Events, as Fabric sends them: a Text is laid out, and reports its lines,
 *   only when its host tree or its width changed (a new function for
 *   `onTextLayout` is not a change: ReactNativeAttributePayload), and
 *   ParagraphEventEmitter does not send a Text the lines it sent it last.
 *   Lines are measured, sent and kept for that dedup only while the Text has
 *   `onTextLayout` (ParagraphShadowNode.cpp). The lines go to the handler the
 *   Text holds at that moment.
 */

export type PhoneAs = {
  pillError?: number
  textScale?: number
  /** The system font size (Settings > Display > Font size). */
  fontScale?: number
  /** Kerning per pair of characters inside a pill, per 1000 em. */
  kern?: Readonly<Record<string, number>>
  /** RN 0.86 TextLayoutManager.kt: an inline view's placeholder is its frame
   *  converted with toPixelFromSP, so the system font size scales the room
   *  it takes on its line again: linearly up to Android 13, through
   *  FontScaleConverterFactory's curve from Android 14 (from 100 dp on,
   *  not at all). The view itself is drawn at its frame. */
  placeholder?: Placeholder
}


type Style = Record<string, unknown>
export type ModelItem = { kind: 'char'; ch: string; width: number } | { kind: 'pill'; text: string; width: number }
export type ModelLine = { x: number; y: number; width: number; height: number; text: string; items: ModelItem[]; ink: number }

export function flatStyle(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flatStyle))
  }
  return style && typeof style === 'object' ? (style as Style) : {}
}

export function glyphWidth(ch: string, fontSize: number, family = ''): number {
  // JetBrains Mono is 600 units a glyph (hmtx of the bundled TTF).
  if (family.includes('Mono')) {
    return (600 * fontSize) / 1000
  }
  const code = ch.codePointAt(0) ?? 0
  const units =
    code >= 0x20 && code <= 0x7e
      ? INSTRUMENT_SANS_ASCII_ADVANCE[code - 0x20]!
      : (INSTRUMENT_SANS_OTHER_ADVANCE[code] ?? (code >= 0x1100 ? 1000 : 600))
  return (units * fontSize) / 1000
}

/** The nearest host ancestor; the pill component sits between a pill's View
 *  and the Text it is drawn in. */
export function hostParent(node: ReactTestInstance): ReactTestInstance | null {
  let parent = node.parent
  while (parent && typeof parent.type !== 'string') {
    parent = parent.parent
  }
  return parent
}

function fiberOf(node: ReactTestInstance): { key: string | null; stateNode: unknown } {
  return (node as unknown as { _fiber: { key: string | null; stateNode: unknown } })._fiber
}

/** The phone's view of one Text: characters at their span's size, and each
 *  inline View as one placeholder as wide as the pill it draws. */
export function flattenForPhone(node: ReactTestInstance, fontSize: number, as: PhoneAs, out: ModelItem[]): ModelItem[] {
  const size = Number(flatStyle(node.props.style).fontSize ?? fontSize)
  const system = as.fontScale ?? 1
  for (const child of node.children) {
    if (typeof child === 'string') {
      for (const ch of Array.from(child)) {
        out.push({ kind: 'char', ch, width: glyphWidth(ch, size) * system })
      }
    } else if (child.type === ('View' as never)) {
      // The bordered box may sit inside the View the Text holds.
      const bordered = [child, ...child.findAll((node) => node !== child && node.type === ('View' as never))].find(
        (view) => flatStyle(view.props.style).borderWidth !== undefined
      )
      const box = flatStyle((bordered ?? child).props.style)
      const label = child.findByType('Text' as never)
      const text = label.children.join('')
      const labelStyle = flatStyle(label.props.style)
      const labelSize = Number(labelStyle.fontSize)
      const inset = 2 * (Number(box.paddingHorizontal ?? 0) + Number(box.borderWidth ?? 0))
      const chars = Array.from(text)
      const kern = as.kern ? chars.reduce((sum, ch, i) => sum + (i > 0 ? (as.kern![chars[i - 1]! + ch] ?? 0) : 0), 0) : 0
      const glyphs =
        chars.reduce((sum, ch) => sum + glyphWidth(ch, labelSize, String(labelStyle.fontFamily ?? '')), 0) +
        (kern * labelSize) / 1000
      out.push({ kind: 'pill', text, width: placeholderWidth(glyphs * (as.pillError ?? 1) * system + inset, as.placeholder) })
    } else {
      flattenForPhone(child, size, as, out)
    }
  }
  return out
}

const isSpace = (item: ModelItem) => item.kind === 'char' && item.ch === ' '
const isTrailing = (item: ModelItem) => item.kind === 'char' && (item.ch === ' ' || item.ch === '\n')

/** Greedy lines, as Android's `simple` break strategy lays them out. */
export function layOut(items: ModelItem[], lineWidth: number): ModelLine[] {
  // Words: a run that cannot break inside, then its trailing spaces.
  const words: ModelItem[][] = []
  let word: ModelItem[] = []
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
    if (
      prev &&
      ((isSpace(prev) && !isSpace(item)) ||
        (prev.kind === 'pill' && !isSpace(item) && !gluedPunctuation) ||
        (item.kind === 'pill' && !isSpace(prev)))
    ) {
      flush()
    }
    word.push(item)
  }
  flush()

  const lines: ModelLine[] = []
  let current: ModelItem[] = []
  const widthOf = (list: ModelItem[]) => list.reduce((sum, item) => sum + item.width, 0)
  const inkOf = (list: ModelItem[]) => {
    let end = list.length
    while (end > 0 && isTrailing(list[end - 1]!)) {
      end -= 1
    }
    return widthOf(list.slice(0, end))
  }
  const push = (endsWithNewline: boolean) => {
    const text = current.map((item) => (item.kind === 'pill' ? '￼' : item.ch)).join('')
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

/** A Text's host tree as Fabric sees it: types, keys, text, and the props
 *  that lay it out. A change here is a new layout; a new function is not. */
function hostTree(node: ReactTestInstance): unknown {
  const props = typeof node.type === 'string' ? node.props : {}
  return [
    typeof node.type === 'string' ? node.type : 'composite',
    fiberOf(node).key,
    JSON.stringify(flatStyle(props.style)),
    props.textBreakStrategy ?? null,
    typeof props.onTextLayout === 'function',
    node.children.map((child) => (typeof child === 'string' ? child : hostTree(child)))
  ]
}

export type Phone = ReturnType<typeof createPhone>

export function createPhone(current: () => ReactTestRenderer) {
  /** What each mounted Text was last laid out as, and the lines it was sent. */
  const laidOut = new WeakMap<object, { tree: string; sent: string }>()

  const pills = () =>
    current().root.findAll((node) => node.type === ('View' as never) && hostParent(node)?.type === ('Text' as never))
  const pillTexts = () => pills().map((pill) => pill.findByType('Text' as never).children.join(''))
  const pillKeys = () => pills().map((pill) => String(fiberOf(pill.parent!).key))

  /** The prose Text the pills are drawn in: the outermost Text holding one. */
  const measuredText = () => {
    let text = hostParent(pills()[0]!)!
    for (let up = hostParent(text); up?.type === ('Text' as never); up = hostParent(up)) {
      text = up
    }
    return text
  }

  /** The width a Text's lines are broken to: the document's, less a quote's
   *  bar and indent, or a table cell's own width less its padding and border. */
  const textWidth = (text: ReactTestInstance, documentWidth: number) => {
    const own = flatStyle(text.props.style)
    if (typeof own.width === 'number') {
      return own.width - 2 * Number(own.paddingHorizontal ?? 0) - Number(own.borderRightWidth ?? 0)
    }
    const box = hostParent(text)
    const quote = box ? flatStyle(box.props.style) : {}
    return documentWidth - Number(quote.borderLeftWidth ?? 0) - Number(quote.paddingLeft ?? 0)
  }

  /** The lines the phone would lay the tree out in, broken to `documentWidth`. */
  const lines = (documentWidth: number, as: PhoneAs = {}) => {
    const text = measuredText()
    const lineWidth = textWidth(text, documentWidth)
    const laid = layOut(flattenForPhone(text, 15 * (as.textScale ?? 1), as, []), lineWidth)
    const event = { nativeEvent: { lines: laid.map(({ items: _items, ink: _ink, ...line }) => line) } }
    return { text, lines: laid, lineWidth, event }
  }

  /** The document's own onLayout, as Fabric sends it after a layout. */
  const layOutDocument = (documentWidth: number) => {
    const root = current().root.findAll((node) => typeof node.props.onLayout === 'function')[0]!
    root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: documentWidth, height: 400 } } })
  }

  /** One layout pass, as Fabric would run it now: the Text reports its lines
   *  only if its tree or width changed and they differ from what it was
   *  last sent. Returns whether it reported. Not wrapped in act. */
  const passNow = (documentWidth: number, as: PhoneAs = {}): boolean => {
    const { text, event } = lines(documentWidth, as)
    const mounted = fiberOf(text).stateNode as object
    const tree = JSON.stringify([documentWidth, as.textScale ?? 1, as.fontScale ?? 1, as.placeholder ?? null, hostTree(text)])
    const sent = JSON.stringify(event.nativeEvent.lines)
    const last = laidOut.get(mounted)
    if (last?.tree === tree) {
      return false
    }
    if (typeof text.props.onTextLayout !== 'function') {
      laidOut.set(mounted, { tree, sent: last?.sent ?? '' })
      return false
    }
    laidOut.set(mounted, { tree, sent })
    if (last?.sent === sent) {
      return false
    }
    text.props.onTextLayout(event)
    return true
  }

  const pass = (documentWidth: number, as: PhoneAs = {}): boolean => {
    let reported = false
    act(() => {
      reported = passNow(documentWidth, as)
    })
    return reported
  }

  /** Lay out until the Text has nothing new to report. */
  const settle = (documentWidth: number, as: PhoneAs = {}) => {
    for (let round = 0; round < 20; round += 1) {
      if (!pass(documentWidth, as)) {
        const { lines: settled, lineWidth } = lines(documentWidth, as)
        return { lines: settled, lineWidth, rounds: round }
      }
    }
    throw new Error('the pills never settled')
  }

  /** A rotation, split screen or pop-up view: Fabric lays the tree as drawn
   *  out at the new width and reports it to the handler the Text holds, and
   *  the document's onLayout comes after, in the same beat. */
  const rotateTo = (documentWidth: number, as: PhoneAs = {}) => {
    act(() => {
      passNow(documentWidth, as)
      layOutDocument(documentWidth)
    })
  }

  /**
   * How wide RN Android makes a Text that is as wide as its content, up to
   * `max` (a prompt bubble): TextLayoutManager.createLayout (RN 0.86) lays it
   * out AT_MOST, at min(desiredWidth, floor(max)), where desiredWidth is its
   * widest paragraph on one line, rounded up (Layout.getDesiredWidth), and
   * reports layout.width. So a Text that wraps is always as wide as the max,
   * and one that does not is as wide as its one line.
   */
  const atMost = (max: number, as: PhoneAs = {}): number => {
    const { lines: unwrapped } = lines(100_000, as)
    return Math.min(Math.ceil(Math.max(...unwrapped.map((line) => line.width))), Math.floor(max))
  }

  /** A bubble at `max` settling. Each pass Fabric lays the Text out at the
   *  width its content gives it now (atMost), reports those lines to the
   *  handler the Text holds, and the document's onLayout brings that width,
   *  until nothing changes. Returns the widths it went through, and the one
   *  it held, or -1 when it never holds. */
  const settleBubble = (max: number, as: PhoneAs = {}): { width: number; widths: number[] } => {
    const widths: number[] = []
    for (let step = 0; step < 30; step += 1) {
      const width = atMost(max, as)
      if (widths.at(-1) !== width) {
        widths.push(width)
      }
      let reported = false
      act(() => {
        reported = passNow(width, as)
        layOutDocument(width)
      })
      if (!reported && atMost(max, as) === width) {
        return { width, widths }
      }
    }
    return { width: -1, widths }
  }

  return { pills, pillTexts, pillKeys, measuredText, lines, layOutDocument, pass, settle, rotateTo, atMost, settleBubble }
}

/** Nothing on the next line could have fitted at the end of this one. For a
 *  pill that means its first unbreakable piece (up to a slash or a space),
 *  and the punctuation glued after it when that is the whole pill. */
export function earlyLineEnds(
  lines: ModelLine[],
  lineWidth: number,
  scale = 1,
  pillError = 1,
  fontScale = 1,
  placeholder?: Placeholder
): string[] {
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
      need = placeholderWidth(
        Array.from(unit.trimEnd()).reduce((sum, ch) => sum + glyphWidth(ch, 14 * scale), 0) * pillError * fontScale +
          10 * scale,
        placeholder
      )
      if (unit.length === head.text.length) {
        for (const item of next.items.slice(1)) {
          if (item.kind !== 'char' || item.ch === ' ') {
            break
          }
          need += item.width
        }
      }
    } else {
      const word = /^\S+/.exec(next.text)?.[0] ?? ''
      need = Array.from(word).reduce((sum, ch) => sum + glyphWidth(ch, 15 * scale), 0) * fontScale
    }
    if (need <= room - 2) {
      found.push(`line ${index} "${line.text}" left ${room.toFixed(1)} dp for "${next.text.slice(0, 12)}" (${need.toFixed(1)} dp)`)
    }
  })
  return found
}

export function sharedLines(lines: ModelLine[]): string[] {
  return lines.filter((line) => line.text.includes('￼￼')).map((line) => line.text)
}

export function overflowingLines(lines: ModelLine[], lineWidth: number): string[] {
  return lines.filter((line) => line.ink > lineWidth + 0.5).map((line) => `${line.text} ink ${line.ink.toFixed(1)}`)
}
