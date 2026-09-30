import type { ScreenTaskCompletion } from './mobile-background-tasks'

/** Completion rows read off the screen, remembered across polls.
 *
 *  Why remember: a row is on screen only until the turn's output scrolls it
 *  away, and the phone polls the screen once a second, so a completion has to
 *  count from the first poll that saw it, not only while it stays visible.
 *
 *  Why a count and not a set: two shells with the same description finish as
 *  two identical rows. What one poll sees is a multiset; the memory keeps,
 *  per row text, the most copies any single poll showed. Two identical rows
 *  never on screen together are counted once — the footer cap catches the
 *  rest — because counting every poll's sighting would count one row every
 *  second.
 *
 *  Why a time per copy: a row stays remembered for the whole session, long
 *  after its shell ended, and Claude often relaunches a command under the
 *  same description. The reader lets a row retire only a launch that had
 *  started by the time the row was first seen (`deriveBackgroundTasks`), so
 *  each copy keeps the phone time of the poll that first showed it. */
export type ScreenCompletionMemory = ReadonlyMap<string, { completion: ScreenTaskCompletion; seenAt: readonly number[] }>

export const EMPTY_SCREEN_COMPLETION_MEMORY: ScreenCompletionMemory = new Map()

/** Bounded like the finished-id memory; the oldest rows go first. */
const MEMORY_MAX = 256

/** Returns the SAME map when this poll showed nothing new, so a subscriber
 *  does not re-render on every read. `now` is the phone time of this poll. */
export function rememberScreenCompletions(
  remembered: ScreenCompletionMemory,
  seen: readonly ScreenTaskCompletion[],
  now: number
): ScreenCompletionMemory {
  const counts = new Map<string, { completion: ScreenTaskCompletion; count: number }>()
  for (const completion of seen) {
    const key = `${completion.status}\u0000${completion.label}`
    const entry = counts.get(key)
    if (entry) {
      entry.count += 1
    } else {
      counts.set(key, { completion: { label: completion.label, status: completion.status }, count: 1 })
    }
  }
  let next: Map<string, { completion: ScreenTaskCompletion; seenAt: readonly number[] }> | null = null
  for (const [key, entry] of counts) {
    const known = remembered.get(key)
    const knownTimes = known?.seenAt ?? []
    if (knownTimes.length >= entry.count) {
      continue
    }
    next ??= new Map(remembered)
    // The copies this poll adds over the most any earlier poll showed were
    // first seen now; the ones already known keep their own time.
    const added = Array.from({ length: entry.count - knownTimes.length }, () => now)
    next.set(key, { completion: known?.completion ?? entry.completion, seenAt: [...knownTimes, ...added] })
  }
  if (next === null) {
    return remembered
  }
  while (next.size > MEMORY_MAX) {
    const oldest = next.keys().next().value
    if (oldest === undefined) {
      break
    }
    next.delete(oldest)
  }
  return next
}

/** The remembered rows as the reader takes them: one entry per copy, each
 *  stamped with when it was first seen, earliest first — the reader hands
 *  each row the oldest launch it can have announced, so the rows seen first
 *  choose first. */
export function screenCompletionsFromMemory(memory: ScreenCompletionMemory): ScreenTaskCompletion[] {
  const out: ScreenTaskCompletion[] = []
  for (const { completion, seenAt } of memory.values()) {
    for (const at of seenAt) {
      out.push({ ...completion, seenAt: at })
    }
  }
  return out.sort((left, right) => (left.seenAt ?? 0) - (right.seenAt ?? 0))
}
