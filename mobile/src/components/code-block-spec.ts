import { MARKDOWN_BASE_SIZE } from './mobile-markdown-prose-scale'

// A fenced code block, after the Claude Android app (com.anthropic.claude
// 1.261009.20, decompiled 2026-10-14). Where each number comes from, so the
// next release can be re-checked against it:
//
//   card            w330.java:155-209  Column clipped to a 12 dp rounded shape,
//                                      the header over the body
//   header row      kso.java:46-52     min height max(40 sp, 40 dp), 16 dp
//                                      either side, centred, `pl7.s` fill
//   label           kso.java:70-88     the fence language with its first letter
//                                      upper-cased, or the string "Code" when
//                                      the fence has none; `zv.i` (13 / 1.5 em
//                                      mono), colour `pl7.P`
//   Copy, Expand    kso.java:92-123    two icon buttons, 4 dp apart, after a
//                                      weight-1 spacer; size `bf4` "Small":
//                                      36 sp button, 20 sp glyph, 40 dp target
//   Copy feedback   fa20.java:87-420   glyph copy -> check, its colour tweened
//                   l82.java (case 2)  over 300 ms to `ad5.K`; back after
//                                      2000 ms; "Copied" as the state label
//   body            w330.java:182-190  `pl7.r` fill, 16 dp padding all round,
//                   if9.java, z07.java the code one line per source line (24
//                                      lines to a Text), no line numbers, no
//                                      wrap unless the app's "Line wrap"
//                                      setting (`code_line_wrap_enabled`,
//                                      default off) is on; scrolls sideways
//   Expand sheet    g130.java:g,e,d    "%s code" over a language, else "Code";
//                   wt10.java:G        a LargeResizable sheet (so it has a
//                                      partial stop and the grabber), the close
//                                      cross, the title, Copy at the end (Medium:
//                                      40 sp button, 24 sp glyph); the code full
//                                      width, 16 / 8 dp padding (hmf.java:62)
//
// Strings (res/values/strings.xml): code_block_copy_button "Copy code",
// code_block_expand_button "Expand code", code_block_copied "Copied",
// code_block_label_code "Code", view_code_sheet_title "%1$s code",
// generic_copy_content_description "Copy to clipboard".
//
// The ledger (docs/claude-app-typography.md) read the label as "plaintext" by
// default. That is the default for the SYNTAX highlighter (w330.java:196);
// the header's label is "Code" (kso.java:78).
//
// Colours are theme tokens (codeBlockHeader, codeBlockBody, codeBlockLabel,
// codeBlockCopied in theme/tokens.ts), so both schemes follow the user's
// appearance setting.

export const CODE_BLOCK_SPEC = {
  /** The card's corner, clipped. */
  radius: 12,
  header: {
    /** In sp, run through the phone's font scale like everything Claude sizes
     *  with `krz.v`; never under 40 dp. */
    minHeightSp: 40,
    minHeightDp: 40,
    paddingHorizontal: 16
  },
  /** Small icon buttons on the card's header (`bf4`). */
  button: {
    sizeSp: 36,
    glyphSp: 20,
    touchTargetDp: 40,
    gap: 4
  },
  /** Copy on the sheet's title row (`ye4`, "Medium"). */
  sheetButton: {
    sizeSp: 40,
    glyphSp: 24,
    touchTargetDp: 40
  },
  body: {
    padding: 16,
    /** The sheet's code sits 16 sideways, 8 above and below (hmf.java:62). */
    sheetPaddingHorizontal: 16,
    sheetPaddingVertical: 8
  },
  copy: {
    /** How long the check shows before the glyph goes back (l82.java). */
    copiedMs: 2_000,
    /** The glyph's colour tween (fa20.java: `hay.E(300)`). */
    tintMs: 300
  },
  /** Lines in one Text, as Claude chunks them (z07.java: `i10 * 24`). A Text
   *  per chunk, not per line: a hold selects across all of a chunk's lines,
   *  and a long block mounts a twenty-fourth of the nodes. */
  linesPerText: 24
} as const

/** The label's size, one step under the code's own: Claude's label (13 / 19.5)
 *  against its 15 / 22.5 code, here under Code UI's 13 / 20 body
 *  (mobile-markdown-styles.ts, which the typography pass set). */
export const CODE_BLOCK_LABEL_SIZE = MARKDOWN_BASE_SIZE - 4
export const CODE_BLOCK_LABEL_LINE_HEIGHT = MARKDOWN_BASE_SIZE + 2

function capitalised(language: string): string {
  return language.charAt(0).toUpperCase() + language.slice(1)
}

/** What the header calls a block: its fence language with the first letter
 *  upper-cased ("python" -> "Python"), or "Code" when the fence names none. */
export function codeBlockLabel(language: string | undefined): string {
  const named = language?.trim()
  return named ? capitalised(named) : 'Code'
}

/** The expanded sheet's title: "Python code" over a named fence, "Code" over
 *  an unlabelled one (view_code_sheet_title, g130.java:g). */
export function codeBlockSheetTitle(language: string | undefined): string {
  const named = language?.trim()
  return named ? `${capitalised(named)} code` : 'Code'
}
