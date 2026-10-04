import { describe, expect, it } from 'vitest'
import { agentSessionFailureWords } from '../../../src/shared/agent-session-failure-words'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { collapseProviderRetryRuns } from '../../../src/shared/native-chat-provider-retry-runs'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { projectStructuredAgentSessionMessages } from '../../../src/shared/structured-agent-session-message-projection'
import { mobileStructuredTranscript } from './mobile-structured-transcript'

function retry(sequence: number, attempt: number, agentId?: string): AgentJournalRenderItem {
  return {
    itemId: `retry-${agentId ?? 'root'}-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    ...(agentId ? { agentId } : {}),
    body: {
      kind: 'status',
      tone: 'warning',
      ...agentSessionFailureWords(
        {
          kind: 'providerRetrying',
          detail: { text: `Reconnecting... ${attempt}/5`, audience: 'person' },
          retry: { cause: 'stream disconnected before completion' }
        },
        { surface: 'row', agentName: 'Codex' }
      )
    }
  }
}

function said(sequence: number, text: string, agentId?: string): AgentJournalRenderItem {
  return {
    itemId: `said-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    ...(agentId ? { agentId } : {}),
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }
  }
}

const RUNS: Record<string, AgentJournalRenderItem[]> = {
  'one run': [retry(1, 1), retry(2, 2), retry(3, 3)],
  'a run its own row ends': [retry(1, 1), said(2, 'Partial'), retry(3, 1)],
  'two agents at once': [retry(1, 1), retry(2, 1, 'sub'), retry(3, 2), retry(4, 2, 'sub')],
  "another agent's row inside a run": [retry(1, 1), said(2, 'Sub says', 'sub'), retry(3, 2)],
  'a lone retry row': [retry(1, 1)],
  'no retry rows': [said(1, 'Hello'), said(2, 'There')],
  empty: []
}

function words(messages: readonly NativeChatMessage[]): string[] {
  return messages.map((message) =>
    message.blocks.map((block) => (block.type === 'text' ? block.text : block.type)).join('|')
  )
}

describe("the phone's provider-retry collapse", () => {
  // The vendored rule decides which rows a run has and which attempt it shows; the phone only
  // keeps the run's first id and place. So the rows drawn, as words, are upstream's, in any order.
  it.each(Object.entries(RUNS))('draws the rows upstream draws: %s', (_name, items) => {
    const upstream = collapseProviderRetryRuns(projectStructuredAgentSessionMessages(items, [], []))
    expect(words(mobileStructuredTranscript(items, [])).sort()).toEqual(words(upstream).sort())
  })

  // What every anchor reader needs: an id the phone drew once is still drawn after any later row.
  it.each(Object.entries(RUNS))('keeps every id it has drawn as later rows arrive: %s', (_name, items) => {
    const final = new Set(mobileStructuredTranscript(items, []).map((message) => message.id))
    for (let end = 0; end <= items.length; end += 1) {
      for (const message of mobileStructuredTranscript(items.slice(0, end), [])) {
        expect(final.has(message.id), `${message.id} after ${end} rows`).toBe(true)
      }
    }
  })
})
