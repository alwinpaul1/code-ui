/**
 * When a host picture that did not come may be asked for again
 * (use-host-image-previews.ts).
 *
 * - A refusal from before the agent's text named the path is not held against
 *   it once the text does. That text is what makes the desktop share a file
 *   outside every workspace (Orca 1.4.224's rule 1), and it lands after the
 *   row that wanted the picture, so holding the cooldown made the thumbnail
 *   wait for the retry timer or the next new row (2026-10-11).
 * - Each refusal waits twice as long as the one before (5 s, 10 s, 20 s… up to
 *   5 min). Every new row re-runs the hook over every picture of the session,
 *   and a long one holds dozens of reads the desktop will never share, which
 *   were asked down the relay every 5 s ahead of the one picture that could
 *   load.
 * - Only the desktop's answer "not shared" backs off. A failed or timed-out ask
 *   is the connection, not the path: it keeps the flat 5 s, so a path is not
 *   held for minutes after the relay comes back.
 */

export const RETRY_MS = 5_000
const MAX_RETRY_MS = 5 * 60_000

type Failure = { until: number; named: boolean; tries: number }
const failures = new Map<string, Failure>()

/** Whether `key` may be asked now, and whether the agent's text has named its
 *  path since it was last refused (which starts its count again). */
export function hostImageAskState(key: string, named: boolean): { allowed: boolean; newlyNamed: boolean } {
  const failure = failures.get(key)
  const newlyNamed = named && failure?.named === false
  return { allowed: !failure || failure.until <= Date.now() || newlyNamed, newlyNamed }
}

/** True when `key` last failed before the agent's text named its path. */
export function refusedBeforeNamed(key: string): boolean {
  return failures.get(key)?.named === false
}

export function recordHostImageFailure(
  key: string,
  args: { refused: boolean; named: boolean; newlyNamed: boolean }
): void {
  const tries = !args.refused || args.newlyNamed ? 1 : (failures.get(key)?.tries ?? 0) + 1
  failures.set(key, {
    until: Date.now() + Math.min(RETRY_MS * 2 ** (tries - 1), MAX_RETRY_MS),
    named: args.named,
    tries
  })
}

export function resetHostImageRefusals(): void {
  failures.clear()
}
