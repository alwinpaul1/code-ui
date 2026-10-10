// CODE UI HAND-KEPT (Orca #26579, bb44f74d00): taken whole except `agentSessionCurrentContextRows`,
// which filters submissions on `acceptedSequence`, a field this fork's journal types do not carry.
// Its only caller is the host's status projection, not taken here. See src/shared/LOCAL-FILES.md.
import type { AgentJournalItemBody, AgentJournalRenderItem } from './agent-session-journal-types'
import { isAgentSessionProviderContextBoundary } from './agent-session-provider-context'
import type { NativeChatMessage } from './native-chat-types'

export function isAgentSessionContextClear(body: AgentJournalItemBody | undefined): boolean {
  return body?.kind === 'status' && isAgentSessionProviderContextBoundary(body.contextClear)
}

export function isNativeChatContextClear(message: NativeChatMessage): boolean {
  return (
    message.role === 'system' &&
    message.blocks.some(
      (block) => block.type === 'text' && isAgentSessionProviderContextBoundary(block.contextClear)
    )
  )
}

export function agentSessionContextSequenceFor(
  sequence: number,
  boundaries: readonly number[]
): number {
  let left = 0
  let right = boundaries.length
  while (left < right) {
    const middle = Math.floor((left + right) / 2)
    if (boundaries[middle] < sequence) {
      left = middle + 1
    } else {
      right = middle
    }
  }
  return left > 0 ? boundaries[left - 1] : 0
}

export function latestAgentSessionContextClearSequence(
  items: Iterable<Pick<AgentJournalRenderItem, 'sequence' | 'body'>>
): number {
  let sequence = 0
  for (const item of items) {
    if (item.sequence > sequence && isAgentSessionContextClear(item.body)) {
      sequence = item.sequence
    }
  }
  return sequence
}
