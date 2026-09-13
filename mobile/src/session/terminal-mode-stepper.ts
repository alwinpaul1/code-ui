/**
 * Steps an agent through its Shift+Tab mode cycle until the footer shows the
 * wanted mode.
 *
 * The first version pressed, slept a fixed 450 ms, and re-read. When the TUI
 * repainted late (a busy agent, a slow relay), the re-read still showed the OLD
 * mode, so it pressed again — overshooting past the pick, then circling back
 * on the next lap. That is the "mode switching glitches sometimes" the user
 * saw: the footer flicked through modes it was never asked for. After a press,
 * this waits for the footer to CHANGE (or a settle cap) before judging it, so
 * one press is one step.
 */
export type TerminalModeStep<Mode extends string> = {
  /** Reads the footer; null when the screen could not be read this time. */
  read: () => Promise<Mode | null>
  /** Sends one Shift+Tab. */
  press: () => Promise<void>
  wait: (ms: number) => Promise<void>
  wanted: Mode
  /** Modes in the cycle at most; one more press than this is a wasted lap. */
  maxPresses: number
  /** Longest to wait for the footer to change after a press. */
  settleMs?: number
  pollMs?: number
  /** Wall-clock ceiling for the whole run. Each `read()` is a relay round trip,
   *  so counting polls alone bounded nothing: a slow link turned six presses
   *  into 85 reads and minutes of Shift+Tab (2026-09-14). */
  budgetMs?: number
  now?: () => number
}

/** True once the footer shows `wanted`; false after `maxPresses` without it. */
export async function stepTerminalMode<Mode extends string>(
  step: TerminalModeStep<Mode>
): Promise<boolean> {
  const settleMs = step.settleMs ?? 1500
  const pollMs = step.pollMs ?? 120
  const now = step.now ?? Date.now
  const deadline = now() + (step.budgetMs ?? 8000)
  let current = await step.read()
  if (current === step.wanted) {
    return true
  }
  for (let presses = 0; presses < step.maxPresses; presses += 1) {
    if (now() >= deadline) {
      return false
    }
    await step.press()
    // Wait for the footer to move off the mode it showed before the press.
    // A null read is "could not see", not "unchanged", and does not count.
    let seen: Mode | null = null
    const settleBy = Math.min(now() + settleMs, deadline)
    while (now() < settleBy) {
      await step.wait(pollMs)
      seen = await step.read()
      if (seen !== null && seen !== current) {
        break
      }
    }
    if (seen === null) {
      // Never saw the footer after the press; take one more look before giving
      // up on this step, so a slow screen does not turn into a wasted lap.
      seen = await step.read()
    }
    if (seen === step.wanted) {
      return true
    }
    current = seen ?? current
  }
  return false
}
