/**
 * The width each named Markdown surface was last laid out at, by the reader's zoom, so a row
 * FlashList mounts or recycles mid-scroll can measure its native prose run in its first render
 * (native-prose-text.android.tsx) instead of drawing as a Text first and jumping a frame later.
 *
 * Keyed by the surface's own name (MobileMarkdown's `widthKey`), not its type: a reply, an agent
 * message's body and a plan card share the transcript's type and sit at three widths, and a card's
 * width measured the next reply too tall (review, 2026-10-09). A surface with no name remembers
 * nothing and waits for its own layout.
 */
const widths = new Map<string, Map<number, number>>()

export function lastNativeProseWidth(surface: string | undefined, textScale: number): number {
  return surface === undefined ? 0 : (widths.get(surface)?.get(textScale) ?? 0)
}

export function rememberNativeProseWidth(surface: string | undefined, textScale: number, width: number): void {
  if (surface === undefined || !(width > 0)) {
    return
  }
  let byScale = widths.get(surface)
  if (!byScale) {
    byScale = new Map()
    widths.set(surface, byScale)
  }
  byScale.set(textScale, width)
}
