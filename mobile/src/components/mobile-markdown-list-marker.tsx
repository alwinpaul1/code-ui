import { Text } from 'react-native'
import type { ReactNode } from 'react'
import type { MobileMarkdownListItem } from './mobile-markdown-parser'
import type { MarkdownStyles } from './mobile-markdown-styles'

/** Bullet per nesting level, so a sub-item reads as one even where the indent
 *  alone is too narrow to see at ~40 columns. Deeper levels reuse the last. */
const LIST_BULLETS = ['•', '◦', '▪']
/** One level of list nesting inside the prose run, as text: a span cannot
 *  carry a margin, so the indent is spaces. Four is about 11 dp at the prose
 *  size. Narrow on purpose: at ~40 columns a desktop-sized indent leaves a
 *  third-level item too little room to read. */
const LIST_INDENT_TEXT = '    '

/** `3.` for an ordered item that starts at 3, the level's bullet otherwise, and
 *  a box for a task item whichever list it sits in. */
function listMarker(item: MobileMarkdownListItem): string {
  // The rest of an item that a fence interrupted keeps the indent and takes no
  // marker; a second bullet would read as a second item.
  if (item.continuation) {
    return ''
  }
  if (item.checked != null) {
    return item.checked ? '☑' : '☐'
  }
  if (item.ordered) {
    return `${item.number ?? 1}.`
  }
  return LIST_BULLETS[Math.min(item.depth, LIST_BULLETS.length - 1)]!
}

/**
 * A list item's indent and marker, at the start of its line in the prose run
 * (MobileMarkdown): spans, since a span has no margin. A space of the words'
 * before the marker and two after put the bullet and the words where the
 * Claude app sets them, 8 and 15.5 dp in (2026-09-28); the marker was its
 * mono glyph and two mono spaces, 4 and 25 dp in.
 */
export function renderListMarker(item: MobileMarkdownListItem, styles: MarkdownStyles): ReactNode {
  const marker = listMarker(item)
  return (
    <>
      {LIST_INDENT_TEXT.repeat(item.depth)}
      {marker ? (
        <>
          {' '}
          <Text style={styles.listMarkerInline}>{marker}</Text>
          {'  '}
        </>
      ) : null}
    </>
  )
}
