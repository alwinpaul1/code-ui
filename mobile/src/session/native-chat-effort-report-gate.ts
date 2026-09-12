/**
 * Whether an effort the agent reports should replace what the user picked.
 *
 * A model switch repaints the status line a beat later, still carrying the
 * effort from BEFORE the `/effort` the user sent right after it — the drawer
 * steps from the model straight into its effort rows. That repaint is not
 * news about effort; applying it reverted the pick (2026-09-12: Opus at
 * Extra high → Fable, pick Medium, pill stayed at Extra high). An effort that
 * differs from the last one reported is news and still wins.
 */
import type { TrackedNativeChatSessionOption } from '../../../src/shared/native-chat-session-option-state'

const lastReportedEffortByScope = new Map<string, string | null>()

export function shouldApplyReportedEffort(input: {
  scopeKey: string
  reportedEffort: string | null
  /** How the effort the phone currently shows came to be, if it shows one. */
  pickedSource: TrackedNativeChatSessionOption['source'] | null
}): boolean {
  const previous = lastReportedEffortByScope.get(input.scopeKey) ?? null
  lastReportedEffortByScope.set(input.scopeKey, input.reportedEffort)
  if (!input.reportedEffort) {
    return false
  }
  const news = input.reportedEffort !== previous
  return news || input.pickedSource !== 'dispatched'
}

export function resetEffortReportGateForTests(): void {
  lastReportedEffortByScope.clear()
}
