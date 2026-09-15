import { useRef } from 'react'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

export type StickyLiveHud = {
  model: string | null
  effort: string | null
  context: TerminalHudContextWindow | null
}

/**
 * The last model and effort the terminal's OWN status-line badge stated, held
 * per tab across screen reads that come back empty.
 *
 * Why: the composer's model pill seeds from the badge read off the screen and
 * falls back to the launch-time `agentStatus.model` when there is no read. On
 * a session whose `terminal.read` lags (a 301 MB transcript, 2026-09-14) the
 * read alternates between a real badge and nothing, so the pill flipped
 * between "Opus xhigh" — what the badge said — and "Fable Medium" — what the
 * session was launched as, long since changed by `/model`. A value the badge
 * has stated is better evidence than the launch record for as long as this
 * tab is open, so an empty read keeps it rather than falling back.
 *
 * The context figure is held the same way and for the same reason: it is read
 * off that same badge, so an empty read would otherwise blank the ring the
 * moment it flickered rather than keep the last figure the agent stated.
 *
 * Reset when the tab changes: the badge belongs to that tab's terminal.
 */
export function useStickyLiveHud(
  observation: {
    modelId: string | null
    effort: string | null
    context?: TerminalHudContextWindow | null
  } | null,
  tabId: string | null
): StickyLiveHud {
  const held = useRef<{
    tab: string | null
    model: string | null
    effort: string | null
    context: TerminalHudContextWindow | null
  }>({ tab: null, model: null, effort: null, context: null })
  if (held.current.tab !== tabId) {
    held.current = { tab: tabId, model: null, effort: null, context: null }
  }
  if (observation?.modelId) {
    held.current.model = observation.modelId
  }
  if (observation?.effort) {
    held.current.effort = observation.effort
  }
  if (observation?.context) {
    held.current.context = observation.context
  }
  return { model: held.current.model, effort: held.current.effort, context: held.current.context }
}
