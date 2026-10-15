// The Claude Android app's question card: the numbers behind the ask card's frame and footer
// (com.anthropic.claude 1.261013.20, decompiled with jadx 2026-10-16, read only). The card
// is `dc5`, which jadx skips in a whole-APK run; `jadx --single-class defpackage.dc5` over
// classes3.dex decompiles it. Where each value comes from, so the next release can be re-checked:
//
//   card frame      dc5.java:602     shape `ro7.a.j`, 24 dp (zlw.java:16 in 1.261009.20)
//                   dc5.java:655     `n55.b(.., shape, shadow = false, fill ad5.n0(), .., mask 24)`:
//                   n55.java:15720   the mask leaves the border width (0) and colour (`ad5.A()`,
//                                    the 10 % hairline) at their defaults. Compose draws a 0 dp
//                                    border as a one-pixel hairline (`Dp.Hairline`), so the card
//                                    has a hairline edge in the rule colour, no shadow
//   question        dc5.java:1736    style `xo7.C`: 15 sp, weight 400, line 1.4 (xo7.java:46)
//   footer          dc5.java:16-18   min height 48, padding 20 / 6 / 16 / 6, 8 dp gaps
//   count           dc5.java:1477-1484  "n selected" (plural `question_card_selected_count`,
//                                    0x7f0e009b) on the left, counting the typed answer too; drawn
//                   dc5.java:825     only when `c8r.u`, which only `MultipleChoice` sets
//                                    (c8r.java:4-9)
//   Skip            dc5.java:1508,2270  `o4k.c("Skip", .., af4 "Secondary", qe4 "Small")`: an outlined
//                                    pill (af4.java: no fill, an edge colour), 36 dp tall (qe4.java c())
//                   dc5.java:847-861 Skip clears the page's answer, then submits on the last page
//                                    and turns to the next one otherwise
//                   t52.java:83,97   an unanswered page reaches the agent as "[No preference]"
//   send            dc5.java:1404-1410  `rbi.c(icon, label, .., qe4 "Small", style)`: a round icon
//                                    button, 36 dp (qe4.java c()) around a 20 dp glyph (qe4.java a()).
//                                    The last page: `arrowUp` (wu0.java:30), label "Submit"
//                                    (`submit_button`), Brand style (ve4.java, the clay). Earlier
//                                    pages: `arrowRight` (wu0.java:27), label "Next"
//                                    (`question_card_next`), Primary style (ze4.java, the ink).
//                                    Enabled once the page is answered (dc5.java:1509); disabled it
//                                    takes the disabled container (ve4/ze4 b(), ordinal 2)
//   footer shown    dc5.java:793     the app hides the footer for `SingleChoice`, where a pick
//                                    submits; Code UI keeps it on every card, because the user
//                                    asked on 2026-10-13 that a tap only chooses
//
// Sizes and colours stay Code UI's own (the user reverted the app's type sizes and palette on
// 2026-10-11): the card reads the `ask*` theme tokens and the `type` scale, both schemes.

/** The card's corner, `ro7.a.j` (dc5.java:602). */
export const ASK_CARD_RADIUS = 24
/** Skip's and the send button's height, qe4 "Small" (qe4.java c()). */
export const ASK_FOOTER_CONTROL_SIZE = 36
/** The arrow inside the send button, qe4 "Small" (qe4.java a()). */
export const ASK_SEND_GLYPH_SIZE = 20
/** Footer row: dc5.f / dc5.e / dc5.g (dc5.java:16-18). */
export const ASK_FOOTER = {
  minHeight: 48,
  paddingLeft: 20,
  paddingTop: 6,
  paddingRight: 16,
  paddingBottom: 6,
  gap: 8
} as const
/** Skip's label (`question_card_skip`, strings.xml:3609). */
export const ASK_SKIP_LABEL = 'Skip'

/** The least the card keeps with the keyboard up: the question and one row. */
const ASK_CARD_KEYBOARD_FLOOR = 120

/** How tall the card may grow. The card takes the composer's place while the
 *  agent waits on it (askTakesComposerPlace), so with the keyboard down it may use
 *  the room the composer left: 60 % of the window, so four described options and
 *  "Something else" fit on a 915 dp phone without the last row sliding under the
 *  footer.
 *
 *  The window does not shrink for the keyboard (the dock is padded by the inset
 *  instead), so a share of the window is wrong with the keyboard up: focusing
 *  "Something else" raised it, and a card sized from the whole window pushed its
 *  own question off the top. With the keyboard up the share is taken of the room
 *  above it, which the app's header and the dock's other rows share with the
 *  card. The floor keeps the question and a row drawn when even that is tiny.
 *
 *  `besideComposer`: the composer is still drawn under the card (the agent is
 *  not confirmed waiting on it, or dictation runs), so the card keeps the cap it
 *  had beside one: 52 % of the window, at most 400. */
export function askCardMaxHeight(
  windowHeight: number,
  keyboardInset = 0,
  besideComposer = false
): number {
  const share = besideComposer ? 0.52 : 0.6
  const ceiling = besideComposer ? 400 : Infinity
  if (keyboardInset <= 0) {
    return Math.max(240, Math.min(ceiling, Math.round(windowHeight * share)))
  }
  const room = Math.max(0, windowHeight - keyboardInset)
  return Math.max(ASK_CARD_KEYBOARD_FLOOR, Math.min(ceiling, Math.round(room * share)))
}
