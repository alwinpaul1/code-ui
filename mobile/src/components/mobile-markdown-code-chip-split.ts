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
