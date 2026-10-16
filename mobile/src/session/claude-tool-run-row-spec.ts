// The Claude Android app's collapsed step rows in a transcript: "Ran 5 commands, read a file ›",
// "Ran <summary> ›", "Running ›", "Running agent: <description> ›", "Ran 3 agents ›" and
// "Thought process ›" (com.anthropic.claude 1.261013.20, decompiled with jadx 2026-10-16, read
// only). Where each number comes from, so the next release can be re-checked:
//
//   row shell       i430.a           Row(fillMaxWidth, clip, clickable, padding `s55.b`), start
//                                    arrangement, centred vertically; the content slot, then a
//                                    4 dp spacer (`pmw.u(.., 4f)`), then the chevron
//   padding         s55.java:6       `s55.b` = 8 / 6 / 8 / 6 dp (start, top, end, bottom), which
//                   ei4.java:1015,1037 the running row and the finished group row both pass. Code
//                                    UI takes the 6 dp top and bottom and keeps its rows flush
//                                    with the prose at the sides
//   chevron         fp30.c (fp30.java:93-125)  icon `y85.e.Q` at `yu0.Small` = 16 dp
//                                    (yu0.java), tinted `ym7.Q`; turned 90 degrees when open
//   label style     cp1.i (dex 0x0b24-0b79, classes4)  the group sentence `bw30.j(..)` drawn
//                                    with `xo7.C`; cab case 6 (single-cab cab.java:898,903) the
//                                    running label, `xo7.C` again, shimmered while it runs
//                   xo7.java:46      `xo7.C`: 15 sp, weight 400 (`iof.y`, iof.java:33), line height
//                                    1.4 (21 sp), no letter spacing; one line, ellipsized
//   label colour    cp1.i dex 0x0afd hands `bw30.j` `ym7.Q` for the words (onSurfaceVariant,
//                                    #7B7974 light, #97958D dark); cab.java:898,903 the same.
//                   bw30.java:920    only a group whose every call failed tints its verb
//                                    `ad5.u()` (red), which this file does not cover
//   leading icon    i430.c (i430.java:2994-3042)  `yu0.Large` = 24 dp by default, nudged 2 dp
//                                    left (`yg7.z(.., -(24 / 24 * 2))`, an offset: it moves the
//                                    glyph, not the layout), then a 4 dp spacer; ci4.java:30 tints
//                                    it `ad5.y()` (#898781, both schemes)
//   thought row     classes3 dex 0x0107-0x0173 (the `ccr_thinking_thought_process` row): icon
//                                    `y85.e.a1` at `yu0.v` = Medium, 20 dp, tinted `ym7.Q`; its
//                                    words `xo7.C` in `ym7.Q`
//
// The weight: `xo7.C` is 400 in Anthropic's face, which is heavier than Instrument Sans at 400.
// Beside the app, our 400 read a step lighter, and the user read the app's rows as semibold
// (2026-10-16), as with the ask card's `xo7.C` question (MobileNativeChatAsk.tsx). So the rows
// set Instrument Sans SemiBold. The size and line height are `type.body` (15 / 21).

/** The row's geometry, as numbers for the styles and the components. */
export const TOOL_RUN_ROW = {
  /** Between the leading icon, the label and the chevron: i430's 4 dp spacers. */
  gap: 4,
  /** `s55.b` top and bottom. */
  paddingVertical: 6,
  /** The disclosure chevron, `yu0.Small`. */
  chevronSize: 16,
  /** A running row's leading icon (an agent, a background task), `yu0.Large`. */
  leadingIconSize: 24,
  /** i430.c's offset of the leading icon. */
  leadingIconNudge: -2,
  /** The thought row's icon, `yu0.Medium`. */
  thoughtIconSize: 20,
  /** The diff stat after the sentence: cp1.i's 8 dp spacer (dex 0x0bc2), 4 more than the gap. */
  diffStatGap: 8
} as const
