import { useRef } from 'react'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

export type StickyLiveHud = {
  model: string | null
  effort: string | null
  context: TerminalHudContextWindow | null
}

/**
 * The last model, effort and context the LIVE HUD stated, held per tab across
 * observations that come back empty.
 *
 * The figures reach the HUD two ways, and this holds whichever arrived: the
 * agent's own OSC beacon, which the phone's injected status-line command emits
 * on every repaint and which needs no bar on the host at all; and, for a user
 * who does keep their own status line, the `[Model effort]` badge read off the
 * screen. Neither is guaranteed on any given tick — a screen read can come back
 * empty, and a beacon can be missed — and the pill's only fallback is the
 * launch-time `agentStatus.model`.
 *
 * Why it matters: on a session whose `terminal.read` lags (a 301 MB transcript,
 * 2026-09-14) the observation alternated between real figures and nothing, so
 * the pill flipped between "Opus xhigh" — what the session actually is — and
 * "Fable Medium" — what it was LAUNCHED as, long since changed by `/model`.
 * The context ring blanked on the same ticks. A figure the agent has stated is
 * better evidence than the launch record for as long as this tab is open, so an
 * empty observation keeps it rather than falling back.
 *
 * Reset when the tab changes: the figures belong to that tab's agent.
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
  // Model and effort move TOGETHER, from the reading that names the model.
  //
  // An effort with no model behind it is not a statement about this session's
  // model: `applyAgentStatusHudFields` builds exactly that observation — a null
  // model carrying the host's `agentStatus.effort` — whenever the screen read
  // comes back empty, which on a host with no status line is every tick. Taking
  // it alone welded a launch-time effort onto a model read somewhere else, and
  // the pill stated a pair that never existed ("Opus Medium" on Opus xhigh).
  // The reading that names the model owns the effort beside it, null included.
  if (observation?.modelId) {
    held.current.model = observation.modelId
    held.current.effort = observation.effort
  }
  if (observation?.context) {
    held.current.context = observation.context
  }
  return { model: held.current.model, effort: held.current.effort, context: held.current.context }
}
