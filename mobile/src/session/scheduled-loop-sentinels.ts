/**
 * The words Claude Code resolves a loop's sentinel prompt into at fire time.
 *
 * `/loop` with no prompt, and a loop.md loop, schedule a task whose stored
 * prompt is a sentinel (`<<autonomous-loop>>` and its kin). The CronCreate
 * call keeps the sentinel (the fire row holds the literal `/loop` or
 * `/loop (loop.md)` instead: `U(task)`, 2.1.286 @48710795), while the turn,
 * and so the desk copy the prompt hook and Orca's status report, carry the
 * words it resolves to (`resolveLoopDefaultFire`, Claude Code 2.1.286). So a
 * desk copy whose words start with one of these is the tick of a loop whose
 * call held a sentinel.
 *
 * Every opener below was read from the 2.1.286 binary (`strings -n 20`,
 * 2026-10-01), not from a transcript: no tick of a sentinel loop has been
 * captured. A build that rewords one only loses the match, and the tick then
 * draws as it did before.
 *
 * One list for all four sentinels: `<<loop.md>>` with no file resolves to the
 * autonomous words, so a family per sentinel missed ticks.
 *
 * What it costs: words a person types that open exactly like these, while a
 * sentinel loop is known, lose their bubble until their own row lands.
 */
const RESOLVED_OPENERS: readonly string[] = [
  // 2.1.286, `<<autonomous-loop>>`; covers "(dynamic pacing)" too.
  '# Autonomous loop tick',
  // 2.1.286 @51301185, the preamble of a first delivery.
  '# Autonomous loop check',
  // 2.1.286, loop.md ticks: "loop.md tasks", "tasks from <path>" (@42177701),
  // "loop.md absent (dynamic pacing)" (@42175943), "… (dynamic pacing)".
  '# /loop tick — '
]

const SENTINELS: ReadonlySet<string> = new Set([
  '<<autonomous-loop>>',
  '<<autonomous-loop-dynamic>>',
  '<<loop.md>>',
  '<<loop.md-dynamic>>'
])

/** Whether `copy` (folded) opens like the tick of the loop whose scheduled
 *  prompt is `scheduled` (folded): false for any prompt that is no sentinel. */
export function resolvesFromSentinel(scheduled: string, copy: string): boolean {
  return SENTINELS.has(scheduled) && RESOLVED_OPENERS.some((opener) => copy.startsWith(opener))
}
