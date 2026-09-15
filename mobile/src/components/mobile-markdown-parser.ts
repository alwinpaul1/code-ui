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

const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/
const FENCE_TERMINATOR = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/** How many backslashes a line ends with. Only an ODD run ends in an
 *  UNESCAPED one, and only an unescaped one is a hard break: `C:\\` at the end
 *  of a line is an escaped backslash followed by a soft break, which
 *  CommonMark renders as a space. */
function trailingBackslashes(line: string): number {
  let count = 0
  while (count < line.length && line[line.length - 1 - count] === '\\') {
    count += 1
  }
  return count
}

/** Fill prose to the phone's width: a soft newline becomes a space, and the two
 *  deliberate hard breaks (two trailing spaces, an unescaped trailing
 *  backslash) stay. Line by line rather than by regex, because telling an
 *  escaped backslash from an unescaped one means counting the run. */
function reflowProse(value: string): string {
  const lines = value.split('\n')
  let filled = ''
  for (let index = 0; index < lines.length; index += 1) {
    const line = index > 0 ? lines[index]!.replace(/^[ \t]+/, '') : lines[index]!
    if (index === lines.length - 1) {
      filled += line.replace(/[ \t]+$/, '')
      break
    }
    if (trailingBackslashes(line) % 2 === 1) {
      filled += `${line.slice(0, -1)}\n`
    } else if (/ {2,}$/.test(line)) {
      filled += `${line.replace(/[ \t]+$/, '')}\n`
    } else {
      filled += `${line.replace(/[ \t]+$/, '')} `
    }
  }
  return filled.trim()
}

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
        const text = token.raw.trim()
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

export function parseMobileMarkdown(content: string): MobileMarkdownBlock[] {
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
    return source.trim() ? [{ type: 'paragraph', text: source.replace(/\n+$/, '') }] : []
  }
  return toBlocks(tokens)
}
