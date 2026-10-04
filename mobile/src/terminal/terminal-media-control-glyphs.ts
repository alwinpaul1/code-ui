/**
 * The media-control glyphs the terminal document carries a face for: the triangles U+23F4..U+23F7,
 * and nothing else.
 *
 * Claude Code's status line draws `⏵⏵ auto mode on` (U+23F5), and no system font on a Galaxy S23
 * has those triangles (9c01356bd). The face is a 6 KB subset of Noto Sans Symbols 2 v2.008, vendored
 * under `terminal-webview-html/fonts/` (see VENDORED.md there). The file also holds ⏸ ⏹ ⏺
 * (U+23F8..U+23FA), but they advance 0.91em there against a cell of about 0.6em, and ⏺ is the dot
 * Claude Code puts on every message row, so the face does not select them: they draw from the
 * system fonts, as they did before the face existed. The triangles advance 0.586em and fit.
 *
 * A leaf module because both sides read it and neither may carry the other's imports: the document
 * (bundled into the WebView's script) puts the family in its font stack and asks for the face, and
 * the WebView's HTML shell declares the face. The font's bytes stay out of the document's script.
 */
export const MEDIA_CONTROL_GLYPHS_FONT_FAMILY = 'Noto Sans Symbols 2 Media Controls'

/** The only code points the face may supply; every other character falls through to the stack. */
export const MEDIA_CONTROL_GLYPHS_UNICODE_RANGE = 'U+23F4-23F7'

/** The character the document asks the face for: Claude Code's `⏵`. */
export const MEDIA_CONTROL_GLYPHS_SAMPLE = '⏵'
