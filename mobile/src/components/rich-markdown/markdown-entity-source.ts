import { decodeMarkdownEntities, escapeHtml } from './markdown-escaping'

/**
 * How the source wrote a run of text that holds an entity, on both halves of the round trip.
 *
 * The renderer draws `&lt;` as `<`, which is what the user should read, and the writer writes a
 * text node's characters, which have no way back to the entity. So 'Write &lt;div&gt; for a block'
 * saved as 'Write <div> for a block' (review, 2026-09-30): a raw HTML tag, which changes the
 * meaning and can make the words vanish wherever the file is rendered. A run of text that holds an
 * entity is drawn inside a `<span>` that carries its source (percent-encoded, so the markup holds
 * no second layer of entities), and a save writes the source back for every character still as it
 * was drawn. What the user typed into or beside it is written as typed, a `<` included, as it
 * always has been. A run with no entity in it is drawn as it always was.
 *
 * The precedent is AUTOLINK_ATTRIBUTE (markdown-inline-render.ts).
 */
export const ENTITY_SOURCE_ATTRIBUTE = 'data-md-source'

/** The entities decodeMarkdownEntities reads, found one by one. */
function entityPattern(): RegExp {
  return /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi
}

/**
 * Text as markup: escaped as always, and each line that holds an entity wrapped with its source.
 * By line, so a hard break's newline, which the paragraph renderer turns into a `<br />`, never
 * lands inside the run.
 */
export function entityTextHtml(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const drawn = escapeHtml(line)
      if (decodeMarkdownEntities(line) === line) {
        return drawn
      }
      try {
        return `<span ${ENTITY_SOURCE_ATTRIBUTE}="${encodeURIComponent(line)}">${drawn}</span>`
      } catch {
        // A lone surrogate cannot be percent-encoded. The run is drawn as it always was.
        return drawn
      }
    })
    .join('\n')
}

/** A run's source as pieces: each entity whole, every other character alone. */
function sourcePieces(source: string): { drawn: string; written: string }[] {
  const pieces: { drawn: string; written: string }[] = []
  const pattern = entityPattern()
  let last = 0
  let match = pattern.exec(source)
  while (match !== null) {
    for (const char of source.slice(last, match.index)) {
      pieces.push({ drawn: char, written: char })
    }
    pieces.push({ drawn: decodeMarkdownEntities(match[0]), written: match[0] })
    last = match.index + match[0].length
    match = pattern.exec(source)
  }
  for (const char of source.slice(last)) {
    pieces.push({ drawn: char, written: char })
  }
  return pieces
}

/** The source for the drawn characters `start` to `end`; a piece cut in two is written as drawn. */
function writtenRange(
  pieces: readonly { drawn: string; written: string }[],
  start: number,
  end: number
): string {
  let out = ''
  let offset = 0
  for (const piece of pieces) {
    const next = offset + piece.drawn.length
    if (offset >= start && next <= end) {
      out += piece.written
    } else if (next > start && offset < end) {
      out += piece.drawn.slice(Math.max(0, start - offset), Math.min(piece.drawn.length, end - offset))
    }
    offset = next
  }
  return out
}

function textNodesUnder(node: Node): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [node]
  }
  return Array.from(node.childNodes).flatMap(textNodesUnder)
}

/**
 * How to write each text node under a run the renderer drew from source that held an entity: the
 * source for the characters before and after whatever changed since it was drawn, and the rest as
 * it is now. Null when the run carries no source this can read, and it is written as it is.
 *
 * The change is found as the text the drawn run and the run now share at their start and at their
 * end, so typing inside or beside the run, deleting from it, or the engine splitting it in two
 * (Enter clones the element, attribute and all, into the new paragraph) keeps every entity it did
 * not touch. `normalize` is the writer's own reading of a text node, applied to both sides.
 */
export function entitySourceWriter(
  run: Element,
  normalize: (text: string) => string
): ((text: Node) => string) | null {
  let source: string
  try {
    source = decodeURIComponent(run.getAttribute(ENTITY_SOURCE_ATTRIBUTE) ?? '')
  } catch {
    return null
  }
  const pieces = sourcePieces(source)
  const drawn = normalize(pieces.map((piece) => piece.drawn).join(''))
  const nodes = textNodesUnder(run)
  const texts = nodes.map((node) => normalize(node.textContent ?? ''))
  const now = texts.join('')
  let prefix = 0
  const limit = Math.min(now.length, drawn.length)
  while (prefix < limit && now[prefix] === drawn[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (suffix < limit - prefix && now[now.length - 1 - suffix] === drawn[drawn.length - 1 - suffix]) {
    suffix += 1
  }
  const shift = drawn.length - now.length
  const writeRange = (start: number, end: number): string => {
    const head = Math.min(end, prefix)
    const tailStart = Math.max(start, now.length - suffix)
    return (
      (start < head ? writtenRange(pieces, start, head) : '') +
      now.slice(Math.max(start, prefix), Math.min(end, now.length - suffix)) +
      (tailStart < end ? writtenRange(pieces, tailStart + shift, end + shift) : '')
    )
  }
  const ranges = new Map<Node, [number, number]>()
  let offset = 0
  nodes.forEach((node, index) => {
    ranges.set(node, [offset, offset + texts[index]!.length])
    offset += texts[index]!.length
  })
  return (text) => {
    const range = ranges.get(text)
    return range === undefined ? normalize(text.textContent ?? '') : writeRange(range[0], range[1])
  }
}
