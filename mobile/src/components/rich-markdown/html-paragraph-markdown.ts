import { breakMark, inlineChildren } from './html-inline-markdown'
import { HARD_BREAKS_ATTRIBUTE } from './markdown-reflow'
import { setextLevel } from './markdown-leaf-blocks'
import { isBlockStart } from './markdown-to-html'

/**
 * A paragraph as markdown, each of its `<br>`s a hard break.
 *
 * The loader draws a hard break, two trailing spaces or a trailing backslash, as a `<br>`, and the
 * writer wrote every `<br>` as a bare newline, which is a soft break: the break was gone on GitHub,
 * in the chat and on the phone's own reload (review, 2026-09-30). A break is written in the form
 * its source used, where the paragraph remembers that (HARD_BREAKS_ATTRIBUTE, markdown-reflow.ts)
 * and still has as many breaks as it remembers, and otherwise, as for a break the user types, as a
 * backslash: visible, and not stripped by an editor that trims trailing spaces.
 *
 * A break with nothing after it, which an engine leaves to hold the caret, is written as nothing.
 * A break on a line of its own, or before one, is a backslash, since a line of spaces is a blank
 * line that ends the paragraph. A
 * line ending in an odd run of backslashes takes the spaces instead, since one more backslash would
 * escape it. And a break before a line that opens a block of its own is the bare newline it always
 * was, since a backslash there is a literal one at the paragraph's end.
 */
export function paragraphMarkdown(paragraph: Element): string {
  const mark = breakMark()
  return markedBreaksMarkdown(
    inlineChildren(paragraph, { lineBreak: () => mark }),
    (paragraph.getAttribute(HARD_BREAKS_ATTRIBUTE) ?? '').split(' ')
  )
}

/**
 * Words with each `<br>` written as the break mark (breakMark), as markdown: each mark the hard
 * break paragraphMarkdown writes, in the `remembered` forms where there are as many of them as
 * breaks kept. A list item's words are written with it too (html-list-markdown.ts).
 */
export function markedBreaksMarkdown(marked: string, remembered: readonly string[]): string {
  const segments = marked.split(breakMark())
  let last = segments.length - 1
  while (last > 0 && !segments[last]!.trim()) {
    last -= 1
  }
  const kept = segments.slice(0, last + 1)
  const forms = remembered.length === kept.length - 1 ? remembered : []
  let out = kept[0] ?? ''
  for (let index = 1; index < kept.length; index += 1) {
    const after = kept[index]!
    out += lineBreakFor(out.slice(out.lastIndexOf('\n') + 1), after, forms[index - 1]) + after
  }
  return out.trim()
}

function lineBreakFor(line: string, after: string, form: string | undefined): string {
  const next = after.trimStart()
  if (next && (isBlockStart(next) || setextLevel(next) !== null)) {
    return '\n'
  }
  let slashes = 0
  while (line.charAt(line.length - 1 - slashes) === '\\') {
    slashes += 1
  }
  if (slashes % 2 === 1) {
    return '  \n'
  }
  return form === 'spaces' && line.trim() && next ? '  \n' : '\\\n'
}
