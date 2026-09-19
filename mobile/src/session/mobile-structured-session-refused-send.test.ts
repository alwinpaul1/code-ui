// Orca #21096's one phone-visible line, pinned where the gate runs it: a
// refused send is ledger evidence, not conversation history. The host writes
// the user row before dispatch; when the provider then rejects the send, that
// row must leave the transcript instead of standing as a message the agent
// never received, beside the banner that says it was not sent.

import { describe, expect, it } from 'vitest'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../src/shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../../src/shared/agent-session-journal-item-key'
import { projectStructuredAgentSessionMessages } from '../../../src/shared/structured-agent-session-message-projection'

function userItem(clientMessageId: string, sequence: number): AgentJournalRenderItem {
  return {
    itemId: agentJournalSubmissionKey(clientMessageId),
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: clientMessageId }] }
  }
}

function submission(
  clientMessageId: string,
  dispatchState: AgentJournalSubmission['dispatchState']
): AgentJournalSubmission {
  return {
    clientMessageId,
    fence: 1,
    payloadFingerprint: 'fp',
    dispatchState,
    providerItemId: null,
    reason: dispatchState === 'rejected' ? 'provider_write_failed: broken pipe' : null,
    submittedAt: 1,
    resolvedAt: dispatchState === 'pending' ? null : 2
  }
}

describe('a send the provider refused', () => {
  it('leaves the transcript, while accepted and pending sends stay', () => {
    const items = [userItem('first', 1), userItem('refused', 2), userItem('later', 3)]
    const messages = projectStructuredAgentSessionMessages(items, [], [
      submission('first', 'accepted'),
      submission('refused', 'rejected'),
      submission('later', 'pending')
    ])
    expect(messages.map((message) => message.id)).toEqual([
      agentJournalSubmissionKey('first'),
      agentJournalSubmissionKey('later')
    ])
  })

  it('changes nothing when no send was refused, and nothing when there are no items', () => {
    const items = [userItem('only', 1)]
    expect(
      projectStructuredAgentSessionMessages(items, [], [submission('only', 'accepted')]).map(
        (message) => message.id
      )
    ).toEqual([agentJournalSubmissionKey('only')])
    expect(projectStructuredAgentSessionMessages([], [], [submission('gone', 'rejected')])).toEqual(
      []
    )
  })
})
