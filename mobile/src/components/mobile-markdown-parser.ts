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
// Except inside a quote, where every newline is a break as on the desktop and
// in the Claude app (breakProse, decided 2026-10-10).
import { marked, type Token, type Tokens } from 'marked'
import { quoteBlocks } from './mobile-markdown-quote-blocks'
import { inlineBreaksAsNewlines } from './markdown-inline-breaks'
import { breakProse, reflowProse } from './mobile-markdown-prose-fill'

export type MobileMarkdownListItem = {
  text: string
  checked?: boolean
  /** 0 at the top level; one more for each level of nesting. */
  depth: number
  /** The marker style of the list this item belongs to, not of the outermost one. */
  ordered: boolean
  /** 1-based position inside its own list, honouring `3.` as a start. */
  number?: number
  /** The rest of an item that was interrupted by a block of its own — the prose
   *  after a fenced command, say. It draws at the item's indent with NO marker,
   *  because a second bullet would claim it is a second item. */
  continuation?: boolean
}

export type MobileMarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | {
      type: 'quote'
      /** What the quote holds, drawn inside its bar as Markdown of its own
       *  (mobile-markdown-quote-blocks.ts). */
      members: MobileMarkdownQuoteMember[]
      /** The rest of the quote the block above is part of, after a fence in
       *  it: its bar joins that one's (mobile-markdown-quote-blocks.ts). */
      continuesQuote?: boolean
    }
  | {
      type: 'code'
      text: string
      language?: string
      closed: boolean
      /** Came out of a quote, so it is drawn inside the quote's bar. */
      quoted?: boolean
      /** As on a quote block: its bar joins the one above it. */
      continuesQuote?: boolean
    }
  | { type: 'list'; ordered: boolean; items: MobileMarkdownListItem[] }
  | { type: 'image'; alt: string; url: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' }

/** A block inside a quote's bar: prose the way it is drawn outside one, or a
 *  quote inside this one, with a bar of its own. A fence comes out of the
 *  quote as a code block between its parts instead. */
export type MobileMarkdownQuoteMember =
  | Extract<MobileMarkdownBlock, { type: 'paragraph' | 'heading' | 'list' | 'rule' }>
  | { type: 'quote'; members: MobileMarkdownQuoteMember[] }

const MARKED_OPTIONS = { gfm: true, breaks: false } as const

const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/
const FENCE_TERMINATOR = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/** The info string's first word: ```` ```ts title="x" ```` is a TypeScript fence,
 *  the same reading rehype-highlight gives it on the desktop. */
function infoLanguage(lang: string | undefined): string | undefined {
  const first = (lang ?? '').trim().split(/\s+/)[0]
  return first || undefined
}

/** Unterminated fences are still streaming in, and MobileMarkdown holds a
 *  mermaid diagram back until its fence closes rather than reloading the
 *  WebView on every tick. marked does not report it, so read the raw source.
 *  A terminator only counts if it uses the OPENER'S character and is at least
 *  as long, per CommonMark — three backticks do not close ````mermaid, and no
 *  number of backticks closes a ~~~ fence. Reading "looks like a fence" alone
 *  mounted the WebView mid-stream. */
function isFenceClosed(raw: string): boolean {
  const lines = raw.replace(/\n+$/, '').split('\n')
  const opener = FENCE_OPENER.exec(lines[0] ?? '')
  if (!opener) {
    // An indented code block has no terminator to wait for.
    return true
  }
  if (lines.length < 2) {
    return false
  }
  const terminator = FENCE_TERMINATOR.exec(lines.at(-1) ?? '')
  const marker = opener[1]!
  return Boolean(
    terminator && terminator[1]![0] === marker[0] && terminator[1]!.length >= marker.length
  )
}

/** A paragraph holding nothing but one image is the image block the renderer
 *  draws on its own; anything else stays prose. Any href, not only the web:
 *  a document's `![fig](fig/plot.svg)` names a file beside it, which the
 *  renderer can now read off the host (2026-09-19). Where it cannot, the
 *  block is drawn as the link it always was. */
function standaloneImage(token: Tokens.Paragraph): MobileMarkdownBlock | null {
  const content = token.tokens.filter(
    (child) => !(child.type === 'text' && !child.raw.trim()) && child.type !== 'space'
  )
  const only = content[0]
  if (content.length !== 1 || !only || only.type !== 'image') {
    return null
  }
  const image = only as Tokens.Image
  if (!image.href.trim()) {
    return null
  }
  // A kept `<br>` (markBlockLineBreaks) is a line break here too, never its stand-in.
  return { type: 'image', alt: inlineBreaksAsNewlines(image.text ?? ''), url: inlineBreaksAsNewlines(image.href) }
}

/** Nested lists are flattened to one run of items carrying their depth: the
 *  renderer indents by it, which is how a sub-list stays readable at 40
 *  columns without nesting a View per level. */
/**
 * A list, as a run of blocks rather than a single one.
 *
 * A fence inside a list item is the commonest thing an agent writes — a
 * numbered step with the command for it underneath. Keeping it in the item's
 * TEXT (what this did first) handed raw source to the inline matcher, which drew
 * it as one code chip with stray backticks: no code styling, no horizontal
 * scroller, no mermaid, newlines collapsed. A block child has to come out.
 *
 * So the item buffer flushes as a list block, the child is converted by the same
 * `toBlocks` every other block goes through, and the list resumes after it.
 * Numbers survive because each item carries its own; indent survives because
 * each carries its own depth.
 */
function flattenList(
  token: Tokens.List,
  depth: number,
  items: MobileMarkdownListItem[],
  out: MobileMarkdownBlock[],
  ordered: boolean,
  reflow: (text: string) => string
): void {
  const start = typeof token.start === 'number' ? token.start : 1
  const flush = (): void => {
    if (items.length > 0) {
      out.push({ type: 'list', ordered, items: [...items] })
      items.length = 0
    }
  }
  token.items.forEach((item, index) => {
    const own: string[] = []
    let drawn = false
    // Emit whatever prose has accumulated as an item, so a block child can be
    // flushed out from between this item and the rest of it.
    const emit = (): void => {
      const text = own.filter(Boolean).join('\n')
      own.length = 0
      // No bullet for an item that has no words of its own: an item that is
      // nothing but a fence is the fence, not an empty row above it.
      if (!text) {
        return
      }
      items.push({
        text,
        checked: drawn ? undefined : typeof item.checked === 'boolean' ? item.checked : undefined,
        depth,
        ordered: token.ordered,
        number: !drawn && token.ordered ? start + index : undefined,
        continuation: drawn ? true : undefined
      })
      drawn = true
    }
    for (const child of item.tokens) {
      if (child.type === 'list') {
        emit()
        flattenList(child as Tokens.List, depth + 1, items, out, ordered, reflow)
      } else if (child.type === 'text' || child.type === 'paragraph') {
        own.push(reflow((child as Tokens.Text).text))
      } else if (child.type !== 'space' && child.type !== 'checkbox') {
        // `checkbox` is dropped because `item.checked` already carries it and
        // the renderer draws the box. Everything else is a block in its own
        // right: a fence, a table, a quote inside an item.
        emit()
        flush()
        out.push(...toBlocks([child], reflow))
      }
    }
    emit()
  })
  // Only the outermost call closes the run. A nested list returns with its
  // items still in the shared buffer, because the parent list continues after
  // it — flushing here split a list in two at every sub-list (caught by
  // mobile-markdown-wrapped-source.test.ts, which pins exactly that shape).
  if (depth === 0) {
    flush()
  }
}

/** `reflow` fills a paragraph's soft newlines: reflowProse at the top, and
 *  breakProse for what sits in a quote. */
function toBlocks(tokens: Token[], reflow: (text: string) => string = reflowProse): MobileMarkdownBlock[] {
  const blocks: MobileMarkdownBlock[] = []
  // True while the previous token was also a link reference definition, so a
  // block of them lands in one paragraph instead of one paragraph each.
  let definitionRun = false
  for (const token of tokens) {
    const continuesDefinitions = definitionRun
    definitionRun = false
    switch (token.type) {
      case 'space':
        break
      case 'def': {
        // A link reference definition (`[d]: https://…`). The desktop hides it,
        // and hiding it here is what this parser did at first — but the inline
        // matcher cannot resolve `[text][d]`, so the label rendered as literal
        // brackets and the URL was then nowhere at all, and a message that was
        // ONLY definitions rendered as an empty View. Until reference links
        // resolve inline, the definition stays on screen, where its URL is at
        // least autolinked. Consecutive definitions share one paragraph rather
        // than getting a blank line each.
        const text = inlineBreaksAsNewlines(token.raw.trim())
        const previous = blocks.at(-1)
        if (continuesDefinitions && previous?.type === 'paragraph') {
          previous.text = `${previous.text}\n${text}`
        } else if (text) {
          blocks.push({ type: 'paragraph', text })
        }
        definitionRun = true
        continue
      }
      case 'heading':
        blocks.push({
          type: 'heading',
          level: (token as Tokens.Heading).depth,
          text: reflow((token as Tokens.Heading).text)
        })
        break
      case 'code': {
        const code = token as Tokens.Code
        blocks.push({
          type: 'code',
          // A fence the HTML pass missed (one in a quote in a list item) can
          // hold a `<br>` it kept: a line break, as it drew one before.
          text: inlineBreaksAsNewlines(code.text),
          language: infoLanguage(code.lang),
          closed: isFenceClosed(code.raw)
        })
        break
      }
      case 'blockquote':
        // A quote can come back as several blocks: a fence inside it is drawn
        // as code between them rather than inside the quote's members.
        blocks.push(...quoteBlocks(token as Tokens.Blockquote, breakProse, (inner) => toBlocks(inner, breakProse)))
        break
      case 'list': {
        const list = token as Tokens.List
        // A list can come back as several blocks: any fence or table inside an
        // item is drawn between them rather than swallowed by it.
        flattenList(list, 0, [], blocks, list.ordered, reflow)
        break
      }
      case 'table': {
        const table = token as Tokens.Table
        blocks.push({
          type: 'table',
          // A `<br>` in a cell is a line break inside it (markdown-inline-breaks.ts).
          headers: table.header.map((cell) => inlineBreaksAsNewlines(cell.text)),
          rows: table.rows.map((row) => row.map((cell) => inlineBreaksAsNewlines(cell.text)))
        })
        break
      }
      case 'hr':
        blocks.push({ type: 'rule' })
        break
      case 'paragraph': {
        const paragraph = token as Tokens.Paragraph
        blocks.push(standaloneImage(paragraph) ?? { type: 'paragraph', text: reflow(paragraph.text) })
        break
      }
      default:
        // Every other token (html, text, and anything a future marked adds)
        // keeps its source verbatim. No exhaustive `never` check here on
        // purpose: marked's Token union covers inline kinds a block lex never
        // returns, and an unknown kind must still reach the screen rather than
        // fail the build or vanish.
        if (token.raw.trim()) {
          blocks.push({ type: 'paragraph', text: inlineBreaksAsNewlines(token.raw.replace(/\n+$/, '')) })
        }
        break
    }
  }
  return blocks
}

/** Three shapes marked cannot take at scale, all far past anything a document
 *  contains. Pairing emphasis delimiters costs time quadratic in the run's
 *  length (6.4k stacked `*` = 155 ms, 12.8k = 507 ms on marked 18.0.12), past
 *  the deadline the progress suite holds this parser to. Nested blockquotes
 *  cost a stack frame each and blow the stack somewhere past 3.4k, at a depth
 *  that moves with whatever stack the runtime happens to have left. And a
 *  nested LIST is the third recursion: 400 levels took 148 ms, 1000 took
 *  1.6 s, and 2000 exhausted the heap — a fatal OOM, which no try/catch can
 *  catch, so it has to be refused before marked sees it. 200 leading spaces is
 *  100 levels of the usual two-space step. Refuse rather than guess: the
 *  source comes back verbatim and nothing is lost. */
const RUNAWAY_NESTING = /\*{1000,}|_{1000,}|^ {0,3}(?:>[ \t]?){200,}|^[ \t]{200,}\S/m

/** The guard must not fire on what is INSIDE a fence. A progress bar, a banner
 *  or a graph dump in a code block is content, not nesting, and refusing the
 *  whole document over one such line flattened everything around it — heading,
 *  fence and all — into a single paragraph. */
function outsideFences(source: string): string {
  const kept: string[] = []
  let open: { marker: string } | null = null
  for (const line of source.split('\n')) {
    if (open) {
      const terminator = FENCE_TERMINATOR.exec(line)
      if (
        terminator &&
        terminator[1]![0] === open.marker[0] &&
        terminator[1]!.length >= open.marker.length
      ) {
        open = null
      }
      continue
    }
    const opener = FENCE_OPENER.exec(line)
    if (opener) {
      open = { marker: opener[1]! }
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}

/** How many parsed messages are held. A screenful of chat is a handful of rows;
 *  this is sized for the run either side of it that a flick passes over, and it
 *  is a cap on COUNT, so one enormous message can still hold a lot of blocks. */
export const MOBILE_MARKDOWN_PARSE_CACHE_CAP = 48

const parsedBySource = new Map<string, MobileMarkdownBlock[]>()

/**
 * What the parser returns is CACHED BY SOURCE TEXT, and the returned array must
 * be treated as read-only.
 *
 * `MobileMarkdown` memoizes its own parse per text, which covers a re-render.
 * It does not cover a re-MOUNT, and FlashList recycles rows: a message scrolled
 * off and back on parses again from nothing. The hand-rolled loop this replaced
 * cost 0.03 ms a message, so nobody had to care. marked costs ~2 ms for a
 * document the size of this repository's CLAUDE.md on a Mac, several times that
 * on the phone, and a flick mounts several rows per frame — on a screen the
 * user has already called slow (2026-09-15).
 *
 * Eviction renews on READ, not only on write. A plain FIFO drops whatever has
 * been in longest, which on a chat is the message being read right now; the
 * sticky HUD hold had exactly this defect the same day.
 */
export function parseMobileMarkdown(content: string): MobileMarkdownBlock[] {
  const cached = parsedBySource.get(content)
  if (cached) {
    parsedBySource.delete(content)
    parsedBySource.set(content, cached)
    return cached
  }
  const blocks = readMobileMarkdown(content)
  if (content) {
    if (parsedBySource.size >= MOBILE_MARKDOWN_PARSE_CACHE_CAP) {
      // Map iterates in insertion order, so the first key is the least recently
      // read. A streamed reply is a fresh miss every tick and would otherwise
      // keep every intermediate draft of the session alive.
      const oldest = parsedBySource.keys().next()
      if (!oldest.done) {
        parsedBySource.delete(oldest.value)
      }
    }
    parsedBySource.set(content, blocks)
  }
  return blocks
}

function readMobileMarkdown(content: string): MobileMarkdownBlock[] {
  const source = content.replace(/\r\n?/g, '\n')
  let tokens: Token[]
  try {
    // The cheap whole-source test rejects almost every document in one pass;
    // only a hit pays for the fence-aware second look.
    if (RUNAWAY_NESTING.test(source) && RUNAWAY_NESTING.test(outsideFences(source))) {
      throw new RangeError('nesting past what the parser can take in time')
    }
    tokens = marked.lexer(source, MARKED_OPTIONS)
  } catch {
    // marked descends one stack frame per level of nesting and throws a
    // RangeError past roughly 3.4k nested blockquotes, and the guard above
    // rejects an emphasis run long enough to miss the deadline. Nothing may
    // vanish from the screen because of either, so hand the source back as
    // prose, with its lines intact.
    return source.trim() ? [{ type: 'paragraph', text: inlineBreaksAsNewlines(source.replace(/\n+$/, '')) }] : []
  }
  return toBlocks(tokens)
}
