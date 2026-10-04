/**
 * The media-control glyphs the terminal document carries a face for: U+23F4..U+23FA, and nothing
 * else.
 *
 * Claude Code's status line draws `⏵⏵ auto mode on` (U+23F5), and no system font on a Galaxy S23
 * has that block (9c01356bd). The face is a 6 KB subset of Noto Sans Symbols 2 v2.008, vendored
 * under `terminal-webview-html/fonts/` (see VENDORED.md there).
 *
 * A leaf module because both sides read it and neither may carry the other's imports: the document
 * (bundled into the WebView's script) puts the family in its font stack and asks for the face, and
 * the WebView's HTML shell declares the face. The font's bytes stay out of the document's script.
 */
export const MEDIA_CONTROL_GLYPHS_FONT_FAMILY = 'Noto Sans Symbols 2 Media Controls'

/** The only code points the face may supply; every other character falls through to the stack. */
export const MEDIA_CONTROL_GLYPHS_UNICODE_RANGE = 'U+23F4-23FA'

/** The character the document asks the face for: Claude Code's `⏵`. */
export const MEDIA_CONTROL_GLYPHS_SAMPLE = '⏵'
