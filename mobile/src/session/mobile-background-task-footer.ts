import type { BackgroundTask, BackgroundTasks } from './mobile-background-tasks'

// ─── The agent's own footer count of shells, fitted to the named list ────────
//
// Claude Code's footer ("⏵⏵ auto mode on · 4 shells · ← for agents") counts the
// background shells in its one task registry live and in full. Two limits
// shape how the phone may use it:
//
//   - It is not the lead's count alone. The pill is filtered by kind only (no
//     local_workflow, no ambient monitor, no agents while the agent panel is
//     on: `yX` in 2.1.281, `MJ` in 2.1.283), never by owner, and every
//     subagent shares the lead's registry — so a shell a reviewer started is
//     in it. Session 967668df, 2026-09-26 00:00:05: footer 6, the lead's own 2.
//   - It is only on screen while the composer's footer is: a question or a
//     permission dialog covers it and the reading goes null.
//
// So it is a cap for the lead's named shells always (the lead's own can never
// exceed the whole registry's), and a reading once taken keeps capping the
// shells launched before it. It is the floor for the lead's shells while no
// subagent runs; while one does, the floor is what the lead was last seen to
// have alone, since those shells can only finish.

/** A footer reading kept after the footer left the screen: at `at` (phone
 *  clock) no more than `count` shells were running, so no more than that many
 *  of the shells launched before then can still be. */
export type HeldShellCount = { count: number; at: number }

/** Longer than the idle screen poll (5 s), so a launch the footer has not yet
 *  been re-read with is not retired by its count. */
export const COUNT_RETIRE_GRACE_MS = 10_000

export type ShellCountFit = {
  /** The footer's count as the screen shows it now; null when it is not on
   *  screen (no footer row, a dialog over it, or no shell running at all). */
  live: number | null
  /** The last reading, for while `live` is null. */
  held?: HeldShellCount | null
  /** Whether any subagent is running, the session's own or not: then the
   *  footer holds shells the phone can never name. */
  subagentRunning: boolean
  /** The last reading taken while no subagent ran, when every shell in it was
   *  the lead's. While one runs, the lead's unnamed shells are those — they
   *  can only finish — and no more than the footer still counts. */
  leadOnly?: HeldShellCount | null
}

/** Fits the phone's named list to the agent's footer count, both ways.
 *
 *  Up (2026-09-14): a shell launched further back than the beacon's tail can
 *  reach, on a huge session, is shown as an unnamed running shell rather than
 *  dropped, so the count matches the desk. Only from a live reading, and
 *  while a subagent runs only up to what the lead was last seen to have.
 *
 *  Down (2026-09-20): when the footer counts FEWER, some named shell finished
 *  unseen — every mid-turn completion on a hand-started tab, where there is no
 *  beacon and the completion is an attachment record Orca's reader drops.
 *  WHICH one the phone cannot know, so the oldest are retired as `finished`:
 *  over, outcome unseen. Shells only in both directions. */
export function fitToOnScreenShellCount(tasks: BackgroundTasks, now: number, fit: ShellCountFit): BackgroundTasks {
  // While a monitor runs, nothing is fitted either way. Claude Code 2.1.284's
  // pill counts monitors apart ("N shells, M monitors", or "N background
  // tasks" for a mix, by its binary; docs/mobile-background-tasks.md), no
  // screen of that pill has been captured, and FOOTER_SHELL_COUNT reads only
  // its leading "N shells". A count read off a pill of unknown wording would
  // retire or pad the wrong row, so none is used.
  if (tasks.running.some((task) => task.kind === 'monitor')) {
    return tasks
  }
  if (fit.live !== null) {
    const named = tasks.running.filter((task) => task.kind === 'shell').length
    if (named > fit.live) {
      // A shell launched within the grace is never retired: the transcript is
      // pushed and the screen polled, so its launch can be named before the
      // footer has been re-read with it counted, and retiring it would flip
      // the row to finished and back a second later.
      return retireOldest(tasks, named - fit.live, (task) => task.startedAt === null || now - task.startedAt >= COUNT_RETIRE_GRACE_MS)
    }
    const floor = fit.subagentRunning ? leadFloor(tasks, fit.leadOnly ?? null, fit.live) : fit.live
    return named < floor ? pad(tasks, floor - named) : tasks
  }
  const held = fit.held ?? null
  if (held === null) {
    return tasks
  }
  const readBefore = (task: BackgroundTask) => task.startedAt === null || task.startedAt <= held.at - COUNT_RETIRE_GRACE_MS
  const eligible = tasks.running.filter((task) => task.kind === 'shell' && readBefore(task)).length
  return eligible > held.count ? retireOldest(tasks, eligible - held.count, readBefore) : tasks
}

