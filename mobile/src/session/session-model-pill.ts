/**
 * The header's model pill, stated the way the binary states it.
 *
 * Claude Code paints its own `display_name` and effort on its status line —
 * `[Opus 5 (1M context) xhigh | Max 20x]` — and the phone's screen parser reads
 * exactly that back into the live pair. The VS Code extension reads the same
 * fact from the SDK's init message. Both are the agent's own word about itself,
 * and that is the only thing this pill may show.
 *
 * What it deliberately does NOT read: the session-options snapshot. That value
 * is the tracked record — a pick, a seed, a remembered value — and every
 * wrong-model report has come through it. On 2026-09-18 the pill read "Fable
 * Medium" while the transcript held 1479 turns of claude-opus-5 and not one
 * Fable, the status line painted Opus, the parser returned `opus`/`xhigh` from
 * the real screen, and Orca's own record carried no model at all. Every source
 * was right; the display was wrong; so the fault was in the layer between them,
 * and the previous fix — a gate on that layer — still let the record's label
 * through. This one reads past it.
 *
 * Absent a live pair the pill shows nothing. CLAUDE.md: a figure that cannot be
 * known is not to be filled in from somewhere else. The picker is untouched — a
 * model can still be chosen; the app just stops asserting one it has not heard.
 */
export type LiveModelPair = {
  model: string | null
  label?: string | null
  effort: string | null
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** The agent's name for itself without any parenthesised aside: Claude Code
 *  paints "Opus 5 (1M context)", and the window size is a fact about the
 *  window, not the model. On a phone-width pill it pushed the effort off the
 *  end (2026-09-19: "opus 5 xhigh", "opus 4.8 max"). */
function withoutAsides(label: string): string {
  return label.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
}

export function sessionModelPillLabel(live: LiveModelPair | null): string | null {
  // A label with no model behind it is not a statement about this session.
  const model = text(live?.model)
  if (model === null) {
    return null
  }
  // The screen parser can hand the painted name back as the model itself,
  // with no separate label; the aside comes off whichever one is shown.
  const label = text(live?.label)
  const name = text(withoutAsides(label ?? model)) ?? text(withoutAsides(model)) ?? model
  const effort = text(live?.effort)
  return effort === null ? name : `${name} ${effort}`
}
