// CODE UI HAND-APPLIED UPSTREAM HUNK (Orca #26544, ff4a51c872): the fact is kept only when read
// whole, so a newer host's fact this build cannot re-word keeps the host's sentence.
import { readWholeAgentSessionFailureFact } from './agent-session-failure'
import type { AgentJournalStatusItem } from './agent-session-journal-types'
import type { NativeChatTextBlock } from './native-chat-types'

/** A status row as the line a chat paints: named fields only, so a host-only key never leaks. */
export function structuredAgentSessionStatusBlock(
  body: AgentJournalStatusItem
): NativeChatTextBlock {
  const failure = readWholeAgentSessionFailureFact(body.failure)
  return {
    type: 'text',
    text: body.text,
    ...(body.presentation !== undefined ? { presentation: body.presentation } : {}),
    ...(body.tone !== undefined ? { tone: body.tone } : {}),
    ...(body.providerFrame ? { providerFrame: body.providerFrame } : {}),
    ...(failure ? { failure } : {})
  }
}
