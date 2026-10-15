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
//   spinner         nl7.java:47-78   `cc_spinner_sprite`: a 48 x 4032 px sprite, 84 frames of
//                                    48 x 48 (the asterisk that opens, blooms and closes again),
//                                    drawn 16 dp square (nl7.java:70-71), tinted with the line's
//                                    clay `pl7.e` (nl7.java:61-65, SrcIn)
//   frame clock     zn.java 13       a coroutine adds one to the frame every `delay(60)` and wraps
//   (decompiled     (zn.x, simple    at 84, while the line is working; when it stops the frame is
//   in fallback     mode)            set to 4, the 8-spoke star at rest (nl7.java:29 starts it at
//   mode)                            0 when working and at 4 when not)
//   verbs           nl7.java:14      the twenty words below, each shown with "..." after it
//                   nl7.java:246
//   verb clock      l8.java:120-150  (decompiled in fallback mode) starts on a RANDOM word; unless
//                                    motion is reduced it waits 3000 ms, picks another random word,
//                                    waits 4000 ms, then 6000 ms for every change after (the wait
//                                    is chosen by how many changes have happened: under 1, under 2,
//                                    else); under reduced motion it keeps the first word (index 0
//                                    when the OS asked for it, nl7.java:120)
//   geometry        nl7.java:165,188 padding 16 dp top and bottom; spinner then an 8 dp gap while
//                                    working (16 dp idle); text is `jn7.E` (15 / 400 / 1.4 =
//                                    21 sp); idle count has a 48 dp minimum WIDTH (nl7.java:263: minWidth 48, minHeight 0)
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
// Not applied: the stats ("12s · 1,234 tokens") the app puts before the count. The user asked
// for words and no time (2026-09-25), and Code UI has no token figure for a hand-started
// session, so the line draws the verb path, which the app draws when it has no stats
// (nl7.java:246).

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

export const CLAUDE_SPINNER = {
  /** Frames in `cc_spinner_sprite` (4032 px tall / 48 px). */
  frames: 84,
  /** `delay(60)` between frames: a loop of 5040 ms. */
  frameMs: 60,
  /** The frame the spinner rests on when nothing is working (and under reduced motion). */
  restFrame: 4,
  /** Drawn size, dp, both ways. */
  size: 16,
  /** Gap between the spinner and the verb while working, dp. */
  gapWorking: 8
} as const

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

/** The frame after `frame`, wrapping at the end of the sprite. */
export function nextSpinnerFrame(frame: number): number {
  return (frame + 1) % CLAUDE_SPINNER.frames
}

/** The word at a random index, as the app's `Random` picks it (repeats allowed). */
export function randomVerbIndex(random: () => number = Math.random): number {
  return Math.min(CLAUDE_WORKING_VERBS.length - 1, Math.floor(random() * CLAUDE_WORKING_VERBS.length))
}
