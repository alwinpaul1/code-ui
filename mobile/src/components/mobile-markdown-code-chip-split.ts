/** A chip is an inline View, which cannot break across lines, so a span
 *  longer than one line is cut into pieces that each get their own pill.
 *  The Claude app shows the same thing: `~/Desktop/code-ui-android-v0.5.17-139.apk`
 *  renders as `~/Desktop/` on one line and the file name on the next
 *  (2026-09-12). Cuts land where a reader would break the token anyway:
 *  after a slash or a space first, then after `-`, `_`, `.`, `=`, `:` when a
 *  piece is still too wide, and only mid-word as a last resort. Pieces are
 *  packed greedily so a span that fits stays a single pill. */
export const INLINE_CODE_CHIP_MAX_CHARS = 34

export function splitInlineCodeChips(code: string, max = INLINE_CODE_CHIP_MAX_CHARS): string[] {
  if (code.length <= max) {
    return code.length > 0 ? [code] : []
  }
  return pack(
    splitAfter(code, /[/\s]/).flatMap((piece) =>
      piece.length <= max ? [piece] : splitAfter(piece, /[-_.=:]/).flatMap((p) => hardCut(p, max))
    ),
    max
  )
}

function splitAfter(text: string, boundary: RegExp): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (boundary.test(text[i] as string) && i + 1 < text.length) {
      out.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out.filter((piece) => piece.length > 0)
}

function hardCut(piece: string, max: number): string[] {
  const out: string[] = []
  for (let i = 0; i < piece.length; i += max) {
    out.push(piece.slice(i, i + max))
  }
  return out
}

function pack(pieces: string[], max: number): string[] {
  const out: string[] = []
  for (const piece of pieces) {
    const last = out[out.length - 1]
    if (last !== undefined && last.length + piece.length <= max) {
      out[out.length - 1] = last + piece
    } else {
      out.push(piece)
    }
  }
  return out
}

/** JetBrains Mono's advance width, 600/1000 em (read from the bundled TTF's
 *  hmtx table, 2026-09-20). Every glyph is this wide, so a span's width in
 *  dp is its length times the font size times this. */
const MONO_ADVANCE_EM = 0.6
/** What a pill adds around its text: 5 dp padding, 1 dp border, 3 dp margin,
 *  each side (mobile-markdown-styles.ts `inlineCodeChip`). */
const CHIP_INSETS = 2 * (5 + 1 + 3)

/**
 * How many characters of a span fit on one line as ONE pill, from the
 * paragraph's measured width and the pill text's size.
 *
 * The fixed cap of 34 cut `.claude/worktrees/agent-a1922af126912f522` (42
 * characters) into two pills that then sat side by side on a single line,
 * with room to spare (device, 2026-09-20): a span that fits the line is one
 * pill, and only the line's width says whether it fits. Unknown width (0,
 * before the first layout) keeps the fixed cap.
 */
export function inlineCodeChipMaxChars(contentWidth: number, fontSize: number): number {
  if (!(contentWidth > 0) || !(fontSize > 0)) {
    return INLINE_CODE_CHIP_MAX_CHARS
  }
  const chars = Math.floor((contentWidth - CHIP_INSETS) / (fontSize * MONO_ADVANCE_EM))
  return Math.max(12, chars)
}
