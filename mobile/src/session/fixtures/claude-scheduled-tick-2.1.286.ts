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

/**
 * The words the fire row holds for a prompt: `mon` writes `prompt: V3(task.prompt, 200)` in 2.1.286
 * (`H4(task.prompt, 200)` in 2.1.288, the same code under other minified names), and that is
 * `cut200(strip(trim(replace(/\s+/g, ' ', ansiStripped))))`: a line break, a tab or a run of spaces
 * becomes ONE space, the ends are trimmed, control, format, surrogate and default-ignorable
 * characters are dropped, and the cut is at 200 UTF-16 units (never leaving half a pair).
 * MODELLED FROM THE BINARY (strings of both builds, 2026-10-03), not read from a transcript: the one
 * real record had a first line longer than 200 characters, so no line break fell inside the row.
 * Fixtures used to cut the raw text with `slice(0, 200)`, which Claude Code never writes, and the
 * hook's comparison agreed with that invention (2026-10-03).
 */
export function fireRowWords(prompt: string): string {
  const control = /[\x00-\x08\x0E-\x1F\x7F-\x9F]/g
  const dropped = /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu
  const folded = prompt.replace(control, '').replace(/\s+/g, ' ').trim().replace(dropped, '').trim()
  if (folded.length <= 200) {
    return folded
  }
  const cut = folded.slice(0, 200)
  const last = cut.charCodeAt(199)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** The two rows a tick writes (`firePrompt`: what the fire row holds when it is
 *  not the tick's words: a sentinel loop's fire row holds `/loop` or
 *  `/loop (loop.md)`, since `mon` writes `U(task)`, which swaps a sentinel for
 *  those literals (2.1.286 @48710795), while the turn holds the RESOLVED words), with the field names and order read from
 *  session 76ba8f2f (rows 36098 and 36099), compact JSON as Claude Code
 *  writes it. The system row's `prompt` is the first 200 characters, cut
 *  with no mark. */
export function tickRows(prompt: string = TICK_PROMPT, firePrompt: string = prompt): string[] {
  const fire = {
    parentUuid: '814f7e30-6c7d-41b8-b81a-6c46843c1f51',
    isSidechain: false,
    type: 'system',
    subtype: 'scheduled_task_fire',
    content: 'Running scheduled task (Oct 1 4:21am)',
    isMeta: false,
    timestamp: '2026-10-01T02:21:49.587Z',
    uuid: '56252db0-3009-42e7-853d-62f274c7e204',
    taskId: '8b72dbfd',
    cron: '*/3 * * * *',
    prompt: fireRowWords(firePrompt),
    userType: 'external'
  }
  const user = {
    parentUuid: fire.uuid,
    isSidechain: false,
    promptId: '59f9f05d-3edb-4e38-85b5-8e6236525cf8',
    type: 'user',
    message: { role: 'user', content: prompt },
    isMeta: true,
    uuid: '93976243-587f-4f75-8231-8a3e5fbb03d3',
    timestamp: '2026-10-01T02:21:49.608Z',
    promptSource: 'system',
    scheduledTaskId: '8b72dbfd',
    scheduledFireId: fire.uuid,
    turnOrigin: 'scheduled'
  }
  return [JSON.stringify(fire), JSON.stringify(user)]
}
