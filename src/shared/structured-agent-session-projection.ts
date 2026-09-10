import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from './agent-session-journal-types'
import type { NativeChatBlock, NativeChatMessage } from './native-chat-types'
import { sha256 } from './sha256'

function boundedText(payload: { head: string; truncated: boolean; byteLength: number }): string {
  return payload.truncated ? `${payload.head}\n… (${payload.byteLength} bytes)` : payload.head
}

// CODE UI HAND-APPLIED UPSTREAM HUNK (Orca #18765, 172aa1ac3): the bounded-text
// marker reader, which `native-chat-edit-normalize` imports. The file cannot be
// re-vendored whole at that commit because it also carries the forward-ported
// `presentation`/`tone` hints from #19228. See src/shared/LOCAL-FILES.md.
/** The markers a clipped payload carries in its own text, anchored to the end
 *  so nothing that merely looks like one inside the body can match. */
const BOUNDED_TEXT_MARKERS = [
  /\n… \(\d+ bytes\)$/,
  /\n\[Orca: output truncated — \d+ bytes total, digest [0-9a-f]+\]$/
]

/** Recovers the clipped body from a bounded payload's text, and says whether a
 *  marker was there. A reader that treats the text as content renders the
 *  marker as a line of it — with a line number, which reads as a real position
 *  in the file — and reports the body as complete. */
export function stripBoundedTextMarker(text: string): { text: string; truncated: boolean } {
  const stripped = BOUNDED_TEXT_MARKERS.reduce((value, marker) => value.replace(marker, ''), text)
  return { text: stripped, truncated: stripped.length !== text.length }
}

function itemBlocks(item: AgentJournalRenderItem): {
  role: NativeChatMessage['role']
  blocks: NativeChatBlock[]
} | null {
  const body = item.body
  if (body.kind === 'message') {
    return { role: body.role, blocks: body.blocks }
  }
  if (body.kind === 'tool-call') {
    return {
      role: 'assistant',
      blocks: [
        // CODE UI HAND-APPLIED UPSTREAM HUNK (Orca #19226, d0506bf5d): the
        // execution and MCP-identity metadata, carried only when the host
        // actually recorded it, so an older host projects exactly what it did.
        {
          type: 'tool-call',
          name: body.name,
          input: body.input,
          state: body.state,
          ...(body.mcpIdentity !== undefined ? { mcpIdentity: body.mcpIdentity } : {}),
          ...(body.exitCode !== undefined ? { exitCode: body.exitCode } : {}),
          ...(body.durationMs !== undefined ? { durationMs: body.durationMs } : {}),
          ...(body.webSearchResults !== undefined
            ? { webSearchResults: body.webSearchResults }
            : {})
        },
        ...(body.output
          ? [
              {
                type: 'tool-result' as const,
                output: boundedText(body.output),
                isError: body.state === 'failed'
              }
            ]
          : [])
      ]
    }
  }
  if (body.kind === 'diff') {
    return {
      role: 'assistant',
      blocks: [
        { type: 'tool-call', name: 'Diff', input: { path: body.path } },
        { type: 'tool-result', output: boundedText(body.patch) }
      ]
    }
  }
  if (body.kind === 'approval') {
    if (body.resolution.state === 'pending') {
      return null
    }
    return {
      role: 'system',
      blocks: [
        {
          type: 'text',
          text: `${body.title}\n${body.detail ?? ''}\n${body.resolution.state}`.trim()
        }
      ]
    }
  }
  if (body.kind === 'question') {
    if (body.resolution.state === 'pending') {
      return null
    }
    const choices = body.options.map((option) => option.label).join(' · ')
    return {
      role: 'system',
      blocks: [{ type: 'text', text: `${body.question}\n${choices}`.trim() }]
    }
  }
  if (body.turnLifecycle) {
    return null
  }
  return {
    role: 'system',
    blocks: [
      {
        type: 'text',
        text: body.text,
        ...(body.presentation !== undefined ? { presentation: body.presentation } : {}),
        ...(body.tone !== undefined ? { tone: body.tone } : {}),
        ...(body.providerFrame ? { providerFrame: body.providerFrame } : {})
      }
    ]
  }
}

