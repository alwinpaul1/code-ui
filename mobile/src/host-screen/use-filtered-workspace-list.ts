import { useActiveWorktreeScroll } from '../hooks/use-active-worktree-scroll'
import { useClaudeSessionFilter } from '../worktree/use-claude-session-filter'
import type { Section, Worktree } from '../worktree/workspace-list-types'

/**
 * The workspace list as drawn: the Claude session filter over the list's sections, and the
 * scroll-to-active over the SAME filtered sections. The scroll's ref is the SectionList that draws
 * `sessionFilter.sections`, and RN's `scrollToLocation` indexes that list; indexes taken from the
 * unfiltered sections scrolled to the wrong row, or threw (`Cannot read properties of undefined
 * (reading 'data')`) when the filter had dropped a section. An active workspace the filter hides is
 * not in these sections, so nothing scrolls to it.
 */
export function useFilteredWorkspaceList(worktrees: readonly Worktree[], sections: Section[], now: number) {
  const sessionFilter = useClaudeSessionFilter(worktrees, sections, now)
  const activeWorktreeScroll = useActiveWorktreeScroll(sessionFilter.sections)
  return { sessionFilter, activeWorktreeScroll }
}
