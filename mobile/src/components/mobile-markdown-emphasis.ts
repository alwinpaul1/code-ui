import type { MarkdownStyles } from './mobile-markdown-styles'

/**
 * Which emphasis a span of inline text sits inside: bit 1 bold, bit 2 italic.
 * A nested span is a Text of its own, and the app's Text hook gives each one
 * the face of its own style alone (instrument-sans-text.ts), so an italic
 * inside a bold span, or a bold inside an italic one, would draw without the
 * other's weight or slant. `***x***`, `**a *b* c**` and `*a **b** c*` are all
 * ordinary Claude writing, so the inner span names both.
 */
export type EmphasisAround = 0 | 1 | 2 | 3

export const EMPHASIS_NONE: EmphasisAround = 0
const BOLD = 1
const ITALIC = 2

/** What a span of bold, or of italic, is inside once it is nested in `around`. */
export function nestedEmphasis(around: EmphasisAround, bold: boolean): EmphasisAround {
  return (around | (bold ? BOLD : ITALIC)) as EmphasisAround
}

/** The style of a span of emphasis that is inside `emphasis` (never none). */
export function emphasisStyle(styles: MarkdownStyles, emphasis: EmphasisAround) {
  if (emphasis === BOLD) {
    return styles.bold
  }
  return emphasis === ITALIC ? styles.italic : styles.boldItalic
}