/** How many shells the lead can have running while a subagent runs: its
 *  named ones, plus at most the UNNAMED ones it had when the footer last
 *  counted its shells alone — those can only finish. That is the reading less
 *  every named shell launched before it, running or finished since (the
 *  footer paints nothing at 0, so a reading never learns they ended); a named
 *  shell that had already finished by then only makes the figure smaller.
 *  Never more than the footer counts now. None known, none padded. */
function leadFloor(tasks: BackgroundTasks, leadOnly: HeldShellCount | null, live: number): number {
  const named = tasks.running.filter((task) => task.kind === 'shell').length
  if (leadOnly === null) {
    return named
  }
  const namedBefore = [...tasks.running, ...tasks.finished].filter(
    (task) => task.kind === 'shell' && !task.id.startsWith('onscreen-shell-') && task.startedAt !== null && task.startedAt <= leadOnly.at
  ).length
  return Math.min(live, named + Math.max(0, leadOnly.count - namedBefore))
}

function retireOldest(tasks: BackgroundTasks, surplus: number, retirable: (task: BackgroundTask) => boolean): BackgroundTasks {
  // Running is in launch order, oldest first; the surplus is taken from the
  // front, so the shells most recently launched keep their rows.
  let toRetire = surplus
  const running: BackgroundTask[] = []
  const retired: BackgroundTask[] = []
  for (const task of tasks.running) {
    if (task.kind === 'shell' && toRetire > 0 && retirable(task)) {
      toRetire -= 1
      retired.push({ ...task, status: 'finished', elapsedMs: null })
    } else {
      running.push(task)
    }
  }
  // Newest-first, like the rest of the finished list; these ended at an
  // unknown time after their launch, so they go ahead of the notified ones.
  return { running, finished: [...retired.toReversed(), ...tasks.finished] }
}

function pad(tasks: BackgroundTasks, missing: number): BackgroundTasks {
  const filler: BackgroundTask[] = Array.from({ length: missing }, (_unused, index) => ({
    id: `onscreen-shell-${index}`,
    kind: 'shell',
    title: 'Background shell',
    status: 'running',
    startedAt: null,
    elapsedMs: null
  }))
  return { running: [...tasks.running, ...filler], finished: tasks.finished }
}

/** How many of the shells the footer counts are not the lead's, once the
 *  named list has been fitted to it: shells running inside subagents (a
 *  reviewer's included, as the footer counts them), which only those agents'
 *  own transcripts name. Claude Code 2.1.296, 2026-10-10: two background
 *  agents each running a `sleep 150` painted "· 2 shells" while the lead had
 *  started none (docs/subagent-task-visibility.md).
 *
 *  Zero whenever the footer is not on screen, or a monitor runs (the pill's
 *  wording is then unknown, as above). While no subagent runs the fit pads
 *  the lead up to the footer, so nothing is left over. A count only: nothing
 *  the phone receives names these shells or says what they run. */
export function shellsOutsideLead(fitted: BackgroundTasks, live: number | null): number {
  if (live === null || fitted.running.some((task) => task.kind === 'monitor')) {
    return 0
  }
  const leadShells = fitted.running.filter((task) => task.kind === 'shell').length
  return Math.max(0, live - leadShells)
}

/** The sheet's muted line for those shells. */
export function subagentShellsLabel(count: number): string {
  return `+${count} ${count === 1 ? 'shell' : 'shells'} in subagents`
}
