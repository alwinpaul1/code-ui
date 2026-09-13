import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

/** Which chat these rows belong to: only Claude Code with a readable transcript
 *  is known to deliver its reasoning this way. */
export type ThinkingRowScope = { agent: string | null; transcriptReadable: boolean }

/**
 * Rows that are the model's REASONING, delivered as if they were its reply.
 *
 * Claude Code records interim commentary as `thinking` blocks (its own screen
 * tags them "· summarized"). The desktop's transcript reader has no handling
 * for that block type, so the text never arrives as a transcript row; the
 * host's hook stream carries it instead, and the assembler keeps a hook row
 * only when the transcript has nothing for that turn. So on Claude, with the
 * transcript readable, an assistant row that did not come from the transcript
 * is reasoning — and the phone drew it as a reply, in prose the model never
 * said to the user (2026-09-13, "the entire message is wrong").
 *
 * Applied AFTER the fold, on purpose: as an assistant row it is the anchor the
 * turn's tool calls fold into ("Ran 6 commands"), and a reasoning row would not
 * be. The prose moves to a collapsed Thinking row and the tool fold stays on
 * the original row, under its original id, so anchors and previews still find
 * it. The Claude app draws the same: a collapsed thought, then the work.
 */
export function splitHookThinkingRows(
  folded: readonly NativeChatMessage[],
  scope: ThinkingRowScope
): NativeChatMessage[] {
  if (!isClaude(scope.agent) || !scope.transcriptReadable) {
    return [...folded]
  }
  const out: NativeChatMessage[] = []
  for (const message of folded) {
    if (message.role !== 'assistant' || message.source === 'transcript') {
      out.push(message)
      continue
    }
    const prose = message.blocks.filter((block) => block.type === 'text' && block.text.trim().length > 0)
    if (prose.length === 0) {
      out.push(message)
      continue
    }
    const rest = message.blocks.filter((block) => block.type !== 'text')
    if (rest.length === 0) {
      // Nothing but the thought: it keeps its id, so anything anchored on it
      // still resolves.
      out.push({ ...message, role: 'reasoning', blocks: prose })
      continue
    }
    out.push({ ...message, id: `${message.id}:thinking`, role: 'reasoning', blocks: prose })
    out.push({ ...message, blocks: rest })
  }
  return out
}

function isClaude(agent: string | null): boolean {
  return agent === 'claude' || agent === 'openclaude'
}
