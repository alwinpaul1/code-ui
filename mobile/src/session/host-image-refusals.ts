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

/** `named`: the agent's text named the path at all; `cleanly`: as the
 *  desktop's rule 1 accepts it. A loose mention (a markdown link, parentheses)
 *  is refused like none, so a clean one after it starts the count again too:
 *  it is the reply the placeholder's ask waits for (agent-image-share-ask.ts). */
type Failure = { until: number; named: boolean; cleanly: boolean; tries: number }
const failures = new Map<string, Failure>()

/** Whether `key` may be asked now, and whether the agent's text has named its
 *  path since it was last refused (which starts its count again). */
export function hostImageAskState(key: string, named: boolean, cleanly = false): { allowed: boolean; newlyNamed: boolean } {
  const failure = failures.get(key)
  const newlyNamed = (named && failure?.named === false) || (cleanly && failure?.cleanly === false)
  return { allowed: !failure || failure.until <= Date.now() || newlyNamed, newlyNamed }
}

/** True when `key` last failed before the agent's text named its path (or,
 *  with `cleanly`, before it named it the way the desktop accepts). */
export function refusedBeforeNamed(key: string, cleanly = false): boolean {
  const failure = failures.get(key)
  return failure?.named === false || (cleanly && failure?.cleanly === false)
}

export function recordHostImageFailure(
  key: string,
  args: { refused: boolean; named: boolean; cleanly?: boolean; newlyNamed: boolean }
): void {
  const tries = !args.refused || args.newlyNamed ? 1 : (failures.get(key)?.tries ?? 0) + 1
  failures.set(key, {
    until: Date.now() + Math.min(RETRY_MS * 2 ** (tries - 1), MAX_RETRY_MS),
    named: args.named,
    cleanly: args.cleanly === true,
    tries
  })
}

/** Why the last ask for a picture brought nothing: the desktop answered and
 *  would not share it, or the ask failed (the connection, a file it could not
 *  read, a file that is not an image). No entry: it came, or no answer is in
 *  yet. */
export type HostImageMissing = 'not-shared' | 'failed'
const missingByPath = new Map<string, HostImageMissing>()
const missingListeners = new Set<() => void>()

/** Keyed by path alone, as the placeholder that reads it knows no host. Two
 *  hosts holding one path share an entry, and the latest answer wins: the
 *  chat on screen re-asks its own host while a picture is missing, so within
 *  one ask the answer it reads is its own. */
export function recordHostImageMissing(path: string, why: HostImageMissing | undefined): void {
  if (missingByPath.get(path) === why) {
    return
  }
  if (why) {
    missingByPath.set(path, why)
  } else {
    missingByPath.delete(path)
  }
  for (const listener of missingListeners) {
    listener()
  }
}

/** What a picture's placeholder can say about it (MobileNativeChatProse.tsx). */
export function hostImageMissing(path: string | undefined): HostImageMissing | undefined {
  return path ? missingByPath.get(path) : undefined
}

/** For `useSyncExternalStore`: an open note follows an answer that comes in
 *  after it opened. */
export function subscribeHostImageMissing(listener: () => void): () => void {
  missingListeners.add(listener)
  return () => {
    missingListeners.delete(listener)
  }
}

export function resetHostImageRefusals(): void {
  failures.clear()
  missingByPath.clear()
}
