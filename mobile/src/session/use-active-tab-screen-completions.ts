import { useMemo, useRef } from 'react'
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
    rows: rememberScreenCompletions(memory.current.rows, seen)
  }
  const rows = memory.current.rows
  return useMemo(() => (rows.size === 0 ? NONE : screenCompletionsFromMemory(rows)), [rows])
}
