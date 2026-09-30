import { useMemo } from 'react'
import type { LabelledShellLaunch } from './mobile-background-task-evidence'
import type { ScreenTaskCompletion } from './mobile-background-tasks'
import {
  EMPTY_SCREEN_COMPLETION_MEMORY,
  rememberScreenCompletions,
  screenCompletionsFromMemory,
  type ScreenCompletionMemory
} from './mobile-screen-completion-memory'

const NONE: readonly ScreenTaskCompletion[] = []

/** Per terminal and session, for as long as the app runs, bounded like the
 *  task evidence (`use-active-tab-task-report.ts`). Why not per mount: the
 *  chat unmounts for the Files tab and a tab switch hands the hook another
 *  terminal, and a memory wiped by either met run 1's row, still on screen,
 *  as new — bound to the relaunch too, so it retired the relaunch while it
 *  ran (2026-09-30). Keyed by both: a new session in the same terminal starts
 *  with none, so one session's rows never retire another's shells. */
const memories = new Map<string, ScreenCompletionMemory>()
const MEMORY_SESSIONS_MAX = 16

export function resetScreenCompletionsForTests(): void {
  memories.clear()
}

/** Folds this render's poll into the memory for the terminal and session.
 *  Nothing is folded while the screen is unread (`seen` null: a remount or a
 *  tab switch before its first read, a dropped connection) — an unread
 *  screen is not a screen without the row — nor while the transcript window
 *  is not settled (`launches` null), since each new copy is bound to the
 *  launches the window holds (`mobile-screen-completion-memory.ts`). The
 *  clock is read here, not in the hook, as `observeSession` does in
 *  `use-active-tab-task-report.ts`. */
function recall(
  handle: string | null,
  sessionId: string | null,
  seen: readonly ScreenTaskCompletion[] | null,
  launches: readonly LabelledShellLaunch[] | null
): ScreenCompletionMemory {
  if (handle === null || sessionId === null) {
    return EMPTY_SCREEN_COMPLETION_MEMORY
  }
  const key = `${handle}\u0000${sessionId}`
  const previous = memories.get(key) ?? EMPTY_SCREEN_COMPLETION_MEMORY
  const next = seen === null || launches === null ? previous : rememberScreenCompletions(previous, seen, launches, Date.now())
  memories.delete(key)
  memories.set(key, next)
  if (memories.size > MEMORY_SESSIONS_MAX) {
    const oldest = memories.keys().next().value
    if (oldest !== undefined) {
      memories.delete(oldest)
    }
  }
  return next
}

/** The completion rows the active tab's screen has shown, remembered across
 *  polls, remounts and tab switches for as long as the app runs. Same shape
 *  as `useActiveTabFinishedTaskIds`, for the same reason: a row has to be
 *  seen once, not continuously. None while the session is unknown. */
export function useActiveTabScreenCompletions(
  handle: string | null,
  sessionId: string | null,
  seen: readonly ScreenTaskCompletion[] | null,
  launches: readonly LabelledShellLaunch[] | null
): readonly ScreenTaskCompletion[] {
  const copies = recall(handle, sessionId, seen, launches).copies
  return useMemo(() => (copies.length === 0 ? NONE : screenCompletionsFromMemory({ copies })), [copies])
}
