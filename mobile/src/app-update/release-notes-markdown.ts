import { trimAutolinkTrailingPunctuation } from '../components/markdown-inline-token-rules'

// GitHub's generated release body is Markdown ("## What's changed", "- fix: …
// by @x in https://…/pull/12", "**Full Changelog**: …"). The update alert
// renders it AS markdown, through the same renderer the .md tab and the chat
// use, so bullets, emphasis and links survive. What this does is reshape it
// for a 270-wide alert card:
//
// - A heading becomes a bold line. The card's message column is 13px; a
//   19–22px section heading would eat a third of the notes' 220px cap for one
//   word, and weight alone is how a compact alert shows a section. Emphasis
//   already inside the heading is unwrapped first: "**Bold** and `code`"
//   wrapped again would give the renderer "****Bold** and `code`**", which it
//   reads as a stray "**", the wrong span bold, and a trailing "**".
// - The "by @user in <PR>" tail GitHub appends to a merged-PR line goes.
//   Rendered, it is a name and a 60-character URL after every change. The
//   last token is whatever GitHub put there, a URL or a "#3".
// - "**Full Changelog**: <url>" becomes a short link so the page is one tap
//   away without the compare URL wrapping over three lines. Sentence
//   punctuation after the URL stays outside the link; a URL with parentheses
//   is left as written, because the renderer's link matcher stops at the
//   first ")" while its autolinker takes the URL whole.
// - A bare "Release x.y.z" line, bulleted or not, is the version-bump commit
//   and says nothing the card's own version line does not (2026-09-12). A
//   subject that carries a summary after the colon is kept.
//
// Nothing inside a code block is prose. A fenced block (``` or ~~~, at any
// indent, closed only by the same character in a run at least as long, per
// CommonMark) and a line indented four spaces or a tab pass through verbatim.
// Without this the transform bolded a "## not a heading" inside a fence and
// DELETED a "- Release 1.2.3" inside one, which a reader cannot see
// (review, 2026-09-17). The line loop is still line-based rather than a
// token-level pass: marked has no markdown printer to re-serialise a token
// tree, and the bodies this reads are flat generated lists. Where the rules
// are unsure they leave the line alone; a kept tail is a nuisance, a dropped
// line is not.

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/
const FULL_CHANGELOG = /^\*\*full changelog\*\*:?\s*(https?:\/\/\S+)\s*$/i
const MERGED_PR_TAIL = /\s+by\s+@[\w-]+\s+in\s+\S+$/i
const BARE_BUMP_LINE = /^(?:(?:[-*+]|\d+\.)\s+)?release\s+v?\d+(\.\d+)*\s*$/i
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/
const INDENTED_CODE = /^(?: {4}|\t)/
const COMMENT_OPEN = '<!--'
const COMMENT_CLOSE = '-->'

/** "**Bold**", "__Loud__", "*this*" and "_soft_" back to their words. A `_`
 *  inside a word (snake_case) is not emphasis and is left alone. */
function unwrapEmphasis(text: string): string {
  return text
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*([^*\s](?:[^*]*[^*\s])?)\*(?=[^\w*]|$)/g, '$1$2')
    .replace(/(^|[^\w_])_([^_\s](?:[^_]*[^_\s])?)_(?=[^\w_]|$)/g, '$1$2')
}

export function releaseNotesMarkdown(body: string | null | undefined): string {
  if (!body) {
    return ''
  }
  const lines: string[] = []
  let fence: { char: string; length: number } | null = null
  let inComment = false
  for (const raw of body.split(/\r?\n/)) {
    if (fence) {
      lines.push(raw)
      const close = FENCE_CLOSE.exec(raw)
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        fence = null
      }
      continue
    }
    let line = raw
    if (inComment) {
      const end = line.indexOf(COMMENT_CLOSE)
      if (end === -1) {
        continue
      }
      line = line.slice(end + COMMENT_CLOSE.length)
      inComment = false
    }
    line = line.replace(/<!--[\s\S]*?-->/g, '')
    const open = line.indexOf(COMMENT_OPEN)
    if (open !== -1) {
      line = line.slice(0, open)
      inComment = true
    }
    // A line that was only a comment leaves no blank behind.
    if (raw.trim() && !line.trim()) {
      continue
    }
    const opener = FENCE_OPEN.exec(line)
    if (opener) {
      fence = { char: opener[1]![0]!, length: opener[1]!.length }
      lines.push(line.trimEnd())
      continue
    }
    if (INDENTED_CODE.test(line)) {
      lines.push(line)
      continue
    }
    line = line.trimEnd()
    const trimmed = line.trim()
    if (BARE_BUMP_LINE.test(trimmed)) {
      continue
    }
    const heading = HEADING.exec(trimmed)
    if (heading) {
      lines.push(`**${unwrapEmphasis(heading[1]!)}**`)
      continue
    }
    const changelog = FULL_CHANGELOG.exec(trimmed)
    if (changelog) {
      const { url, trailing } = trimAutolinkTrailingPunctuation(changelog[1]!)
      if (!/[()]/.test(url)) {
        lines.push(`[Full changelog](${url})${trailing}`)
        continue
      }
    }
    lines.push(line.replace(MERGED_PR_TAIL, ''))
  }
  // A dropped line leaves its blank neighbours behind; more than one blank
  // line in a row is a taller gap in the card for nothing.
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
