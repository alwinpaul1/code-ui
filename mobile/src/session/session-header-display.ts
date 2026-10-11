import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { ThemeColors } from '../theme/tokens'
import { hudFieldsFromAgentStatus, shortTokenLabel } from './hud-agent-status-fields'
import type { TerminalHudContextWindow } from './mobile-terminal-hud-parse'

/**
 * What the session header draws, copied from the Claude app's top bar
 * (com.anthropic.claude 1.261009.20, `yv8` and `us8`): the title, a
 * "repo · branch" subtitle, and the context ring among the trailing actions.
 */

/** The Claude app's ring colour steps: blue under 75%, amber from 75 to 89,
 *  red from 90. Stepped, not faded, as the app draws it. */
export type ContextRingStep = 'calm' | 'warning' | 'danger'

export const CONTEXT_RING_WARNING_PERCENT = 75
export const CONTEXT_RING_DANGER_PERCENT = 90

export function contextRingStep(percent: number): ContextRingStep {
  if (percent >= CONTEXT_RING_DANGER_PERCENT) {
    return 'danger'
  }
  return percent >= CONTEXT_RING_WARNING_PERCENT ? 'warning' : 'calm'
}

/** The step's colour from the active theme, so the ring follows light and dark. */
export function contextRingColor(
  step: ContextRingStep,
  colors: Pick<ThemeColors, 'info' | 'warning' | 'danger'>
): string {
  return step === 'danger' ? colors.danger : step === 'warning' ? colors.warning : colors.info
}

export type SessionHeaderContextReading =
  | { kind: 'ring'; percent: number; step: ContextRingStep }
  | { kind: 'tokens'; usedLabel: string }
  | null

/**
 * The ring, the tokens alone, or nothing.
 *
 * A ring only from a context figure the HUD already holds, which exists only
 * when the session itself stated a percentage or a window (the beacon's
 * `context_window_size` / `model_context_window`, the host's window, or the
 * agent's own footer). With tokens and no window there is no honest fraction,
 * so the header shows the tokens and no percentage (CLAUDE.md: never invent a
 * denominator). With neither, nothing.
 */
export function sessionHeaderContextReading(
  context: TerminalHudContextWindow | null,
  agentStatus: AgentStatusEntry | null
): SessionHeaderContextReading {
  if (context && Number.isFinite(context.usedPercent)) {
    const percent = Math.round(Math.max(0, Math.min(100, context.usedPercent)))
    return { kind: 'ring', percent, step: contextRingStep(percent) }
  }
  const used = hudFieldsFromAgentStatus(agentStatus).contextUsedTokens
  return used === undefined ? null : { kind: 'tokens', usedLabel: shortTokenLabel(used) }
}

/** "feature/x" from "refs/heads/feature/x"; null for a detached HEAD or none. */
export function displayBranchName(branch: string | null | undefined): string | null {
  const name = branch?.trim().replace(/^refs\/heads\//, '') ?? ''
  return name === '' ? null : name
}

/** "repo · branch", or whichever half is known, or null for neither. */
export function sessionHeaderSubtitle(input: {
  repoName: string | null | undefined
  branch: string | null | undefined
}): string | null {
  const parts = [input.repoName?.trim() || null, displayBranchName(input.branch)].filter(
    (part): part is string => part !== null
  )
  return parts.length === 0 ? null : parts.join(' · ')
}
