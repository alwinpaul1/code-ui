/**
 * The <details> and <blockquote> regions of a PR comment body, for
 * markdown-blocks.ts, which line-parses the text between them.
 *
 * A region closes at the closing tag that BALANCES its opener, counting
 * openers and closers of the same name. It closed at the first closing tag
 * of its name before, so in a bot's review comment a <details> inside a
 * <details> closed the outer one at the inner closer: the inner opener and
 * summary drew as a paragraph of raw tags, and everything after the inner
 * block fell out of the outer collapsible (review, 2026-09-30). A region
 * holds regions of its own, to MAX_NESTING deep.
 *
 * Total on unbalanced input, as the old non-greedy regex read it: an opener
 * no closer balances closes at the first closer of its name after it, and
 * one with no closer in its region is text.
 *
 * Linear: every tag is found in one pass, and paired in another, so a body
 * of thousands of openers reads in one go. The regex this replaces tried
 * each opener to the end of the text, and an opener that never closed cost
 * the square of their number. A fence is one placeholder line by the time
 * this reads the text (markdown-fences.ts), so a tag in one splits nothing.
 */

export type HtmlBlockPiece =
  | { kind: 'text'; text: string }
  /** `summary` is the first <summary> among the block's own children, as
   *  written, not one inside a nested block; null when it has none. */
  | { kind: 'details'; summary: string | null; body: HtmlBlockPiece[] }
  | { kind: 'quote'; text: string }

/** Deeper than this, a region's tags are left in its text. */
const MAX_NESTING = 16

type Tag = { at: number; end: number; name: string; closes: boolean }

const TAG = /<(\/?)(details|blockquote)\b/gi
const SUMMARY_OPENER = /<summary(?!\w)/gi
const SUMMARY_CLOSER = /<\/summary>/gi

/** Every opener and closer, in order. An opener ends at the first `>`
 *  after its name; a closer is exactly `</name>`. A tag inside another's
 *  text is not one. */
function scanTags(text: string): Tag[] {
  const tags: Tag[] = []
  const pattern = new RegExp(TAG.source, 'gi')
  let gt = -1
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const at = match.index
    const name = match[2]!.toLowerCase()
    if (match[1]) {
      if (text[at + 2 + name.length] === '>') {
        tags.push({ at, end: at + 3 + name.length, name, closes: true })
        pattern.lastIndex = at + 3 + name.length
      }
      continue
    }
    if (gt < pattern.lastIndex) {
      gt = text.indexOf('>', pattern.lastIndex)
    }
    // No `>` from here on: no opener or closer can end.
    if (gt === -1) {
      break
    }
    tags.push({ at, end: gt + 1, name, closes: false })
    pattern.lastIndex = gt + 1
  }
  return tags
}

type Doc = {
  text: string
  tags: Tag[]
  /** For an opener: the closer that balances it, or -1. */
  partner: Int32Array
  /** For any tag: the first closer of its name after it, or -1. */
  firstCloser: Int32Array
}

function readDoc(text: string): Doc {
  const tags = scanTags(text)
  const partner = new Int32Array(tags.length).fill(-1)
  const open = new Map<string, number[]>()
  tags.forEach((tag, index) => {
    const stack = open.get(tag.name) ?? []
    open.set(tag.name, stack)
    if (!tag.closes) {
      stack.push(index)
    } else if (stack.length > 0) {
      partner[stack.pop()!] = index
    }
  })
  const firstCloser = new Int32Array(tags.length).fill(-1)
  const next = new Map<string, number>()
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    firstCloser[index] = next.get(tags[index]!.name) ?? -1
    if (tags[index]!.closes) {
      next.set(tags[index]!.name, index)
    }
  }
  return { text, tags, partner, firstCloser }
}

/** The closer of the opener at `index` inside a region ending at `to`: the
 *  one that balances it, else the first of its name, else -1. */
function closerWithin(doc: Doc, index: number, to: number): number {
  if (doc.tags[index]!.closes) {
    return -1
  }
  for (const close of [doc.partner[index]!, doc.firstCloser[index]!]) {
    if (close !== -1 && doc.tags[close]!.end <= to) {
      return close
    }
  }
  return -1
}

/** The first <summary>…</summary> in `text`, as `/<summary\b[^>]*>([\s\S]*?)<\/summary>/i`
 *  reads it, and `text` without it. Only the first opener can match: a later
 *  one has no `>` or closer the first lacks. */
function takeSummary(text: string): { summary: string; rest: string } | null {
  const opener = new RegExp(SUMMARY_OPENER.source, 'gi').exec(text)
  const gt = opener ? text.indexOf('>', opener.index) : -1
  if (!opener || gt === -1) {
    return null
  }
  const closer = new RegExp(SUMMARY_CLOSER.source, 'gi')
  closer.lastIndex = gt + 1
  const close = closer.exec(text)
  if (!close) {
    return null
  }
  return {
    summary: text.slice(gt + 1, close.index),
    rest: text.slice(0, opener.index) + text.slice(close.index + close[0].length)
  }
}

function readBlock(doc: Doc, open: number, close: number, depth: number): HtmlBlockPiece {
  const from = doc.tags[open]!.end
  const to = doc.tags[close]!.at
  if (doc.tags[open]!.name === 'blockquote') {
    return { kind: 'quote', text: doc.text.slice(from, to) }
  }
  const body = readRegion(doc, from, to, open + 1, depth + 1)
  for (const [index, piece] of body.entries()) {
    const taken = piece.kind === 'text' ? takeSummary(piece.text) : null
    if (taken) {
      body[index] = { kind: 'text', text: taken.rest }
      return { kind: 'details', summary: taken.summary, body }
    }
  }
  return { kind: 'details', summary: null, body }
}

/** The pieces of `doc.text` from `from` to `to`, whose first tag is at `tag`
 *  or later. */
function readRegion(doc: Doc, from: number, to: number, tag: number, depth: number): HtmlBlockPiece[] {
  const pieces: HtmlBlockPiece[] = []
  let cursor = from
  let index = tag
  while (index < doc.tags.length && doc.tags[index]!.at < to) {
    const close = depth < MAX_NESTING ? closerWithin(doc, index, to) : -1
    if (close === -1) {
      index += 1
      continue
    }
    if (doc.tags[index]!.at > cursor) {
      pieces.push({ kind: 'text', text: doc.text.slice(cursor, doc.tags[index]!.at) })
    }
    pieces.push(readBlock(doc, index, close, depth))
    cursor = doc.tags[close]!.end
    index = close + 1
  }
  if (to > cursor) {
    pieces.push({ kind: 'text', text: doc.text.slice(cursor, to) })
  }
  return pieces
}

/** `text` as the runs of text between its <details> and <blockquote>
 *  regions, and those regions, in order. */
export function readHtmlBlocks(text: string): HtmlBlockPiece[] {
  return readRegion(readDoc(text), 0, text.length, 0, 0)
}
