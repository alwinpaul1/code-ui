import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/**
 * A matched Claude tab's rows with every run of thoughts made one "Thought process" row.
 *
 * Claude Code sends each thinking block as an assistant event of its own, and the decoder gives
 * each its own reasoning row. The Claude app (1.261013.20, reducer `t5v`) folds a thinking-only
 * assistant item into the thinking-only item before it, the texts joined by a blank line; this
 * does the same to rows that follow each other. The first row's id and time are kept.
 */
export function joinAdjacentThoughts(rows: readonly NativeChatMessage[]): NativeChatMessage[] {
  const joined: NativeChatMessage[] = []
  for (const row of rows) {
    const last = joined.at(-1)
    if (row.role === 'reasoning' && last?.role === 'reasoning') {
      joined[joined.length - 1] = { ...last, blocks: [{ type: 'text', text: `${textOf(last)}\n\n${textOf(row)}` }] }
    } else {
      joined.push(row)
    }
  }
  return joined
}

function textOf(row: NativeChatMessage): string {
  return row.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
}
