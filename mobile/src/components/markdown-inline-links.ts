/**
 * Where the `[words](address)` links and `![alt](src)` images in a run of
 * inline Markdown start and end, for markdown-inline-matcher.ts.
 *
 * An address ends at the `)` that balances it, as in CommonMark:
 * `[w](https://en.wikipedia.org/wiki/Foo_(bar))` opens the whole address. It
 * ended at the first `)` before, which opened a 404 and drew `)` after the
 * words (review, 2026-09-30). A label ends at its first `]`, except that in a
 * chat reply a whole image inside it is passed over, so a README badge,
 * `[![CI](badge.svg)](repo)`, is one link to the repo with the image as its
 * words. It was a link to the badge image labelled `![CI`, with `](` and the
 * repo's address drawn after it (same review).
 *
 * Both ends are read off two tables built in one pass from the end of the
 * text, so each opener costs one lookup and a reply of 60,000 `[` stays
 * linear: scanning forward for each opener's `)` or `]` is quadratic.
 */

export type MarkdownLinkSpan = {
  /** The `[`, or the `!` before an image's. */
  index: number
  /** Just past the `)`. */
  end: number
  image: boolean
  /** The `]` that ends the words. */
  labelEnd: number
}

type LinkTables = {
  /** For words starting at an index: the `]` that ends them, or -1. */
  labelEnd: Int32Array
  /** For an address starting at an index: its closing `)`, or -1. */
  destinationEnd: Int32Array
}

const OPEN_PAREN = 40
const CLOSE_PAREN = 41
const BANG = 33
const OPEN_BRACKET = 91
const CLOSE_BRACKET = 93

/** Just past the `)` of the link whose `[` is at `open`, or -1 when it is
 *  not one: words that end, a `(` right after them, an address that is not
 *  empty. Only an image may have no words. */
function linkEnd(tables: LinkTables, source: string, open: number, image: boolean): number {
  const labelEnd = tables.labelEnd[open + 1]!
  if (labelEnd === -1 || source.charCodeAt(labelEnd + 1) !== OPEN_PAREN || (!image && labelEnd === open + 1)) {
    return -1
  }
  const destinationEnd = tables.destinationEnd[labelEnd + 2]!
  return destinationEnd > labelEnd + 2 ? destinationEnd + 1 : -1
}

/**
 * Walking back from the end, `depth` is how many more `)` than `(` the text
 * from here on holds. An address starting here ends where that count first
 * drops below its value here, and `nearest` holds the first index each value
 * is seen at, so that is one lookup.
 */
function buildTables(source: string, labelsHoldImages: boolean): LinkTables {
  const length = source.length
  const labelEnd = new Int32Array(length + 1)
  const destinationEnd = new Int32Array(length + 1)
  // Every depth from -length to length, and one below it, offset to be an index.
  const offset = length + 1
  const nearest = new Int32Array(2 * length + 3).fill(-1)
  labelEnd[length] = -1
  destinationEnd[length] = -1
  let depth = 0
  nearest[offset] = length
  const tables = { labelEnd, destinationEnd }
  for (let index = length - 1; index >= 0; index -= 1) {
    const code = source.charCodeAt(index)
    if (code === CLOSE_PAREN) {
      depth += 1
    } else if (code === OPEN_PAREN) {
      depth -= 1
    }
    const drop = nearest[depth - 1 + offset]!
    destinationEnd[index] = drop === -1 ? -1 : drop - 1
    nearest[depth + offset] = index
    if (code === CLOSE_BRACKET) {
      labelEnd[index] = index
    } else if (labelsHoldImages && code === BANG && source.charCodeAt(index + 1) === OPEN_BRACKET) {
      // Everything this reads lies after `index`, so it is already filled in.
      const image = linkEnd(tables, source, index + 1, true)
      labelEnd[index] = image === -1 ? labelEnd[index + 1]! : labelEnd[image]!
    } else {
      labelEnd[index] = labelEnd[index + 1]!
    }
  }
  return tables
}

/**
 * The first link or image at or after `from`, each call's `from` past the
 * last one found. An image's `!` must be at or after `from` too.
 */
export function createMarkdownLinkFinder(
  source: string,
  /** A chat reply's reading: `![alt](src)` is an image, and a label may hold one. */
  images: boolean
): (from: number) => MarkdownLinkSpan | null {
  // Built on the first call that could find a link; null when none can.
  let tables: LinkTables | null | undefined
  return (from) => {
    if (tables === undefined) {
      tables = source.includes('](') ? buildTables(source, images) : null
    }
    if (tables === null) {
      return null
    }
    for (let open = source.indexOf('[', from); open !== -1; open = source.indexOf('[', open + 1)) {
      const image = images && open > from && source.charCodeAt(open - 1) === BANG
      const end = linkEnd(tables, source, open, image)
      if (end !== -1) {
        return { index: image ? open - 1 : open, end, image, labelEnd: tables.labelEnd[open + 1]! }
      }
    }
    return null
  }
}
