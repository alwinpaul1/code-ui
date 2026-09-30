import { useMemo, useRef } from 'react'
import type { ScreenTaskCompletion } from './mobile-background-tasks'
import {
  EMPTY_SCREEN_COMPLETION_MEMORY,
  rememberScreenCompletions,
  screenCompletionsFromMemory,
  type ScreenCompletionMemory
} from './mobile-screen-completion-memory'

const NONE: readonly ScreenTaskCompletion[] = []

/** Folds one poll into the memory, stamped with the phone time it was read,
 *  so each row keeps when it was first seen: a row may retire only a launch
 *  that had started by then. The clock is read here, not in the hook, as
 *  `observeSession` does in `use-active-tab-task-report.ts`. */
function rememberPoll(rows: ScreenCompletionMemory, seen: readonly ScreenTaskCompletion[]): ScreenCompletionMemory {
  return rememberScreenCompletions(rows, seen, Date.now())
}

/** The completion rows the active tab's screen has shown, remembered across
 *  polls for as long as the tab shows the same terminal and session; a new
 *  handle or a new session starts with none, so one tab's rows never retire
 *  another's shells. Same shape as `useActiveTabFinishedTaskIds`, for the
 *  same reason: a row has to be seen once, not continuously. */
export function useActiveTabScreenCompletions(
  handle: string | null,
  sessionId: string | null,
  seen: readonly ScreenTaskCompletion[]
): readonly ScreenTaskCompletion[] {
  const memory = useRef<{ handle: string | null; sessionId: string | null; rows: ScreenCompletionMemory }>({
    handle,
    sessionId,
    rows: EMPTY_SCREEN_COMPLETION_MEMORY
  })
  const sessionChanged =
    sessionId !== null && memory.current.sessionId !== null && sessionId !== memory.current.sessionId
  if (memory.current.handle !== handle || sessionChanged) {
    memory.current = { handle, sessionId, rows: EMPTY_SCREEN_COMPLETION_MEMORY }
  }
  memory.current = {
    handle,
    sessionId: sessionId ?? memory.current.sessionId,
    rows: rememberPoll(memory.current.rows, seen)
  }
  const rows = memory.current.rows
  return useMemo(() => (rows.size === 0 ? NONE : screenCompletionsFromMemory(rows)), [rows])
}
