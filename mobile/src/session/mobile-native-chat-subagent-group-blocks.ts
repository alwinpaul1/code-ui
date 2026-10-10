import type { NativeChatBlock } from '../../../src/shared/native-chat-types'

/**
 * A message's blocks less any `subagent-group` roster too malformed to draw.
 *
 * The phone takes journal rows from the host without validating them (only the host checks its
 * journal against the schema), and before Orca #26125 a roster was a block type the phone
 * skipped, whatever it held. The shared summary it now reads (`withoutSubagentGroupTwins`,
 * `summarizeSubagentGroup`) indexes `agents` and the row draws each child's label as text, so a
 * roster without an agent array, or a child without string fields, would take the whole row down
 * where it used to be ignored. Such a block is dropped, and its frozen sentence then stays as
 * the text it always was. With nothing to drop, the same array comes back.
 */
export function withDrawableSubagentGroups(blocks: NativeChatBlock[]): NativeChatBlock[] {
  return blocks.some((block) => block.type === 'subagent-group' && !isWellFormedRoster(block))
    ? blocks.filter((block) => block.type !== 'subagent-group' || isWellFormedRoster(block))
    : blocks
}

function isWellFormedRoster(block: object): boolean {
  if (!('groupId' in block) || typeof block.groupId !== 'string') {
    return false
  }
  return 'agents' in block && Array.isArray(block.agents) && block.agents.every(isWellFormedChild)
}

function isWellFormedChild(entry: unknown): boolean {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'id' in entry &&
    typeof entry.id === 'string' &&
    'label' in entry &&
    typeof entry.label === 'string' &&
    'state' in entry &&
    typeof entry.state === 'string'
  )
}
