import { useMemo, useRef } from 'react'
import type { LabelledShellLaunch } from './mobile-background-task-evidence'
import type { ScreenTaskCompletion } from './mobile-background-tasks'
import {
  EMPTY_SCREEN_COMPLETION_MEMORY,
  rememberScreenCompletions,
  screenCompletionsFromMemory,
  type ScreenCompletionMemory
} from './mobile-screen-completion-memory'

const NONE: readonly ScreenTaskCompletion[] = []

/** The completion rows the active tab's screen has shown, remembered across
 *  polls for as long as the tab shows the same terminal and session; a new
 *  handle or a new session starts with none, so one tab's rows never retire
 *  another's shells. Same shape as `useActiveTabFinishedTaskIds`, for the
 *  same reason: a row has to be seen once, not continuously.
 *
 *  `launches` is the settled transcript window's labelled shell launches, or
 *  null while the window is not settled: a poll is folded in only against a
 *  settled window, since each new copy is bound to the launches it holds
 *  (`mobile-screen-completion-memory.ts`). */
export function useActiveTabScreenCompletions(
  handle: string | null,
  sessionId: string | null,
  seen: readonly ScreenTaskCompletion[],
  launches: readonly LabelledShellLaunch[] | null
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
    rows: launches === null ? memory.current.rows : rememberScreenCompletions(memory.current.rows, seen, launches)
  }
  const copies = memory.current.rows.copies
  return useMemo(() => (copies.length === 0 ? NONE : screenCompletionsFromMemory({ copies })), [copies])
}
