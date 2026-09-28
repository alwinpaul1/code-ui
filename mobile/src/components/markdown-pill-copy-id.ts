/**
 * What a code pill copies as, written on its View for Android's selection Copy.
 *
 * A pill is an inline View in the prose Text, and Android copies an inline View as U+FFFC: a reply
 * selected and copied on 2026-09-28 pasted as "...only when someone runs ￼." for `cdk deploy`.
 * modules/orca-selection-copy swaps each pill's U+FFFC for the span it was cut from, which it
 * finds on the pill View's nativeID (PillCopy.kt reads this exact shape). The whole span is on
 * every piece: a span split across lines is one pill per line, each cut without the space it was
 * cut at, so the pieces do not join back into it. `piece` is the pill's place in its span, 0 for
 * the first, so a Copy takes the span once.
 */
export const PILL_COPY_ID_PREFIX = 'codeui-pill:'

/** The Expo module whose view wraps a Markdown document on Android. */
export const SELECTION_COPY_MODULE = 'OrcaSelectionCopy'

export function encodePillCopyNativeId(span: string, piece: number): string {
  return `${PILL_COPY_ID_PREFIX}${piece}:${span}`
}
