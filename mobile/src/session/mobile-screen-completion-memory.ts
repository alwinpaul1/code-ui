import type { LabelledShellLaunch } from './mobile-background-task-evidence'
import { foldWhitespace } from './mobile-background-task-transcript'
import type { ScreenTaskCompletion } from './mobile-background-tasks'

/** Completion rows read off the screen, remembered across polls.
 *
 *  Why remember: a row is on screen only until the turn's output scrolls it
 *  away, and the phone polls the screen once a second, so a completion has to
 *  count from the first poll that saw it, not only while it stays visible.
 *
 *  Why a count and not a set: two shells with the same description finish as
 *  two identical rows. What one poll sees is a multiset; the memory keeps,
 *  per row text, the most copies any single poll showed, because counting
 *  every poll's sighting would count one row every second.
 *
 *  A row that left the screen and is back is a new copy only when the window
 *  has gained a launch with its label since the row's latest copy was bound
 *  (one copy per such launch, up to the rows on screen): a relaunch's own
 *  row reads word for word like the first run's, and on 2026-09-30 it was
 *  counted as the first row still remembered, so the relaunch never
 *  finished. With no new launch the row back on screen is the same one — a
 *  blank repaint, a dialog, a scroll — and a second copy would retire a
 *  shell that still runs. So two identical rows never on screen together,
 *  for two launches the window held from the first, are counted once; the
 *  footer cap catches the rest. A row hidden and shown again after a
 *  relaunch reads as that relaunch's row: the screen cannot tell the two
 *  apart.
 *
 *  Why each copy is bound to launches: a row stays remembered for the whole
 *  session, long after its shell ended, and Claude often relaunches a command
 *  under the same description. A copy may retire only a shell launch with its
 *  label that the settled transcript window held when the copy was first
 *  seen (`deriveBackgroundTasks`), so a remembered row never retires a
 *  relaunch that came after it. Ids, not times: a launch is stamped by the
 *  desk's clock and a poll by the phone's, and on 2026-09-30 a phone 5 s
 *  behind the desk left a 1.5 s shell running because its row looked older
 *  than its launch. Ids stay the same while the window slides.
 *
 *  A copy first seen while the window held NO launch with its label was
 *  painted before the phone's transcript read reached the launch (a shell
 *  that ends within a poll or two). It is bound to the first such launch the
 *  window shows later; until then it retires nothing. One first seen while
 *  the window held such a launch, settled or not, is never bound to a later
 *  one: that is a remembered row meeting a relaunch.
 *
 *  Not covered: a row already on screen at the phone's first look, in a tab
 *  opened after a relaunch, is bound to both runs and can retire the
 *  relaunch once the first run is settled. Which run such a row announced
 *  cannot be told from the row. */
export type ScreenCompletionMemory = {
  /** Every copy, in the order first seen. The same array until a copy is
   *  added or bound, so the rows handed on stay the same object. */
  copies: readonly RememberedCopy[]
  /** The row texts the last poll folded in showed. */
  onScreen: ReadonlySet<string>
}

type RememberedCopy = {
  key: string
  completion: ScreenTaskCompletion
  /** The launches with the row's label the window held when the copy was
   *  first seen, oldest first; null while it has held none. */
  launchIds: readonly string[] | null
}

export const EMPTY_SCREEN_COMPLETION_MEMORY: ScreenCompletionMemory = { copies: [], onScreen: new Set() }

/** Bounded like the finished-id memory; the oldest copies go first. */
const MEMORY_MAX = 256

/** Folds one screen poll into the memory. `launches` is the settled
 *  transcript window's labelled shell launches, oldest first; the caller
 *  skips a poll made over an unsettled one (a cached tail painted while the
 *  fresh read loads does not hold what was launched meanwhile). Returns the
 *  SAME memory when this poll changed nothing, so a subscriber does not
 *  re-render on every read. */
