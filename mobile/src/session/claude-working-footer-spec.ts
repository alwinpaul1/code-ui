// The Claude Android app's working footer: the numbers behind the line above its composer
// (com.anthropic.claude 1.261009.20, decompiled with jadx 2026-10-15, read only). Where each
// comes from, so the next release can be re-checked:
//
//   plurals         res values/plurals.xml:419-422   `ccr_workflow_running_tasks`: "%1$d running
//                                    task" / "%1$d running tasks"; read at au8.java:99
//   when it shows   au8.java:97      the count is drawn when it is above 0, working or not;
//                   nl7.java:259     with no working turn it is the line's only content
//   tap             au8.java:105     the count's click label is `ccr_workflow_background_tasks`
//                   ek8.java:180     ("Background tasks") and its action is `rs8.m5(...)`, the
//                                    tasks sheet, then dismisses the menu
//   spinner         1.261013.20 replaced the 84-frame `cc_spinner_sprite` with the working mark
//                   (`zq20`, 20 dp of dots that open, loop and close by what the turn does);
//                   claude-working-mark.ts has its lines. The sprite is gone from that build.
//   verbs           nl7.java:14      the twenty words below, each shown with "..." after it
//                   nl7.java:246
//   verb clock      l8.java:120-150  (decompiled in fallback mode) starts on a RANDOM word; unless
//                                    motion is reduced it waits 3000 ms, picks another random word,
//                                    waits 4000 ms, then 6000 ms for every change after (the wait
//                                    is chosen by how many changes have happened: under 1, under 2,
//                                    else); under reduced motion it keeps the first word (index 0
//                                    when the OS asked for it, nl7.java:120)
//   geometry        nl7.java:165,188 padding 16 dp top and bottom; spinner then an 8 dp gap while
//                                    working; text is `jn7.E` (15 / 400 / 1.4 = 21 sp); idle count
//                                    has a 48 dp minimum WIDTH (nl7.java:263: minWidth 48, minHeight 0)
//                   wm7.a (1.261013.20) the same 16 dp top and bottom (`oxb.I(.., 0, 16, 1)`), the
//                                    mark (20 dp) then 8 dp, `xo7.C` 15 / 400 / 1.4; idle draws
//                                    the count alone (no mark, no gap); 16 dp at the sides come
//                                    from the list's item modifier (`y07`, `rrb.Q(.., 16, 0, 2)`)
//   placement       y07 case 15      the line is the chat list's item "thinking_spark", after the
//                   (1.261013.20)    queued message and the session pills (the list is reversed,
//                                    so it draws above them): it scrolls with the transcript and
//                                    is never pinned over it
//   separator       strings.xml:1309 `ccr_spark_segment_separator` is " · " (space, middle dot,
//                                    space), spelled in the line's own text colour
//   colours         nl7.java:377     verb and separator `pl7.e` (clay); the count is `ad5.C0()`
//                   nl7.java:263,290 (link blue) idle and working alike
//
// The header has NO working spinner. The blue arc ring beside the session title is the context
// ring (`us8`, a determinate arc `ba7`: a track circle and an arc from -90 degrees whose sweep is
// the fraction used, blue under 75%), which Code UI tried and the user reverted on 2026-10-11 (the
// ring stays in the composer). The only indeterminate arcs in the app are Material's
// `CircularProgressIndicator` (`khp.a`, 20 dp / 2 dp stroke in the status chip, `gqc.java:1352`),
// and none sits in the session header.
//
// The stats ("15s · 1,234 tokens") and the status phrase ("still thinking…") the app puts around
// the count are drawn since 2026-10-15, when the user asked for the app's exact line (they had
// asked for words and no time on 2026-09-25). They come from Anthropic's events of a matched tab
// (claude-working-footer-stats.ts); a tab with none draws the verb path, which the app draws when
// it has no stats (nl7.java:246).

/** `nl7.a` (nl7.java:14), in the app's order. */
export const CLAUDE_WORKING_VERBS = [
  'Clauding',
  'Cogitating',
  'Computing',
  'Contemplating',
  'Cooking',
  'Deliberating',
  'Generating',
  'Imagining',
  'Musing',
  'Noodling',
  'Pondering',
  'Processing',
  'Scheming',
  'Synthesizing',
  'Thinking',
  'Tinkering',
  'Working',
  'Ruminating',
  'Percolating',
  'Brewing'
] as const

/** The gap between the working mark and the words, dp (`wm7.a`: `pmw.u(.., 8f)`). */
export const CLAUDE_FOOTER_MARK_GAP = 8

/** The line's sides, dp: the chat list's 16 dp gutter (`y07`), the transcript text's own inset. */
export const CLAUDE_FOOTER_PADDING_HORIZONTAL = 16

/** The line's own padding above and below, dp (`rrb.Q(..., 0, 16, 1)`, nl7.java:165). */
export const CLAUDE_FOOTER_PADDING_VERTICAL = 16

/** Minimum width of the idle count, dp (`ixv.i(modifier, 48.0f, 0.0f, 2)` is defaultMinSize(minWidth = 48), nl7.java:263). */
export const CLAUDE_FOOTER_IDLE_MIN_WIDTH = 48

/** `ccr_spark_segment_separator`. */
export const CLAUDE_FOOTER_SEPARATOR = ' · '

/** The wait before the verb at change number `changes` (0 is the first change), ms. */
export function verbChangeDelayMs(changes: number): number {
  if (changes < 1) {
    return 3_000
  }
  if (changes < 2) {
    return 4_000
  }
  return 6_000
}

/** The word at a random index, as the app's `Random` picks it (repeats allowed). */
export function randomVerbIndex(random: () => number = Math.random): number {
  return Math.min(CLAUDE_WORKING_VERBS.length - 1, Math.floor(random() * CLAUDE_WORKING_VERBS.length))
}
