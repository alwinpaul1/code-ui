import { highlightMobileCode, resolveMobileSyntaxLanguage } from '../session/mobile-file-syntax'
import { splitSyntaxIntoLines } from './mobile-syntax-lines'
import type { MobileSyntaxSegment } from '../session/mobile-file-syntax'

/** Lines drawn for one fence. A fence is read, not scrolled through like a
 *  file, and every line is a mounted `Text`; past this the rest is counted
 *  instead. The file reader uses a FlatList for the same reason at 4000 lines. */
export const MAX_MARKDOWN_CODE_LINES = 200

export type MobileMarkdownCodeLines = {
  lines: MobileSyntaxSegment[][]
  /** Lines beyond the cap, for the note under the block. 0 when all are drawn. */
  hidden: number
  /** What the highlighter actually used, for the block's caption. */
  language: string
}

/**
 * A fenced block as syntax-coloured lines, one per source line.
 *
 * It had a line-number gutter from 2026-09-15 ("in VS Code and all we have
 * this code block with a line shown, I need it like that"). The Claude app's
 * code block has none (if9.java / z07.java draw the lines alone), and the
 * block is now that card (code-block-spec.ts), so the numbers are gone from
 * the chat. The file reader keeps its own (MobileCodeView).
 *
 * The pieces already existed for the file reader: `highlightMobileCode` for the
 * colours and `splitSyntaxIntoLines` for the lines. The only thing missing was
 * a language, because the file path is what usually names one and a fence has
 * none — it has an info string instead, which `resolveMobileSyntaxLanguage`
 * already accepts as its preferred language.
 *
 * An unknown or absent info string still gets its lines, just uncoloured:
 * refusing to draw a `sh` fence as lines because nothing highlights it would
 * be the wrong trade.
 */
export function mobileMarkdownCodeLines(
  code: string,
  info: string | undefined,
  /** Lines to keep. The chat draws MAX_MARKDOWN_CODE_LINES; the Expand sheet
   *  draws them all (it lays them out 24 to a Text, so a long block is not a
   *  long list of mounted views). */
  limit: number = MAX_MARKDOWN_CODE_LINES
): MobileMarkdownCodeLines {
  const language = resolveMobileSyntaxLanguage('', info ?? '')
  let segments: MobileSyntaxSegment[]
  try {
    const highlighted = highlightMobileCode(code, language)
    segments =
      highlighted.segments.length > 0 ? highlighted.segments : [{ text: code, kind: 'plain' }]
  } catch {
    // Never lose the code to a highlighter that could not parse it.
    segments = [{ text: code, kind: 'plain' }]
  }
  const all = splitSyntaxIntoLines(segments)
  // A fence's trailing newline makes one empty line the author did not write.
  const trimmed =
    all.length > 1 && all.at(-1)?.every((segment) => segment.text === '') ? all.slice(0, -1) : all
  return {
    lines: trimmed.slice(0, limit),
    hidden: Math.max(0, trimmed.length - limit),
    language
  }
}