export function rememberScreenCompletions(
  remembered: ScreenCompletionMemory,
  seen: readonly ScreenTaskCompletion[],
  launches: readonly LabelledShellLaunch[]
): ScreenCompletionMemory {
  const bound = bindWaitingCopies(remembered.copies, launches)
  let copies: RememberedCopy[] | null = bound === remembered.copies ? null : [...bound]
  const counts = countByKey(seen)
  for (const [key, { completion, count }] of counts) {
    const known = bound.filter((copy) => copy.key === key)
    const ids = launchIdsFor(completion.label, launches)
    const latest = known.at(-1)
    const back = latest !== undefined && !remembered.onScreen.has(key) ? Math.min(count, launchedSince(latest, ids)) : 0
    const added = Math.max(count - known.length, back)
    if (added <= 0) {
      continue
    }
    // The copies this poll adds were first seen now: they may retire only
    // what the window holds now.
    copies ??= [...bound]
    for (let extra = 0; extra < added; extra += 1) {
      copies.push({ key, completion, launchIds: ids.length > 0 ? ids : null })
    }
  }
  const onScreen = sameKeys(remembered.onScreen, counts) ? remembered.onScreen : new Set(counts.keys())
  if (copies === null && onScreen === remembered.onScreen) {
    return remembered
  }
  const kept = copies ?? remembered.copies
  return { copies: kept.length > MEMORY_MAX ? kept.slice(kept.length - MEMORY_MAX) : kept, onScreen }
}

/** The remembered rows as the reader takes them: one entry per copy, in the
 *  order first seen, each with the launches it may retire. A copy still
 *  waiting for its launch may retire none. */
export function screenCompletionsFromMemory(memory: Pick<ScreenCompletionMemory, 'copies'>): ScreenTaskCompletion[] {
  return memory.copies.map(({ completion, launchIds }) => ({ ...completion, launchIds: launchIds ?? [] }))
}

function countByKey(seen: readonly ScreenTaskCompletion[]): Map<string, { completion: ScreenTaskCompletion; count: number }> {
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
  return counts
}

/** How many of `ids` (the window's launches with the row's label, oldest
 *  first) came after every launch the copy was bound to. Launches paged in
 *  from above the window sit before those and are not new; once the copy's
 *  own have slid out of the window, every one left is. A copy still waiting
 *  has seen none, and is bound before this is asked. */
function launchedSince(copy: RememberedCopy, ids: readonly string[]): number {
  const knew = copy.launchIds
  if (knew === null) {
    return 0
  }
  return ids.length - (ids.findLastIndex((id) => knew.includes(id)) + 1)
}

function sameKeys(shown: ReadonlySet<string>, counts: ReadonlyMap<string, unknown>): boolean {
  return shown.size === counts.size && [...counts.keys()].every((key) => shown.has(key))
}

function launchIdsFor(label: string, launches: readonly LabelledShellLaunch[]): string[] {
  const folded = foldWhitespace(label)
  return launches.filter((launch) => launch.label === folded).map((launch) => launch.id)
}

/** Binds each copy still waiting for its launch to the first launch with its
 *  label the window now shows — one launch per copy, in order, so two rows
 *  painted before either launch was read take one launch each. Only the
 *  first: were a copy bound to all of them, one whose own launch had settled
 *  would go on to retire the next. The same array when none was bound. */
function bindWaitingCopies(copies: readonly RememberedCopy[], launches: readonly LabelledShellLaunch[]): readonly RememberedCopy[] {
  if (!copies.some((copy) => copy.launchIds === null)) {
    return copies
  }
  // Per label, not per row text: a `completed` and a `failed` row with one
  // label name launches from the same list.
  const taken = new Map<string, number>()
  let changed = false
  const next = copies.map((copy) => {
    if (copy.launchIds !== null) {
      return copy
    }
    const label = foldWhitespace(copy.completion.label)
    const index = taken.get(label) ?? 0
    const id = launchIdsFor(label, launches)[index]
    if (id === undefined) {
      return copy
    }
    taken.set(label, index + 1)
    changed = true
    return { ...copy, launchIds: [id] }
  })
  return changed ? next : copies
}
