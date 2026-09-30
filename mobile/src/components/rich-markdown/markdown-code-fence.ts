import { escapeAttr, escapeHtml, escapeLiteralAttr } from './markdown-escaping'

/**
 * The run that opens and closes a fenced code block, on both halves of the round trip.
 *
 * A fence of a fixed three backticks cannot hold code that contains three backticks: the inner run
 * ends the block and the rest of it becomes paragraphs. The width is a property of the content, so
 * the writer measures it and the reader carries whatever it was opened with.
 *
 * CommonMark's fences, as the desktop and the chat read them: three or more backticks or tildes, up
 * to three columns in, then an info string whose first word is the language. A backtick fence's
 * info string holds no backtick; a tilde fence's may. Until 2026-09-30 the editor opened only
 * backticks followed by one word, so `ts title="a b.ts"`, `json {1,3}` and every `~~~` fence
 * were paragraphs, and a save reflowed the code inside them.
 */

/** The attribute that keeps a fence's whole info string, where it says more than its language. */
export const CODE_INFO_ATTRIBUTE = 'data-md-info'
/** The attribute that keeps a fence the writer would not choose: tildes, or a longer run. */
export const CODE_FENCE_ATTRIBUTE = 'data-md-fence'
/**
 * The attribute that keeps how many columns in a fence was written: from the margin, or from the
 * line of the list item that holds it.
 */
export const CODE_INDENT_ATTRIBUTE = 'data-md-indent'
/** The attribute that keeps the blank line a list item's fence was written after. */
export const CODE_BLANK_ATTRIBUTE = 'data-md-blank'

export type OpeningFence = {
  /** The run itself: three or more backticks, or three or more tildes. */
  fence: string
  /** Everything after the run, as written: a space before it is kept, trailing space is not. */
  info: string
  /** The info string's first word, which the block is labelled with. */
  language: string
  /** The columns before the run, 0 to 3. */
  indent: number
}

/** Longer than the longest backtick run inside, and never under three. */
export function codeFenceFor(code: string): string {
  const longest = (code.match(/`+/g) ?? []).reduce((run, match) => Math.max(run, match.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The fence a line opens a block with, or null when it opens none. */
export function openingFence(line: string): OpeningFence | null {
  const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/)
  if (!match) {
    return null
  }
  const fence = match[2]!
  const info = match[3]!.trimEnd()
  if (fence.startsWith('`') && info.includes('`')) {
    return null
  }
  return { fence, info, language: info.trim().split(/\s/)[0] ?? '', indent: match[1]!.length }
}

/** Only a bare run of the opening character, at least as long, up to three columns in, closes. */
export function closesFence(line: string, fence: string): boolean {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)
  return match !== null && match[1]![0] === fence[0] && match[1]!.length >= fence.length
}

/** A code line with up to `columns` of the fence's own indent taken off, as CommonMark does. */
export function outdentCodeLine(line: string, columns: number): string {
  let cut = 0
  while (cut < columns && line[cut] === ' ') {
    cut += 1
  }
  return line.slice(cut)
}

/**
 * Where a fence sits that the writer would not put it by itself: `columns` in from its container
 * (the margin, or a list item's line), and a blank line before it inside a list item.
 */
export type FencePlacement = { columns: number | null; blankBefore: boolean }

/**
 * A fenced block as markup, with how it was written kept on the `<pre>` where the writer would
 * write it differently: the whole info string, the run, the indent. An ordinary fence carries none
 * of them, so its markup is what it always was.
 */
export function fencedCodeHtml(
  fence: OpeningFence,
  code: string,
  placement: FencePlacement = { columns: fence.indent > 0 ? fence.indent : null, blankBefore: false }
): string {
  const attrs = [`data-language="${escapeAttr(fence.language)}"`]
  if (fence.info !== fence.language || escapeAttr(fence.info) !== escapeLiteralAttr(fence.info)) {
    attrs.push(`${CODE_INFO_ATTRIBUTE}="${escapeLiteralAttr(fence.info)}"`)
  }
  if (fence.fence !== codeFenceFor(code)) {
    attrs.push(`${CODE_FENCE_ATTRIBUTE}="${fence.fence}"`)
  }
  if (placement.columns !== null) {
    attrs.push(`${CODE_INDENT_ATTRIBUTE}="${placement.columns}"`)
  }
  if (placement.blankBefore) {
    attrs.push(`${CODE_BLANK_ATTRIBUTE}="true"`)
  }
  return `<pre ${attrs.join(' ')}><code>${escapeHtml(code)}</code></pre>`
}

/**
 * The fence to write around `code`: the one the source used while no line of the code would close
 * it, and otherwise one long enough. Tildes stay tildes; an info string with a backtick in it can
 * only follow tildes.
 */
export function writtenFence(code: string, remembered: string | null, info: string): string {
  const lines = code.split('\n')
  const safe = (fence: string) => !lines.some((line) => closesFence(line, fence))
  if (remembered !== null && /^(`{3,}|~{3,})$/.test(remembered) && safe(remembered)) {
    if (remembered.startsWith('~') || !info.includes('`')) {
      return remembered
    }
  }
  if ((remembered !== null && remembered.startsWith('~')) || info.includes('`')) {
    const longest = (code.match(/~+/g) ?? []).reduce((run, match) => Math.max(run, match.length), 0)
    return '~'.repeat(Math.max(3, longest + 1))
  }
  return codeFenceFor(code)
}
