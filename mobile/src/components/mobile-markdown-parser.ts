// Block structure comes from `marked`, the same Markdown parser Orca's desktop
// depends on (`marked ^17` in its package.json, used by the rich-text editor's
// tiptap-marked-facade.ts). The hand-rolled line loop this replaced kept
// producing real defects on the device: a hard-wrapped ordered list numbered
// every item "1." because the loop stopped at the first indented continuation
// line, and a bold span that crossed a wrapped line rendered as literal
// asterisks. A conforming parser fixes that whole class at once.
//
// What we take from marked is the BLOCK tree only. Inline spans are still
// rendered by MobileMarkdown.tsx's own matcher, which carries the phone's tuned
// behaviour (code chips, file-path detection, autolink punctuation trimming).
//
// `breaks: false` — a single newline inside a paragraph is a SPACE, per
// CommonMark, and only an explicit hard break forces a new line. Orca's desktop
// does the opposite: it adds remark-breaks on both of its surfaces
// (src/renderer/src/components/editor/MarkdownPreview.tsx line 340 for markdown
// FILES, src/renderer/src/components/sidebar/CommentMarkdown.tsx line 63 for
// chat), so every newline is a hard break there. That reads correctly in a wide
// window, where an 80-column source line fits one display line. At the ~40
// columns a phone has, the same document wraps every source line AND breaks
// after it, which is the ragged column the user reported. The phone reflows.
import { marked, type Token, type Tokens } from 'marked'

export type MobileMarkdownListItem = {
  text: string
  checked?: boolean
  /** 0 at the top level; one more for each level of nesting. */
  depth: number
  /** The marker style of the list this item belongs to, not of the outermost one. */
  ordered: boolean
  /** 1-based position inside its own list, honouring `3.` as a start. */
  number?: number
}

