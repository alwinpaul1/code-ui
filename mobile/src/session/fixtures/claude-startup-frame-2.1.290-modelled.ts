// MODELLED, NOT CAPTURED. No live Claude Code 2.1.290 startup frame has been
// captured yet; replace these with a `terminal.read --screen` capture when one
// exists (CLAUDE.md, "Agent screen parsing": record the build a screen was
// verified against; this one is verified against none).
//
// The wording is what the 2.1.290 binary builds: the descriptor's effort suffix
// is the template ` with ${level} effort` (the same builder as 2.1.289's,
// `strings` diff 2026-10-06), and the frame's rows follow the two layouts
// stablyai/orca's own tests pin for this frame (their
// claude-terminal-session-options tests, @ 13d94acd): the unframed logo, whose
// rows sit behind block art, and the framed box with a release-notes panel in
// the right cell. The paths and the plan name are invented; the repo is public.

/** The unframed logo, as a wide pane draws it. */
export const LOGO_FRAME = [
  ' ▐▛███▜▌   Claude Code v2.1.290',
  '▝▜█████▛▘  Opus 5 with xhigh effort · Claude Max',
  '  ▘▘ ▝▝    ~/projects/example-app',
  '',
  '────────────────────────────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────────────────────────────'
]

/** The same frame as 2.1.289 drew the model, with the note the 2.1.290
 *  changelog says was dropped from the Opus row. */
export const LOGO_FRAME_WITH_CONTEXT_NOTE = [
  ' ▐▛███▜▌   Claude Code v2.1.289',
  '▝▜█████▛▘  Opus 5 (1M context) with xhigh effort · Claude Max',
  '  ▘▘ ▝▝    ~/projects/example-app'
]

/** The framed box, with the release-notes panel in the right cell. */
export const BOXED_FRAME = [
  '╭─── Claude Code v2.1.290 ───────────────────────────────────────────────╮',
  '│                              │ Tips for getting started               │',
  '│      Welcome back, Sam!      │ Run /init to create a CLAUDE.md file   │',
  '│                              │ ────────────────────────────────────── │',
  '│           ▐▛███▜▌            │ Recent activity                        │',
  '│          ▝▜█████▛▘           │ No recent activity                     │',
  '│            ▘▘ ▝▝             │                                        │',
  '│  Sonnet 5 with medium effort · Claude Pro                             │',
  '│  ~/projects/example-app                                                │',
  '╰─────────────────────────────────────────────────────────────────────────╯'
]

/** A conversation that has grown past one screen: the frame is gone. */
export const SCROLLED_PAST = [
  '⏺ Read(src/main.ts)',
  '  ⎿  Read 120 lines',
  '',
  '⏺ The entry point wires the router and starts the server.',
  '',
  '────────────────────────────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────────────────────────────',
  '  ? for shortcuts'
]
