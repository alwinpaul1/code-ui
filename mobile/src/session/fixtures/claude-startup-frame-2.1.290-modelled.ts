// MODELLED, NOT CAPTURED. No live Claude Code 2.1.290 startup frame has been
// captured yet; replace these with a `terminal.read --screen` capture when one
// exists (CLAUDE.md, "Agent screen parsing": record the build a screen was
// verified against; this one is verified against none).
//
// Built from the 2.1.290 binary's own header component (`Xi`, read by `strings`
// 2026-10-06): a row of [mascot, text column] with `gap: 2`, the text column
// being `Claude Code v<version>`, then `<model><effort suffix> · <billing>`,
// then `[@<agent> · ]<cwd>` (a ` · <status>` follows it in fullscreen). The
// mascot is the 3-row glyph table in the same module: `down` arms are ` ▐` and
// `▝▜`/`█▀`, the open eyes `▛███▛█` start at column 2, the middle row's body
// `█████`, and the feet ` ▝▝   ▝▝ `. Its glyphs span columns 0 to 8, so the text
// column starts at column 11. The effort suffix is the template
// ` with ${level} effort`, unchanged from 2.1.289's. The paths and the plan name
// are invented; the repo is public.

/** The frame as a wide pane draws it, text at column 11 on all three rows. */
export const LOGO_FRAME = [
  ' ▐▛███▛█   Claude Code v2.1.290',
  '▝▜██████▀  Opus 5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   ~/projects/example-app',
  '',
  '────────────────────────────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────────────────────────────'
]

/** What 2.1.290 still appends to a 1M-context id's name (`supports_1m_suffix`). */
export const LOGO_FRAME_WITH_CONTEXT_NOTE = [
  ' ▐▛███▛█   Claude Code v2.1.290',
  '▝▜██████▀  Opus 5 (1M context) with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   ~/projects/example-app'
]

/** A session started with `--agent reviewer`: the third row names the agent. */
export const AGENT_NAME_FRAME = [
  ' ▐▛███▛█   Claude Code v2.1.290',
  '▝▜██████▀  Opus 5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   @reviewer · ~/projects/example-app'
]

/** Fullscreen: the third row ends in the status (` · <status>`). */
export const FULLSCREEN_STATUS_FRAME = [
  ' ▐▛███▛█   Claude Code v2.1.290',
  '▝▜██████▀  Opus 5 with xhigh effort · Claude Max',
  ' ▝▝   ▝▝   ~/projects/example-app · Using flicker-free rendering'
]

/** The older mascot (Claude Code 2.1.2xx), as Orca's own tests pin it. */
export const OLDER_LOGO_FRAME = [
  ' ▐▛███▜▌   Claude Code v2.1.211',
  '▝▜█████▛▘  Sonnet 5 with medium effort · Claude Pro',
  '  ▘▘ ▝▝    ~/projects/example-app'
]

/** The same frame at another model, as a second `claude` in the terminal paints it. */
export const SECOND_RUN_FRAME = [
  ' ▐▛███▛█   Claude Code v2.1.290',
  '▝▜██████▀  Sonnet 5 with low effort · Claude Max',
  ' ▝▝   ▝▝   ~/projects/example-app'
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
