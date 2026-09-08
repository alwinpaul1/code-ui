import { agentHudContextPercent, type AgentHudSnapshot } from './agent-hud-snapshot'
import type { TerminalHudObservation } from './mobile-terminal-hud-parse'

function short(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`
  }
  if (tokens >= 1000) {
    const thousands = tokens / 1000
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`
  }
  return String(tokens)
}

/** Prefer what the agent said about itself over what a status line drew.
 *
 *  The snapshot is authoritative for the model, the effort and the context,
 *  because it comes from the agent's own record rather than from text on a
 *  screen. Everything else stays with the screen: a permission dialog is not in
 *  the transcript until it has been answered, so only the screen can see one.
 *
 *  A field the snapshot does not have falls back to the screen rather than
 *  blanking — losing the model pill because a shell could not start would be a
 *  worse HUD than the one this replaces. */
export function mergeAgentHudObservation(
  screen: TerminalHudObservation | null,
  snapshot: AgentHudSnapshot | null
): TerminalHudObservation | null {
  if (!snapshot || snapshot.error) {
    return screen
  }
  const percent = agentHudContextPercent(snapshot)
  const used = snapshot.contextUsedTokens
  const size = snapshot.contextWindowTokens
  const context =
    percent === null
      ? // The window size is not knowable for this session, so show what IS
        // known — the tokens in use — and no percentage. A guessed denominator
        // reads as nearly full for a window that is half empty.
        used === null
        ? (screen?.context ?? null)
        : // A zero here is drawn as an empty ring and read aloud as "0% used",
          // which is the opposite of the truth on a nearly full session. With
          // no denominator there is no percentage to state, so leave whatever
          // the screen had rather than inventing one.
          (screen?.context ?? null)
      : {
          usedPercent: percent,
          usedLabel: used === null ? null : short(used),
          windowLabel: size === null ? null : short(size),
          ...(snapshot.limits.length ? { limits: snapshot.limits } : {}),
          ...(snapshot.planType ? { planType: snapshot.planType } : {})
        }
  // Only the screen sees the mode footer. Defaulting to 'default' when it has
  // not been seen asserts Manual for an agent launched with --permission-mode
  // acceptEdits, and the mode sheet then cycles from the wrong current value.
  // With no screen reading there is nothing honest to say, so say nothing.
  if (!screen) {
    return null
  }
  return {
    ...screen,
    modelLabel: snapshot.model ?? screen.modelLabel,
    modelId: snapshot.model ?? screen.modelId,
    effort: snapshot.effort ?? screen.effort,
    context
  }
}

/** True when the context figure came from the agent rather than from a guess,
 *  so the UI can show a bare token count instead of a misleading ring. */
export function agentHudContextIsMeasured(snapshot: AgentHudSnapshot | null): boolean {
  return !!snapshot && !snapshot.error && agentHudContextPercent(snapshot) !== null
}
