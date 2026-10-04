// The structured chat's rows as the phone draws them: the shared projection, then each agent's
// provider-retry run drawn as one row that updates in place.
//
// Orca #23684 (b4b708c2c4): a provider retrying writes a warning row per attempt, and the journal
// keeps them all; a transcript draws one row per agent's run (`native-chat-provider-retry-runs.ts`,
// vendored: a run is an agent's retry rows with none of its own other rows between them). Upstream
// keeps the run's LATEST row, at its place, which in upstream's per-agent sections is the same as
// updating the first one. The phone draws every agent in one list, and it anchors a send on the last
// row it holds by that row's id (`captureSendBoundary`, the echo and witness readers). Dropping the
// earlier attempt dropped that id, so a send made while a retry row was the last row never landed,
// and a photo echo retired early (review of d16165b70). Here the run's row keeps its FIRST attempt's
// id and place and shows the latest attempt, so every id the phone has seen stays in the list.

import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import { agentJournalItemSubagentId } from '../../../src/shared/agent-session-journal-producer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { projectStructuredAgentSessionMessages } from '../../../src/shared/structured-agent-session-message-projection'

/** Upstream's run-row test (`isProviderRetryRow`, native-chat-provider-retry-runs.ts, not exported
 *  there); mobile-structured-transcript.test.ts pins this collapse to upstream's on the same rows. */
function isProviderRetryRow(message: NativeChatMessage): boolean {
  const block = message.blocks.length === 1 ? message.blocks[0] : undefined
  return (
    message.role === 'system' &&
    block?.type === 'text' &&
    block.failure?.kind === 'providerRetrying'
  )
}

/** Each agent's run of provider-retry rows as one row: the first attempt's id, timestamp and place,
 *  the latest attempt's words. Another agent's row never ends a run, as upstream's rule says. */
export function collapseProviderRetryRunsInPlace(
  messages: readonly NativeChatMessage[]
): NativeChatMessage[] {
  if (!messages.some(isProviderRetryRow)) {
    return [...messages]
  }
  // Each agent's open run, as the index of its row in `drawn`.
  const openRuns = new Map<string | null, number>()
  const drawn: NativeChatMessage[] = []
  for (const message of messages) {
    const agent = agentJournalItemSubagentId(message)
    if (!isProviderRetryRow(message)) {
      openRuns.delete(agent)
      drawn.push(message)
      continue
    }
    const at = openRuns.get(agent)
    const first = at === undefined ? undefined : drawn[at]
    if (at === undefined || first === undefined) {
      openRuns.set(agent, drawn.length)
      drawn.push(message)
      continue
    }
    drawn[at] = { ...message, id: first.id, timestamp: first.timestamp }
  }
  return drawn
}

/** The structured chat's rows as the phone draws them. */
export function mobileStructuredTranscript(
  items: readonly AgentJournalRenderItem[],
  submissions: readonly AgentJournalSubmission[]
): NativeChatMessage[] {
  return collapseProviderRetryRunsInPlace(projectStructuredAgentSessionMessages(items, [], submissions))
}
