import { escapeLiteralHtml } from './markdown-escaping'

/**
 * The attribute on a block the editor shows but does not edit, whose text a save writes back byte
 * for byte. Only front matter is such a block today.
 */
export const VERBATIM_ATTRIBUTE = 'data-md-verbatim'

/**
 * Where the front matter a document opens with ends: a `---` on its first line closed by a `---`
 * or `...` line, as Jekyll, Hugo and GitHub read it. Null when the document opens with none,
 * including a first-line `---` that nothing closes, which is a rule.
 *
 * Read as front matter rather than a rule, a paragraph and a rule, because the paragraph's reflow
 * joined the keys onto one line (review, 2026-09-30): an edit anywhere in a SKILL.md saved YAML
 * that no longer parsed.
 */
export function frontMatterEnd(lines: readonly string[]): number | null {
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) {
    return null
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[index] ?? '')) {
      return index + 1
    }
  }
  return null
}

/**
 * Front matter as a block the user sees and cannot edit: its lines exactly as written, entities
 * and marks included, delimiters and all. Not editable because nothing here reads YAML, and a
 * code block the engine can type into could take a following paragraph into the YAML on a
 * backspace.
 */
export function frontMatterHtml(lines: readonly string[]): string {
  return (
    `<pre ${VERBATIM_ATTRIBUTE}="front-matter" contenteditable="false">` +
    `<code>${escapeLiteralHtml(lines.join('\n'))}</code></pre>`
  )
}
