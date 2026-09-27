import { isKnownHarnessInjectedUserTurnText } from '../../../src/shared/harness-injected-user-turns'
import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'

/**
 * A desk prompt the tab status carried past the end of a turn, placed in the
 * run it came in when the transcript shows who started each turn after.
 *
 * Orca keeps a person's prompt through a turn a harness message starts, so a
 * prompt found on the status after such a turn cannot be told, from the
 * status alone, from the same words sent again; it is held back
 * (agent-status-prompts.ts, runItCameIn). But a teammate's or another
 * session's message is a user row Orca publishes, and the phone holds it: one
 * at the start of the run after each turn end, with no person's row there,
 * proves the prompt was carried, not sent again, so it belongs to the run it
 * came in (combined review of 30c94116: with background agents that is most
 * turns). A subagent's hand-back leaves no such row, and a prompt it carried
 * stays held. Placed by the run's start, as any prompt found on the status is.
 */
export function placedByHarnessTurns(
  prompts: readonly DesktopPrompt[],
  rows: readonly NativeChatMessage[]
): readonly DesktopPrompt[] {
  let placed: DesktopPrompt[] | null = null
  prompts.forEach((prompt, index) => {
    const hint = prompt.heldBack === true ? prompt.ifHarnessStarted : undefined
    if (hint && hint.crossings.every((crossing) => harnessStartedBetween(rows, crossing.after, crossing.before))) {
      const { heldBack: _held, ifHarnessStarted: _hint, ...rest } = prompt
      placed ??= [...prompts]
      // Its own nonce, by its run: the held one (`status:<session>:x:<n>`) is
      // what every mount gives its first held copy, and a copy placed in a
      // later mount took the first one's remembered anchor, a turn early
      // (review of 0a70f90a).
      placed[index] = { ...rest, nonce: prompt.nonce.replace(/:x:(\d+)$/, `:${hint.at}:$1`), at: hint.at, atStateStart: true }
    }
  })
  return placed ?? prompts
}

/** How far a row's stamp may sit from Orca's hook clock for the same moment. */
const HOOK_CLOCK_SLACK_MS = 1_000
/** How long after the hook took a turn's first message its row can be stamped. */
const ROW_AFTER_HOOK_MS = 5_000

/** Whether the rows show a harness message, and no person's words, starting
 *  the run that began between `after` (the turn end) and `before` (the next
 *  run's start). */
function harnessStartedBetween(rows: readonly NativeChatMessage[], after: number, before: number): boolean {
  const texts = rows.flatMap((row) =>
    row.role === 'user' && row.timestamp !== null && row.timestamp >= after - HOOK_CLOCK_SLACK_MS && row.timestamp <= before + ROW_AFTER_HOOK_MS
      ? [row.blocks.filter(isTextBlock).map((block) => block.text).join('').trim()]
      : []
  ).filter((text) => text.length > 0)
  return texts.length > 0 && texts.every((text) => isKnownHarnessInjectedUserTurnText(text))
}
