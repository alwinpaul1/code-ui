import type { MobileMarkdownListItem } from './mobile-markdown-parser'

/** Bullet per nesting level, so a sub-item reads as one even where the indent
 *  alone is too narrow to see at ~40 columns. Deeper levels reuse the last. */
const LIST_BULLETS = ['•', '◦', '▪']

/** `3.` for an ordered item that starts at 3, the level's bullet otherwise, and
 *  a box for a task item whichever list it sits in. */
export function listMarker(item: MobileMarkdownListItem): string {
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
