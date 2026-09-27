import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'

/** More guides than this on one line are noise, and each one is a view. */
export const CODE_VIEW_MAX_INDENT_GUIDES = 24

/** Leading whitespace of a line, in columns, with a tab reaching the next tab
 *  stop; -1 for a blank line. Read with charCodeAt: a string iterator is a
 *  call per character on Hermes. */
function indentOf(line: string, tabWidth: number): number {
  let column = 0
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index)
    if (code === 32) {
      column += 1
    } else if (code === 9) {
      column += tabWidth - (column % tabWidth)
    } else {
      return column
    }
  }
  return -1
}

/** Leading whitespace of a line, in columns, with a tab reaching the next tab
 *  stop. Null for a blank line: it has no indentation of its own, and borrows
 *  one from its neighbours in `indentGuideCounts`. */
export function leadingIndentColumns(line: string, tabWidth: number): number | null {
  const indent = indentOf(line, tabWidth)
  return indent < 0 ? null : indent
}

/**
 * Every line's indent, -1 for a blank line, read once per document and
 * shared by the indent step, the guides and the folds. Each of them walked
 * every line itself, three passes with a string iterator: 170 ms of a
 * 3.9 MB file's build on Hermes (review, 2026-09-27).
 */
export function lineIndents(lines: readonly string[], tabWidth: number): Int32Array {
  const indents = new Int32Array(lines.length)
  for (let index = 0; index < lines.length; index += 1) {
    indents[index] = indentOf(lines[index]!, tabWidth)
  }
  return indents
}

/** The file's own indent step. Tab-indented files step by the tab width;
 *  otherwise the most common increase from one indented line to the next,
 *  between 2 and 8 columns (a hanging indent under a bracket is a larger jump
 *  and is ignored). The tab width when there is no evidence, as Monaco does. */
export function detectIndentStep(
  lines: readonly string[],
  tabWidth: number,
  indents: Int32Array = lineIndents(lines, tabWidth)
): number {
  let tabbed = 0
  let spaced = 0
  const increases = new Map<number, number>()
  let previous = 0
  for (let index = 0; index < lines.length; index += 1) {
    const indent = indents[index]!
    if (indent < 0) {
      continue
    }
    const first = lines[index]!.charCodeAt(0)
    if (first === 9) {
      tabbed += 1
    } else if (first === 32) {
      spaced += 1
    }
    const delta = indent - previous
    if (delta >= 2 && delta <= 8) {
      increases.set(delta, (increases.get(delta) ?? 0) + 1)
    }
    previous = indent
  }
  if (tabbed > spaced || increases.size === 0) {
    return tabWidth
  }
  let best = tabWidth
  let bestCount = increases.get(tabWidth) ?? 0
  for (const [step, count] of increases) {
    if (count > bestCount || (count === bestCount && step < best && best !== tabWidth)) {
      best = step
      bestCount = count
    }
  }
  return best
}

/**
 * How many indent guides each line shows, one per level at columns 0, step,
 * 2×step… — Monaco's rule, so the phone draws the guides the desktop does.
 *
 * A blank line borrows from the lines around it: inside a block it keeps the
 * block's guides; between a block and a dedent it takes the dedent's level in
 * an off-side language (Python, YAML: the block ended), and one level more in
 * a brace language (the closing brace below still belongs to the block).
 */
export function indentGuideCounts(
  lines: readonly string[],
  options: { tabWidth: number; indentStep: number; offSide: boolean; indents?: Int32Array }
): number[] {
  const { tabWidth, indentStep, offSide } = options
  const indents = options.indents ?? lineIndents(lines, tabWidth)
  const count = lines.length
  const above = new Int32Array(count)
  let last = -1
  for (let index = 0; index < count; index += 1) {
    above[index] = last
    if (indents[index]! >= 0) {
      last = indents[index]!
    }
  }
  // Filled first: Hermes stores an empty array of n slots written from its
  // end slowly, 7.8 s for 100,000 lines against 4 ms filled.
  const counts = Array.from<number>({ length: count }).fill(0)
  let below = -1
  for (let index = count - 1; index >= 0; index -= 1) {
    const indent = indents[index]!
    const guides =
      indent >= 0 ? Math.ceil(indent / indentStep) : blankLineGuides(above[index]!, below, indentStep, offSide)
    if (indent >= 0) {
      below = indent
    }
    counts[index] = Math.min(guides, CODE_VIEW_MAX_INDENT_GUIDES)
  }
  return counts
}

function blankLineGuides(above: number, below: number, step: number, offSide: boolean): number {
  if (above === -1 || below === -1) {
    return 0
  }
  if (above < below) {
    return 1 + Math.floor(above / step)
  }
  if (above === below || offSide) {
    return Math.ceil(below / step)
  }
  return 1 + Math.floor(below / step)
}