// CODE UI HAND-APPLIED UPSTREAM HUNK (Orca #19229, e80fae0c4): the per-item
// render cache. The file cannot be re-vendored whole at that commit because it
// also carries the forward-ported `presentation`/`tone` hints from #19228 and
// the #18765 / #19226 hunks above. See src/shared/LOCAL-FILES.md.
const projectedItems = new WeakMap<AgentJournalRenderItem, NativeChatMessage | null>()

export function projectStructuredItemsToNativeChat(
  items: readonly AgentJournalRenderItem[]
): NativeChatMessage[] {
  return items.flatMap((item) => {
    const projected = projectStructuredItemToNativeChat(item)
    return projected ? [projected] : []
  })
}

export function projectStructuredItemToNativeChat(
  item: AgentJournalRenderItem
): NativeChatMessage | null {
  const cached = projectedItems.get(item)
  if (cached !== undefined) {
    return cached
  }
  // Reducer updates replace journal items, so unchanged rows keep their render caches.
  const projected = itemBlocks(item)
  const message: NativeChatMessage | null = projected
    ? {
        id: item.itemId,
        role: projected.role,
        blocks: projected.blocks,
        timestamp: item.observedAt,
        source: 'transcript'
      }
    : null
  projectedItems.set(item, message)
  return message
}

export function activeStructuredAgentSessionTurnId(
  items: readonly AgentJournalRenderItem[]
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const body = items[index]?.body
    if (body?.kind === 'status' && body.turnLifecycle) {
      return body.turnLifecycle.state === 'running' ? body.turnLifecycle.turnId : null
    }
  }
  return null
}

export function hasPersistedStructuredAgentSessionTurn(
  items: readonly AgentJournalRenderItem[]
): boolean {
  return items.some(
    (item) =>
      item.body.kind === 'message' && (item.body.role === 'user' || item.body.role === 'assistant')
  )
}

/**
 * A send the host has journaled that the provider has neither opened a turn for nor refused.
 *
 * Codex declares `turn/started` within ~150ms, but Claude's running row can only be written once
 * the SDK echoes the user message back — a 3.4s median and 18s at p90 on real journals. Waiting
 * on that echo to call a session working leaves the whole gap reading idle in the chat and in
 * every session list, so the send itself is the evidence.
 *
 * `unknown` still counts: it only means the ack budget elapsed, which happens on 30% of Claude
 * sends whose turn then arrives anyway, and delivery confidence is a separate question from
 * whether work is owed. A recovered `unknown` does not — that one outlived the host generation
 * that sent it, so there is nothing still running to report.
 */
export function hasUnansweredStructuredAgentSessionDispatch(
  submissions: readonly AgentJournalSubmission[],
  currentFence?: number | null
): boolean {
  return submissions.some(
    (submission) =>
      (currentFence == null || submission.fence >= currentFence) &&
      (submission.dispatchState === 'pending' ||
        (submission.dispatchState === 'unknown' &&
          submission.recovered !== true &&
          // Older hosts publish the recovery reason but omit the optional marker.
          submission.reason !== 'host_restarted_before_acknowledgement'))
  )
}

export type StructuredAgentSessionProjectedStatus = 'working' | 'attention' | 'idle'

export function structuredAgentSessionTabId(sessionId: string): string {
  return `structured-agent-session-${sessionId}`
}

export function projectStructuredAgentSessionStatus(
  items: readonly AgentJournalRenderItem[],
  submissions: readonly AgentJournalSubmission[] = [],
  currentFence?: number | null
): StructuredAgentSessionProjectedStatus {
  if (
    items.some(
      (item) =>
        (item.body.kind === 'approval' || item.body.kind === 'question') &&
        item.body.resolution.state === 'pending'
    )
  ) {
    return 'attention'
  }
  return activeStructuredAgentSessionTurnId(items) ||
    hasUnansweredStructuredAgentSessionDispatch(submissions, currentFence)
    ? 'working'
    : 'idle'
}

export function structuredAgentSessionPaneKey(tabId: string, sessionId: string): string {
  const bytes = sha256(new TextEncoder().encode(sessionId))
  const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const leaf = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  return `${tabId}:${leaf}`
}
