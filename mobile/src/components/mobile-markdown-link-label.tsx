import type { ReactNode } from 'react'
import { Text } from 'react-native'
import {
  codeSpanContent,
  createMarkdownInlineMatcher,
  markdownInlineTokenPattern
} from './markdown-inline-matcher'
import { isIntrawordUnderscoreToken } from './markdown-inline-token-rules'
import { unescapeMarkdownText } from './markdown-inline-escapes'
import { markdownInlinePlainText } from './markdown-plain-text'
import type { MarkdownStyles } from './mobile-markdown-styles'

const STRUCK_LINK = { textDecorationLine: 'underline line-through' } as const

/**
 * A link's words with their marks drawn as style. The renderer used to put a
 * label in its Text as written, so "[`app.ts:12`](mobile/src/app.ts#L12)", the
 * way Claude names a file it changed, showed its backticks (2026-09-29).
 *
 * Code in a label is a monospace span in the link's colour, never a pill: a
 * pill is an inline View, and one inside the link's Text would take the tap
 * that opens the link. Nothing in a label is a link or a file of its own, since
 * the whole label is already one: a link or an address in it is drawn as
 * written. An image in it is drawn as its words, the way an image is drawn in
 * prose, so a README badge, `[![CI](badge.svg)](repo)`, reads "CI" and opens
 * the repo. The matcher closed a label at its first `]` before, which drew
 * that badge as `![CI` linked to the badge image (review, 2026-09-30).
 */
export function renderLinkLabel(styles: MarkdownStyles, label: string, keyPrefix = 'l'): ReactNode[] {
  const pattern = createMarkdownInlineMatcher(label, markdownInlineTokenPattern(), true, true)
  const parts: ReactNode[] = []
  let pendingStart = 0
  let match
  while ((match = pattern.exec())) {
    const token = match[0]
    if (token.startsWith('_') && isIntrawordUnderscoreToken(label, match.index, token)) {
      pattern.lastIndex = match.index + 1
      continue
    }
    if (match.index > pendingStart) {
      parts.push(unescapeMarkdownText(label.slice(pendingStart, match.index)))
    }
    pendingStart = pattern.lastIndex
    const key = `${keyPrefix}${match.index}`
    if (match.link?.image) {
      parts.push(markdownInlinePlainText(match.link.label) || 'image')
    } else if (match.link || /^<?https?:\/\//i.test(token)) {
      parts.push(token)
    } else if (token.startsWith('`')) {
      parts.push(
        <Text key={key} style={[styles.inlineCode, styles.inlineCodeLink]}>
          {codeSpanContent(token)}
        </Text>
      )
    } else {
      // Bold sets the body text colour, and a nested Text's decoration replaces
      // its parent's on Android; the link's colour and underline go back on top.
      const style = token.startsWith('~~')
        ? [styles.strike, STRUCK_LINK]
        : token.startsWith('**') || token.startsWith('__')
          ? [styles.bold, styles.link]
          : styles.italic
      const inner = token.startsWith('~~') || token.startsWith('**') || token.startsWith('__') ? token.slice(2, -2) : token.slice(1, -1)
      parts.push(
        <Text key={key} style={style}>
          {renderLinkLabel(styles, inner, `${key}s`)}
        </Text>
      )
    }
  }
  if (pendingStart < label.length) {
    parts.push(unescapeMarkdownText(label.slice(pendingStart)))
  }
  return parts
}
