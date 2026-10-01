/**
 * The words Claude Code resolves a loop's sentinel prompt into at fire time.
 *
 * `/loop` with no prompt, and a loop.md loop, schedule a task whose stored
 * prompt is a sentinel (`<<autonomous-loop>>` and its kin). The fire row and
 * the CronCreate call keep the sentinel; the turn, and so the desk copy the
 * prompt hook and Orca's status report, carry the words it resolves to
 * (`resolveLoopDefaultFire`, Claude Code 2.1.286). So a desk copy whose words
 * start with one of these is the tick of a loop whose call held the sentinel.
 *
 * Every opener below was read from the 2.1.286 binary (`strings -n 20`,
 * 2026-10-01), not from a transcript: no tick of a sentinel loop has been
 * captured. A build that rewords one only loses the match, and the tick then
 * draws as it did before.
 *
 * The first delivery of a loop is prefixed with a preamble instead of the
 * tick's own heading: `# Autonomous loop check`, or for loop.md `The user
 * configured a loop-tasks file.`
 *
 * What it costs: words a person types that open exactly like these, while a
 * sentinel loop is known, lose their bubble until their own row lands.
 */
const AUTONOMOUS_OPENERS: readonly string[] = [
  // 2.1.286, `<<autonomous-loop>>`; the dynamic form's
  // `# Autonomous loop tick (dynamic pacing)` starts with it too.
  '# Autonomous loop tick',
  // 2.1.286, the preamble of the first delivery.
  '# Autonomous loop check'
]

const LOOP_MD_OPENERS: readonly string[] = [
  // 2.1.286, `<<loop.md>>` and `<<loop.md-dynamic>>`.
  '# /loop tick — loop.md tasks',
  // 2.1.286, the preamble of the first delivery.
  'The user configured a loop-tasks file.'
]

/** Each sentinel, folded as the prompts are, and what its tick opens with. */
const OPENERS_BY_SENTINEL: ReadonlyMap<string, readonly string[]> = new Map([
  ['<<autonomous-loop>>', AUTONOMOUS_OPENERS],
  ['<<autonomous-loop-dynamic>>', AUTONOMOUS_OPENERS],
  ['<<loop.md>>', LOOP_MD_OPENERS],
  ['<<loop.md-dynamic>>', LOOP_MD_OPENERS]
])

/** Whether `copy` (folded) opens like the tick of the loop whose scheduled
 *  prompt is `scheduled` (folded): false for any prompt that is no sentinel. */
export function resolvesFromSentinel(scheduled: string, copy: string): boolean {
  const openers = OPENERS_BY_SENTINEL.get(scheduled)
  return openers !== undefined && openers.some((opener) => copy.startsWith(opener))
}
