import type { NativeChatBlock, NativeChatMessage, NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import type { CcrEvent } from './ccr-session-api'
import { withRefusalPrompts } from './ccr-refusal-rows'
import { joinAdjacentThoughts } from './ccr-thought-rows'
import { markAttachmentMissing } from './mobile-native-chat-file-mentions'

/**
 * Events that draw no row of their own but change rows the chat already drew, as the Claude app
 * 1.261013.20's reducer (t5v.java) applies them. Neither has been captured live: the shapes are
 * Claude Code 2.1.300's SDK schemas (fixtures/ccr-refusal-suggestion-events-2.1.300.ts).
 *
 *  - `tool_use_summary` {summary, preceding_tool_use_ids}: names a run of tool calls. The app
 *    (t5v.java:1136-1173) takes the first id that belongs to a group it drew, and labels that group
 *    with the summary, trimmed at the end and with trailing `. , ; : ! ?` taken off; an empty
 *    summary clears the label, and a later summary for the same group replaces it. Here the label
 *    rides on that call's block, with the summary's place in the stream, and the run that holds
 *    the call reads the newest one (`ccrRunLabel`).
 *  - `system` `file_attachments_missing` {message_uuid, missing:[{file_uuid}]}: the lead's prompt
 *    with that uuid lost those files on the way (s8u.a: no `parent_tool_use_id`, a uuid, a
 *    non-empty set, else nothing). The newest set replaces the last (t5v.java:2506-2541), and one
 *    that arrives before its prompt waits for it, which reading every event at once gives for free.
 */

/** The label a summary gave the run a call opened, and where in the stream the summary stood. */
type CcrRunLabel = { text: string; at: number }
type LabelledCall = NativeChatToolCallBlock & { ccrRunLabel?: CcrRunLabel }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Whether an event only changes rows already drawn: held and kept as a drawn one is. A subagent's
 *  own (`parent_tool_use_id` set) annotates nothing in the lead's chat, so it falls under the
 *  undrawn cap like any other event (review 2026-10-15: a flood of them was held for good). */
export function ccrEventAnnotatesRows(event: CcrEvent): boolean {
  const payload = event.payload
  if (payload.parent_tool_use_id) {
    return false
  }
  return payload.type === 'tool_use_summary' || (payload.type === 'system' && payload.subtype === 'file_attachments_missing')
}

/** Every pass over the decoded rows: thoughts joined, refusal prefills, then these annotations. */
export function ccrRowPasses(rows: NativeChatMessage[], events: readonly CcrEvent[]): NativeChatMessage[] {
  return withCcrAnnotations(withRefusalPrompts(joinAdjacentThoughts(rows)), events)
}

/** The app's label for a summary: null for one that leaves nothing (it clears the label). */
function runLabelText(summary: unknown): string | null {
  if (typeof summary !== 'string') {
    return null
  }
  const text = summary.trimEnd().replace(/[.,;:!?]+$/, '')
  return text.length > 0 ? text : null
}

export function withCcrAnnotations(rows: NativeChatMessage[], events: readonly CcrEvent[]): NativeChatMessage[] {
  const labels = new Map<string, CcrRunLabel>()
  const missing = new Map<string, Set<string>>()
  let callIds: Set<string> | null = null
  events.forEach((event, at) => {
    const payload = event.payload
    if (payload.type === 'tool_use_summary' && Array.isArray(payload.preceding_tool_use_ids)) {
      callIds ??= new Set(rows.flatMap((row) => row.blocks.flatMap((block) => (block.type === 'tool-call' && block.callId ? [block.callId] : []))))
      const known = callIds
      const first = payload.preceding_tool_use_ids.find((id): id is string => typeof id === 'string' && known.has(id))
      if (first) {
        labels.set(first, { text: runLabelText(payload.summary) ?? '', at })
      }
    } else if (payload.type === 'system' && payload.subtype === 'file_attachments_missing' && !payload.parent_tool_use_id && typeof payload.message_uuid === 'string') {
      const uuids = Array.isArray(payload.missing) ? payload.missing.flatMap((entry) => (typeof record(entry)?.file_uuid === 'string' ? [record(entry)!.file_uuid as string] : [])) : []
      if (uuids.length > 0) {
        missing.set(payload.message_uuid, new Set(uuids))
      }
    }
  })
  if (labels.size === 0 && missing.size === 0) {
    return rows
  }
  return rows.map((row) => {
    const lost = row.role === 'user' ? missing.get(row.id) : undefined
    const labelled = row.blocks.some((block) => block.type === 'tool-call' && block.callId && labels.has(block.callId))
    if (!lost && !labelled) {
      return row
    }
    const blocks = row.blocks.map((block): NativeChatBlock => {
      if (block.type === 'tool-call' && block.callId && labels.has(block.callId)) {
        return { ...block, ccrRunLabel: labels.get(block.callId)! } as LabelledCall
      }
      return lost ? markAttachmentMissing(block, lost) : block
    })
    return { ...row, blocks }
  })
}

/** The label of the run these blocks draw: the newest summary that named one of its calls, or
 *  null when none did or the newest one cleared it. */
export function ccrRunLabel(blocks: readonly NativeChatBlock[]): string | null {
  let newest: CcrRunLabel | null = null
  for (const block of blocks) {
    const label = block.type === 'tool-call' ? (block as LabelledCall).ccrRunLabel : undefined
    if (label && (!newest || label.at > newest.at)) {
      newest = label
    }
  }
  return newest && newest.text.length > 0 ? newest.text : null
}
