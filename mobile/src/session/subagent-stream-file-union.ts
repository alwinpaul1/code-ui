import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * A subagent's rows as the Agent sheet and its transcript viewer draw them: Orca's file is the
 * baseline, and Anthropic's stream adds what the file does not hold yet.
 *
 * The stream alone undercounts. The tab's store drops undrawn events past
 * `CCR_HELD_UNDRAWN_EVENTS` (ccr-link-store.ts), and a subagent's own events never draw a row in
 * the lead's chat, so a long agent keeps only its newest calls there (review 2026-10-15: one
 * streamed call against four in the file read "Tool calls (1)").
 *
 * The two sources share their keys: a streamed row's id is the event's `uuid`, which is the
 * transcript line's `uuid`, and a tool call or result carries its `tool_use_id` as `callId` in
 * both. A streamed row whose id the file already holds is dropped whole; otherwise each tool call
 * or result the file already holds is dropped from it, and a row left with no blocks goes.
 */
export function unionSubagentMessages(
  file: readonly NativeChatMessage[],
  streamed: readonly NativeChatMessage[]
): NativeChatMessage[] {
  if (streamed.length === 0) {
    return [...file]
  }
  const ids = new Set(file.map((message) => message.id))
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const block of file.flatMap((message) => message.blocks)) {
    if (block.type === 'tool-call' && block.callId) {
      calls.add(block.callId)
    } else if (block.type === 'tool-result' && block.callId) {
      results.add(block.callId)
    }
  }
  const held = (block: NativeChatBlock): boolean =>
    (block.type === 'tool-call' && !!block.callId && calls.has(block.callId)) ||
    (block.type === 'tool-result' && !!block.callId && results.has(block.callId))
  const extra: NativeChatMessage[] = []
  for (const message of streamed) {
    if (ids.has(message.id)) {
      continue
    }
    const blocks = message.blocks.filter((block) => !held(block))
    if (blocks.length === message.blocks.length) {
      extra.push(message)
    } else if (blocks.length > 0) {
      extra.push({ ...message, blocks })
    }
  }
  return [...file, ...extra]
}
