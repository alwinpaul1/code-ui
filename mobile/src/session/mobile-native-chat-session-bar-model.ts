// What the session bar above the composer shows, as the Claude Android app
// (1.261009.20) draws it: a todo pill ("N/M tasks" beside a progress ring)
// that opens the todo card, and a diff pill ("Diff +A -R") that opens the
// changes. Pure, so the counts and wording are tested without a renderer.

import type { NativeChatTaskList } from '../../../src/shared/native-chat-task-list'
import type { MobileGitStatusResult } from '../source-control/mobile-git-status'

export type SessionDiffTotals = { files: number; added: number; removed: number }

/**
 * The worktree's uncommitted change, summed over git.status's rows. A file
 * staged and changed again has a row per area, and each counts its own lines,
 * so the sum is the whole uncommitted diff. A row without counts (a binary
 * file) still makes the pill show; it adds no lines. Null when nothing is
 * changed, or when status could not be read: the pill is then left out rather
 * than drawn with a zero nobody measured.
 */
export function sessionDiffTotals(status: MobileGitStatusResult | null): SessionDiffTotals | null {
  const entries = status?.entries ?? []
  if (entries.length === 0) {
    return null
  }
  let added = 0
  let removed = 0
  for (const entry of entries) {
    added += Number.isFinite(entry.added) ? (entry.added as number) : 0
    removed += Number.isFinite(entry.removed) ? (entry.removed as number) : 0
  }
  return { files: new Set(entries.map((entry) => entry.path)).size, added, removed }
}

export type TodoPillModel = {
  completed: number
  total: number
  /** `ccr_thread_todos_pill`: "%1$d/%2$d tasks". */
  label: string
  /** `ccr_thread_todos_spoken_count`: "1 of 3 tasks done". */
  spoken: string
  allDone: boolean
}

export function todoPillModel(list: NativeChatTaskList | null): TodoPillModel | null {
  if (!list || list.tasks.length === 0) {
    return null
  }
  const total = list.tasks.length
  const completed = list.tasks.filter((task) => task.status === 'completed').length
  return {
    completed,
    total,
    label: `${completed}/${total} tasks`,
    spoken: `${completed} of ${total} ${total === 1 ? 'task' : 'tasks'} done`,
    allDone: completed === total
  }
}

/** `ccr_thread_todos_card_title`. */
export function todoCardTitle(model: TodoPillModel): string {
  return `${model.completed}/${model.total} tasks complete`
}

/** The row the card opens on: the first one running, else the first still to
 *  do; -1 when every task is done and the card can stay at the top. */
export function todoCardFocusIndex(list: NativeChatTaskList): number {
  const running = list.tasks.findIndex((task) => task.status === 'in_progress')
  return running !== -1 ? running : list.tasks.findIndex((task) => task.status === 'pending')
}

/** The diff pill's counts, each left out at zero (the app hides a zero). */
export function diffPillCounts(totals: SessionDiffTotals): { added: string | null; removed: string | null } {
  return {
    added: totals.added > 0 ? `+${totals.added}` : null,
    removed: totals.removed > 0 ? `-${totals.removed}` : null
  }
}
