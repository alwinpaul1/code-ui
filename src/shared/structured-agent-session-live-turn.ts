// What the newest turn in a structured journal is doing right now, read off the
// tail of the item list. Every scan here stops at the turn's own record, because
// state from an earlier turn is never this turn's state.
//
// CODE UI HAND-APPLIED UPSTREAM PORT (Orca #19977, fab78c766): upstream's file
// also carries `activeStructuredAgentSessionTurnId` and
// `activeStructuredAgentSessionToolCall`, which this fork still keeps in
// `structured-agent-session-projection.ts`, and reads the turn record through
// `readAgentJournalTurn` — a typed `turn` journal item this fork's
// `agent-session-journal-types` does not have. Here the turn record is the
// legacy status row that carries `turnLifecycle`, which is what this fork's
// hosts write. See src/shared/LOCAL-FILES.md.

import type { AgentJournalRenderItem } from './agent-session-journal-types'

/** The turn record a scan stops at: this fork's lifecycle-carrying status row. */
function readTurnLifecycle(
  body: AgentJournalRenderItem['body'] | undefined
): { turnId: string; state: 'running' | 'completed' } | null {
  return body?.kind === 'status' && body.turnLifecycle ? body.turnLifecycle : null
}

/**
 * Whether the newest thing the active turn produced is the model's own reasoning.
 *
 * This is what "thinking" has to mean for the indicator to be honest: the turn is reasoning
 * *right now*. The older rule — "the turn has produced no renderable output yet" — reports
 * thinking while the request is merely in flight, and stops reporting it the moment a tool call
 * lands, which is usually when reasoning actually starts.
 */
export function isStructuredAgentSessionThinking(
  items: readonly AgentJournalRenderItem[]
): boolean {
  let newestContentIsReasoning: boolean | null = null
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const body = items[index]?.body
    const turn = readTurnLifecycle(body)
    if (turn) {
      return turn.state === 'running' && newestContentIsReasoning === true
    }
    if (newestContentIsReasoning !== null) {
      continue
    }
    if (body?.kind === 'message') {
      newestContentIsReasoning = body.role === 'reasoning'
    } else if (
      body?.kind === 'tool-call' ||
      body?.kind === 'diff' ||
      body?.kind === 'approval' ||
      body?.kind === 'question'
    ) {
      newestContentIsReasoning = false
    }
    // Plain status copy is activity chrome, not newer transcript content.
  }
  return false
}
