import type { AgentJournalRenderItem, AgentJournalSubmission } from './agent-session-journal-types'
import { agentJournalSubmissionKey } from './agent-session-journal-item-key'
import type { NativeChatMessage } from './native-chat-types'
// CODE UI HAND-APPLIED UPSTREAM HUNK (Orca #23684, b4b708c2c4): a provider retry run draws only
// its latest row. This copy has no held sends (queue delivery is not ported), so the collapse wraps
// the journal's own rows. See src/shared/LOCAL-FILES.md.
import { collapseProviderRetryRuns } from './native-chat-provider-retry-runs'
import {
  reconcileStructuredAgentSessionOutbox,
  type StructuredAgentSessionOutboxEntry
} from './structured-agent-session-outbox'
import { projectStructuredItemsToNativeChat } from './structured-agent-session-projection'

export function projectStructuredAgentSessionMessages(
  items: readonly AgentJournalRenderItem[],
  outbox: readonly StructuredAgentSessionOutboxEntry[],
  submissions: readonly AgentJournalSubmission[],
  projectItems = projectStructuredItemsToNativeChat
): NativeChatMessage[] {
  const optimistic = reconcileStructuredAgentSessionOutbox(outbox, submissions)
  // Refused sends are ledger evidence, not conversation history; local drafts remain in the outbox.
  const rejected = new Set(
    submissions
      .filter((submission) => submission.dispatchState === 'rejected')
      .map((submission) => agentJournalSubmissionKey(submission.clientMessageId))
  )
  const visibleItems = items.filter((item) => !rejected.has(item.itemId))
  const journalled = new Set(visibleItems.map((item) => item.itemId))
  return [
    ...collapseProviderRetryRuns(projectItems(visibleItems)),
    ...optimistic
      .filter((entry) => !journalled.has(agentJournalSubmissionKey(entry.clientMessageId)))
      .map((entry): NativeChatMessage => ({
        id: agentJournalSubmissionKey(entry.clientMessageId),
        role: 'user',
        source: 'transcript',
        timestamp: entry.queuedAt,
        blocks: entry.body.blocks
      }))
  ]
}
