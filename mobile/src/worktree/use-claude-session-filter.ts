import { useState } from 'react'
import { CLAUDE_SESSION_FILTER_EMPTY, type ClaudeSessionFilter } from '../session/claude-session-state'
import { filterSectionsByClaudeSession, hasClaudeAgents } from './claude-session-list-filter'
import type { Section, Worktree } from './workspace-list-types'

/**
 * The workspace list's session filter (claude-session-list-filter.ts): offered only while the list
 * holds a Claude agent. A filter picked while Claude agents were listed reads as All once none
 * are, so a list with no Claude session is never hidden behind a filter the user cannot see.
 */
export function useClaudeSessionFilter(worktrees: readonly Worktree[], sections: Section[], now: number) {
  const [picked, setPicked] = useState<ClaudeSessionFilter>('all')
  const offered = hasClaudeAgents(worktrees)
  const value: ClaudeSessionFilter = offered ? picked : 'all'
  const shown = filterSectionsByClaudeSession(sections, value, now)
  return {
    offered,
    value,
    setValue: setPicked,
    sections: shown,
    /** The app's `session_list_filter_empty`, when the filter leaves nothing of a non-empty list. */
    emptyNotice: value !== 'all' && shown.length === 0 && sections.length > 0 ? CLAUDE_SESSION_FILTER_EMPTY : null
  }
}