/** Characters that draw as a colour emoji with no selector after them.
 *  Most sit at U+1F300 and up, but ✅ ❌ ⭐ ⚡ ⏳ are below it, and they
 *  drew two cells wide on a grid that counted one. Hermes knows the property
 *  (hermesc 250829098.0.17 compiles it and rejects a property it does not
 *  know). Every such code point lies in U+231A–2B55 or U+1F000–1FAFF; the
 *  regex is run once over those, into a table, not at every character (a
 *  1.1 MB `├──` tree took 284 ms on Hermes testing each one). */
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u
const EMOJI_RANGES: readonly (readonly [number, number])[] = [
  [0x231a, 0x2b55],
  [0x1f000, 0x1f2ff]
]
let emojiTable: Set<number> | null = null

function isEmojiPresentation(codePoint: number): boolean {
  if (!emojiTable) {
    emojiTable = new Set()
    for (const [from, to] of EMOJI_RANGES) {
      for (let point = from; point <= to; point += 1) {
        if (EMOJI_PRESENTATION.test(String.fromCodePoint(point))) {
          emojiTable.add(point)
        }
      }
    }
  }
  return emojiTable.has(codePoint)
}

/** Columns a character takes on a monospace grid: two for East Asian wide
 *  and fullwidth characters and emoji, one otherwise. */
export function codePointColumns(codePoint: number): 1 | 2 {
  if (codePoint < 0x231a) {
    return codePoint >= 0x1100 && codePoint <= 0x115f ? 2 : 1
  }
  if (codePoint <= 0x2b55) {
    return isEmojiPresentation(codePoint) ? 2 : 1
  }
  if (codePoint >= 0x1f000 && codePoint <= 0x1f2ff) {
    return isEmojiPresentation(codePoint) ? 2 : 1
  }
  return (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    ? 2
    : 1
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/

/** Width of a line on the grid, tabs expanded. */
export function displayColumns(text: string, tabWidth: number): number {
  if (PRINTABLE_ASCII.test(text)) {
    return text.length
  }
  let column = 0
  for (const char of text) {
    column += char === '\t' ? tabWidth - (column % tabWidth) : codePointColumns(char.codePointAt(0)!)
  }
  return column
}

/** Tabs drawn as spaces up to the next tab stop. React Native draws a tab at
 *  its own width, which would put a tab-indented line off the guides. The
 *  column carries across a line's spans. */
export function expandTabsInSegments(
  segments: readonly MobileSyntaxSegment[],
  tabWidth: number
): MobileSyntaxSegment[] {
  if (!segments.some((segment) => segment.text.includes('\t'))) {
    return segments as MobileSyntaxSegment[]
  }
  let column = 0
  return segments.map((segment) => {
    const parts: string[] = []
    for (const char of segment.text) {
      if (char === '\t') {
        const width = tabWidth - (column % tabWidth)
        parts.push(' '.repeat(width))
        column += width
      } else {
        parts.push(char)
        column += codePointColumns(char.codePointAt(0)!)
      }
    }
    return { ...segment, text: parts.join('') }
  })
}

/** A line cut at `maxColumns`, with a note saying how much is left, for an
 *  unwrapped view that would otherwise be as wide as a minified file. The
 *  same segments back when the line fits. */
export function clipSegmentsToColumns(
  segments: readonly MobileSyntaxSegment[],
  maxColumns: number
): MobileSyntaxSegment[] {
  const kept: MobileSyntaxSegment[] = []
  let column = 0
  let hidden = 0
  for (const segment of segments) {
    if (hidden > 0 || column >= maxColumns) {
      hidden += [...segment.text].length
      continue
    }
    const chars = [...segment.text]
    let take = 0
    while (take < chars.length && column + codePointColumns(chars[take]!.codePointAt(0)!) <= maxColumns) {
      column += codePointColumns(chars[take]!.codePointAt(0)!)
      take += 1
    }
    kept.push(take === chars.length ? segment : { ...segment, text: chars.slice(0, take).join('') })
    hidden += chars.length - take
  }
  if (hidden === 0) {
    return segments as MobileSyntaxSegment[]
  }
  kept.push({ text: cutLineNote(hidden), kind: 'comment' })
  return kept
}

/** What follows a cut line: how many characters were left out. The view's
 *  width is sized for the longest of these a file can need
 *  (codeViewMetrics), so the count itself is never cut. */
export function cutLineNote(hidden: number): string {
  return `  … ${hidden} more ${hidden === 1 ? 'character' : 'characters'}`
}
