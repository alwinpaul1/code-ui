// Orca #19229 (e80fae0c4) on the phone. Before this, every stream frame
// re-projected the WHOLE transcript: `state.items` gets a new array identity on
// each reducer update, the `useMemo` in `use-mobile-structured-agent-session`
// fires, and each of the hundreds of unchanged rows was rebuilt into a brand
// new `NativeChatMessage`. New objects defeat every downstream memo — the fold,
// the row components — so one changed row repainted the whole list.
//
// The rows that did not change must come back as the same objects they were.

import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import { projectStructuredAgentSessionMessages } from '../../../src/shared/structured-agent-session-message-projection'
import {
  projectStructuredItemToNativeChat,
  projectStructuredItemsToNativeChat
} from '../../../src/shared/structured-agent-session-projection'

function textItem(itemId: string, text: string, revision = 1): AgentJournalRenderItem {
  return {
    itemId,
    revision,
    sequence: Number(itemId.split('-')[1] ?? 0),
    observedAt: 1_000,
    body: {
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text }]
    } as AgentJournalRenderItem['body']
  }
}

describe('a transcript row that did not change on this stream frame', () => {
  it('comes back as the same projected message after the reducer replaces the array', () => {
    const settled = [textItem('row-1', 'first'), textItem('row-2', 'second')]
    const before = projectStructuredAgentSessionMessages(settled, [], [])
    // What the reducer does on an append: a NEW array, the same item objects,
    // plus the row that actually arrived.
    const after = projectStructuredAgentSessionMessages(
      [...settled, textItem('row-3', 'third')],
      [],
      []
    )
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]?.id).toBe('row-3')
  })

  it('re-projects a row the reducer replaced, and only that row', () => {
    const first = textItem('row-1', 'first')
    const growing = textItem('row-2', 'part')
    const before = projectStructuredAgentSessionMessages([first, growing], [], [])
    // A streaming row arrives again with more text, as a new object.
    const after = projectStructuredAgentSessionMessages(
      [first, textItem('row-2', 'part two', 2)],
      [],
      []
    )
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[1]?.blocks).toEqual([{ type: 'text', text: 'part two' }])
  })

  it('answers the single-item projection with the same object as the list projection', () => {
    const item = textItem('row-1', 'first')
    expect(projectStructuredItemToNativeChat(item)).toBe(projectStructuredItemsToNativeChat([item])[0])
  })
})
