// ─── A recurring CronCreate prompt and the tick it fires, Claude Code 2.1.286 ──
//
// Reported 2026-10-01 from the user's screenshots: every tick of a 3-minute
// loop drew in the chat as a user bubble, its words cut at 200 characters,
// while the Claude app drew no bubble at all for it.
//
// PROVENANCE. The record SHAPES are read from session 76ba8f2f's transcript
// (Claude Code 2.1.286, task 8b72dbfd, 2026-10-01 02:21:49Z); the WORDS are
// stand-ins, since this repository is public and the real prompt names the
// user's host and plans. What was read, and is kept here:
//   - CronCreate's input is `{ cron: '*/3 * * * *', recurring: true, prompt }`;
//     that prompt was 1,994 characters over many lines.
//   - Each tick writes a `system` row (subtype `scheduled_task_fire`, its
//     `prompt` cut at 200), then a `user` row with `isMeta: true`,
//     `promptSource: 'system'`, `turnOrigin: 'scheduled'` and
//     `scheduledTaskId`, whose content is the CronCreate prompt BYTE FOR BYTE
//     (every fired row of task 39f9ec31 compared equal, 2026-10-01). Orca's
//     decoder draws nothing for either row, so the phone never sees them.
//   - The UserPromptSubmit hook fires for the tick with nothing that says it
//     was scheduled (2.1.286's payload: the common fields, `prompt`,
//     `session_title`), so Orca's `agentStatus.prompt` carries the tick like a
//     typed prompt: folded to one line and cut at 200 (normalizePromptField).
//   - A prompt over the mobile diet's 4,000 characters reaches the phone cut,
//     ending `… (truncated)` (mobile-native-chat-edit-wire-cut.ts); four of
//     this session's CronCreate prompts were over 5,000 characters.

export const TICK_LINES = [
  'READ-ONLY WATCH of the build host (3-minute tick) while the fix is being designed. CHANGE NOTHING and cancel nothing (note, 1 Oct ~03:10: stop the queued jobs, ask for a plan, then resubmit; until that is done this watcher only reads and records).',
  "Use ssh -o ConnectTimeout=15 build bash -s <<'EOF' with one read-only script: squeue for our jobs, sacct for the last six hours, and the newest line of each run's log.",
  '',
  'Each tick:',
  '1. List the jobs still queued or running, with their elapsed time and limit.',
  '2. For a job that finished since the last tick, record its exit state and its last checkpoint.',
  "3. For a job running past 90% of its limit with no checkpoint, say so in one line; do not touch it.",
  '',
  'Report in two lines at most when nothing changed: "No change:" and the elapsed times.'
]

/** About 2,000 characters over many lines, as the real one was. */
export const TICK_PROMPT = [...TICK_LINES, '', ...Array.from({ length: 13 }, (_, i) => `Note ${i + 1}: ${TICK_LINES[4]}`)].join('\n')

/** The tool call that set the loop up, as the phone's transcript read draws it. */
export const CRON_CREATE_INPUT = { cron: '*/3 * * * *', recurring: true, prompt: TICK_PROMPT }