export type MobileMarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string; language?: string; closed: boolean }
  | { type: 'list'; ordered: boolean; items: MobileMarkdownListItem[] }
  | { type: 'image'; alt: string; url: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' }

const MARKED_OPTIONS = { gfm: true, breaks: false } as const

// Reflow, in two passes rather than one: the source is split at the hard
// breaks first, so collapsing the soft newlines inside each piece cannot touch
// them. Doing it with a sentinel character instead would put a literal NUL in
// this file, which git then reads as binary.
const HARD_BREAK_SOURCE = /(?:[ \t]{2,}|\\)\n[ \t]*/
const SOFT_BREAK_SOURCE = /[ \t]*\n[ \t]*/g
const FENCE_OPENER = /^ {0,3}(?:`{3,}|~{3,})/
const FENCE_TERMINATOR = /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/

/** Fill prose to the phone's width: soft newlines become spaces, and the two
 *  deliberate hard breaks (two trailing spaces, a trailing backslash) stay. */
function reflowProse(value: string): string {
  return value
    .split(HARD_BREAK_SOURCE)
    .map((line) => line.replace(SOFT_BREAK_SOURCE, ' '))
    .join('\n')
    .trim()
}

/** The info string's first word: ```` ```ts title="x" ```` is a TypeScript fence,
 *  the same reading rehype-highlight gives it on the desktop. */
function infoLanguage(lang: string | undefined): string | undefined {
  const first = (lang ?? '').trim().split(/\s+/)[0]
  return first || undefined
}

/** Unterminated fences are still streaming in, and MobileMarkdown holds a
 *  mermaid diagram back until its fence closes rather than reloading the
 *  WebView on every tick. marked does not report it, so read the raw source:
 *  a closed fence ends on its terminator line. */
function isFenceClosed(raw: string): boolean {
  const lines = raw.replace(/\n+$/, '').split('\n')
  if (!FENCE_OPENER.test(lines[0] ?? '')) {
    // An indented code block has no terminator to wait for.
    return true
  }
  return lines.length > 1 && FENCE_TERMINATOR.test(lines.at(-1) ?? '')
}

/** A paragraph holding nothing but one web image is the image block the
 *  renderer frames on its own; anything else stays prose. */
function standaloneImage(token: Tokens.Paragraph): MobileMarkdownBlock | null {
  const content = token.tokens.filter(
    (child) => !(child.type === 'text' && !child.raw.trim()) && child.type !== 'space'
  )
  const only = content[0]
  if (content.length !== 1 || !only || only.type !== 'image') {
    return null
  }
  const image = only as Tokens.Image
  if (!/^https?:\/\//i.test(image.href)) {
    return null
  }
  return { type: 'image', alt: image.text ?? '', url: image.href }
}

/** Blockquote contents render inside one quoted Text. Prose reflows; anything
 *  else keeps the source it came from, so nothing is dropped. */
function quotedText(token: Tokens.Blockquote): string {
  return token.tokens
    .map((child) =>
      child.type === 'paragraph'
        ? reflowProse((child as Tokens.Paragraph).text)
        : child.raw.replace(/\n+$/, '')
    )
    .filter((part) => part.trim())
    .join('\n\n')
}

/** Nested lists are flattened to one run of items carrying their depth: the
 *  renderer indents by it, which is how a sub-list stays readable at 40
 *  columns without nesting a View per level. */
function flattenList(token: Tokens.List, depth: number, into: MobileMarkdownListItem[]): void {
  const start = typeof token.start === 'number' ? token.start : 1
  token.items.forEach((item, index) => {
    const own: string[] = []
    const nested: Tokens.List[] = []
    for (const child of item.tokens) {
      if (child.type === 'list') {
        nested.push(child as Tokens.List)
      } else if (child.type === 'text' || child.type === 'paragraph') {
        own.push(reflowProse((child as Tokens.Text).text))
      } else if (child.type !== 'space' && child.type !== 'checkbox') {
        // `checkbox` is dropped because `item.checked` already carries it and
        // the renderer draws the box; everything else left here — a fence, a
        // table inside an item — keeps its source rather than being lost.
        own.push(child.raw.replace(/\n+$/, ''))
      }
    }
    into.push({
      text: own.filter(Boolean).join('\n'),
      checked: typeof item.checked === 'boolean' ? item.checked : undefined,
      depth,
      ordered: token.ordered,
      number: token.ordered ? start + index : undefined
    })
    for (const child of nested) {
      flattenList(child, depth + 1, into)
    }
  })
}

function toBlocks(tokens: Token[]): MobileMarkdownBlock[] {
  const blocks: MobileMarkdownBlock[] = []
  for (const token of tokens) {
    switch (token.type) {
      // `space` is blank lines. `def` is a link reference definition
      // (`[d]: https://…`), which is metadata rather than content and which
      // react-markdown hides on the desktop too — the line loop this replaced
      // leaked it onto the screen as literal text. The inline matcher does not
      // resolve `[text][d]` yet, so on a document written that way the URL is
      // now nowhere; resolving reference links belongs with moving the inline
      // pass onto marked as well.
      case 'space':
      case 'def':
        break
      case 'heading':
        blocks.push({
          type: 'heading',
          level: (token as Tokens.Heading).depth,
          text: reflowProse((token as Tokens.Heading).text)
        })
        break
      case 'code': {
        const code = token as Tokens.Code
        blocks.push({
          type: 'code',
          text: code.text,
          language: infoLanguage(code.lang),
          closed: isFenceClosed(code.raw)
        })
        break
      }
      case 'blockquote':
        blocks.push({ type: 'quote', text: quotedText(token as Tokens.Blockquote) })
        break
      case 'list': {
        const list = token as Tokens.List
        const items: MobileMarkdownListItem[] = []
        flattenList(list, 0, items)
        blocks.push({ type: 'list', ordered: list.ordered, items })
        break
      }
      case 'table': {
        const table = token as Tokens.Table
        blocks.push({
          type: 'table',
          headers: table.header.map((cell) => cell.text),
          rows: table.rows.map((row) => row.map((cell) => cell.text))
        })
        break
      }
      case 'hr':
        blocks.push({ type: 'rule' })
        break
      case 'paragraph': {
        const paragraph = token as Tokens.Paragraph
        blocks.push(standaloneImage(paragraph) ?? { type: 'paragraph', text: reflowProse(paragraph.text) })
        break
      }
      default:
        // Every other token (html, text, and anything a future marked adds)
        // keeps its source verbatim. No exhaustive `never` check here on
        // purpose: marked's Token union covers inline kinds a block lex never
        // returns, and an unknown kind must still reach the screen rather than
        // fail the build or vanish.
        if (token.raw.trim()) {
          blocks.push({ type: 'paragraph', text: token.raw.replace(/\n+$/, '') })
        }
        break
    }
  }
  return blocks
}

/** Two shapes marked cannot take at scale, both far past anything a document
 *  contains. Pairing emphasis delimiters costs time quadratic in the run's
 *  length (6.4k stacked `*` = 155 ms, 12.8k = 507 ms on marked 18.0.12), past
 *  the deadline the progress suite holds this parser to; nested blockquotes
 *  cost a stack frame each and blow the stack somewhere past 3.4k, at a depth
 *  that moves with whatever stack the runtime happens to have left. Refuse
 *  both rather than guess: the source comes back verbatim and nothing is lost. */
const RUNAWAY_NESTING = /\*{1000,}|_{1000,}|^ {0,3}(?:>[ \t]?){200,}/m

export function parseMobileMarkdown(content: string): MobileMarkdownBlock[] {
  const source = content.replace(/\r\n?/g, '\n')
  let tokens: Token[]
  try {
    if (RUNAWAY_NESTING.test(source)) {
      throw new RangeError('nesting past what the parser can take in time')
    }
    tokens = marked.lexer(source, MARKED_OPTIONS)
  } catch {
    // marked descends one stack frame per level of nesting and throws a
    // RangeError past roughly 3.4k nested blockquotes, and the guard above
    // rejects an emphasis run long enough to miss the deadline. Nothing may
    // vanish from the screen because of either, so hand the source back as
    // prose, with its lines intact.
    return source.trim() ? [{ type: 'paragraph', text: source.replace(/\n+$/, '') }] : []
  }
  return toBlocks(tokens)
}
