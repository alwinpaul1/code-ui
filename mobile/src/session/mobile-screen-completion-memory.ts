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
 *  second. */
export type ScreenCompletionMemory = ReadonlyMap<string, { completion: ScreenTaskCompletion; count: number }>

export const EMPTY_SCREEN_COMPLETION_MEMORY: ScreenCompletionMemory = new Map()

/** Bounded like the finished-id memory; the oldest rows go first. */
const MEMORY_MAX = 256

/** Returns the SAME map when this poll showed nothing new, so a subscriber
 *  does not re-render on every read. */
export function rememberScreenCompletions(
  remembered: ScreenCompletionMemory,
  seen: readonly ScreenTaskCompletion[]
): ScreenCompletionMemory {
  const counts = new Map<string, { completion: ScreenTaskCompletion; count: number }>()
  for (const completion of seen) {
    const key = `${completion.status}\u0000${completion.label}`
    const entry = counts.get(key)
    if (entry) {
      entry.count += 1
    } else {
      counts.set(key, { completion, count: 1 })
    }
  }
  let next: Map<string, { completion: ScreenTaskCompletion; count: number }> | null = null
  for (const [key, entry] of counts) {
    const known = remembered.get(key)
    if (known && known.count >= entry.count) {
      continue
    }
    next ??= new Map(remembered)
    next.set(key, entry)
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

/** The remembered rows as the reader takes them: one entry per copy. */
export function screenCompletionsFromMemory(memory: ScreenCompletionMemory): ScreenTaskCompletion[] {
  const out: ScreenTaskCompletion[] = []
  for (const { completion, count } of memory.values()) {
    for (let copy = 0; copy < count; copy += 1) {
      out.push(completion)
    }
  }
  return out
}
