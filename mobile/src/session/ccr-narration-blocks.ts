/**
 * An event's `message.content` with each thinking block it names as narration turned into the
 * reply's words, in its place, so the decoder draws it as text and not as a "Thought process" row.
 *
 * Claude Code (2.1.300's SDK schema) lists in `narration_block_indexes`, beside `message`, the
 * indexes into `message.content` of the thinking blocks the server tagged as narration: "server
 * summaries of the prose between tool calls, not the model's own reasoning". The Claude app
 * 1.261013.20 draws such a block as plain text, its words trimmed (u5v.j: a thinking block whose
 * index is in `n8u.w` becomes `tpy(u5a.c(thinking))`), and every other thinking block as a thought.
 * On Opus 5.5 the model's own thinking is a signature with no words, so narration is the only
 * thinking that shows at all (fixtures/ccr-narration-thinking-2.1.296.ts).
 *
 * An event without the list (a CLI from before it) names none, and its thinking stays thinking, as
 * in the app. Only whole indexes can match a block, so anything else in the list names nothing.
 */
export function ccrContentWithNarrationAsText(payload: Record<string, unknown>, content: unknown): unknown {
  const listed = payload.narration_block_indexes
  if (!Array.isArray(content) || !Array.isArray(listed) || listed.length === 0) {
    return content
  }
  return content.map((item: unknown, index) => {
    const block = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : null
    if (block?.type !== 'thinking' || typeof block.thinking !== 'string' || !listed.includes(index)) {
      return item
    }
    return { type: 'text', text: block.thinking.trim() }
  })
}
