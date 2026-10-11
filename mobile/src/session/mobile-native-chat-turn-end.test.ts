import { describe, expect, it } from 'vitest'
import type { NativeChatMessage, NativeChatRole } from '../../../src/shared/native-chat-types'
import { agentTurnPlainText, agentTurnsByEnd, messageIdsEndingATurn } from './mobile-native-chat-turn-end'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'

// The Claude app draws its copy and speak actions once, at the end of the
// assistant's turn (2026-10-09 screenshot). Ours drew copy and the scroll-up
// arrow under every assistant message, even beside a tool row. A turn runs
// from a prompt to the next one, so the message that ends it is the last one
// before a prompt, a notice, or the end of the list.

const message = (id: string, role: NativeChatRole): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text: id }],
  timestamp: null,
  source: 'transcript'
})

const ending = (rows: [string, NativeChatRole][]): string[] =>
  [...messageIdsEndingATurn(rows.map(([id, role]) => message(id, role)))].sort()

describe('the message that ends a turn', () => {
  it('is the only message of a turn with a single block', () => {
    expect(ending([['u1', 'user'], ['a1', 'assistant']])).toEqual(['a1'])
  })

  it('is the last assistant message of a turn made of several', () => {
    expect(ending([['u1', 'user'], ['a1', 'assistant'], ['a2', 'assistant'], ['a3', 'assistant']])).toEqual(['a3'])
  })

  it('is not an assistant message a tool result, a thought or more words follow', () => {
    expect(
      ending([['u1', 'user'], ['a1', 'assistant'], ['t1', 'tool'], ['r1', 'reasoning'], ['a2', 'assistant']])
    ).toEqual(['a2'])
  })

  it('is one per turn when the conversation holds several', () => {
    expect(
      ending([
        ['u1', 'user'], ['a1', 'assistant'], ['a2', 'assistant'],
        ['u2', 'user'], ['a3', 'assistant'],
        ['u3', 'user'], ['a4', 'assistant'], ['a5', 'assistant']
      ])
    ).toEqual(['a2', 'a3', 'a5'])
  })

  it('is cut off by a notice, which the agent did not say', () => {
    expect(ending([['u1', 'user'], ['a1', 'assistant'], ['s1', 'system'], ['a2', 'assistant']])).toEqual(['a1', 'a2'])
  })

  it('is the last row of a list with no prompt at all', () => {
    expect(ending([['a1', 'assistant'], ['a2', 'assistant']])).toEqual(['a2'])
  })

  it('is never a prompt, even a last one', () => {
    expect(ending([['u1', 'user'], ['u2', 'user']])).toEqual([])
  })

  it('is nothing for an empty list, and the one row of a list of one', () => {
    expect(ending([])).toEqual([])
    expect(ending([['a1', 'assistant']])).toEqual(['a1'])
  })
})

// Review of claude-look-integration, 2026-10-09. With the actions drawn once per
// turn, Copy copied only the turn's LAST row: a turn of text → tool → text
// folds into two rows, and the one Copy copied "Done." alone, while the earlier
// prose had lost its own Copy. The Claude app's Copy under a reply copies the
// whole reply. And a turn whose last row had no prose, or whose newest row was
// a thought, showed no Copy at all.

const row = (id: string, role: NativeChatRole, blocks: NativeChatMessage['blocks']): NativeChatMessage => ({
  id,
  role,
  blocks,
  timestamp: null,
  source: 'transcript'
})
const text = (value: string): NativeChatMessage['blocks'][number] => ({ type: 'text', text: value })
const bashCall: NativeChatMessage['blocks'] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'npm test' } },
  { type: 'tool-result', output: 'ok' }
]

describe('the turn a turn-end row closes', () => {
  it('copies every reply row of a text, tool, text turn, in order, a blank line apart', () => {
    const rows = [
      row('u1', 'user', [text('fix it')]),
      row('a1', 'assistant', [text('Looking at **the test**.'), ...bashCall]),
      row('a2', 'assistant', [text('Done.')])
    ]
    const turn = agentTurnsByEnd(rows).get('a2')!
    expect(agentTurnPlainText(turn)).toBe('Looking at the test.\n\nDone.')
  })

  it('offers Copy at a turn end with no words when an earlier row of the turn has some', () => {
    const rows = [
      row('u1', 'user', [text('go')]),
      row('a1', 'assistant', [text('On it.')]),
      row('r1', 'reasoning', [text('thinking')]),
      row('a2', 'assistant', bashCall)
    ]
    const turns = agentTurnsByEnd(rows)
    expect([...turns.keys()]).toEqual(['a2'])
    expect(turns.get('a2')!.hasProse).toBe(true)
    expect(agentTurnPlainText(turns.get('a2')!)).toBe('On it.')
  })

  it('ends at the last row that can draw actions while a thought is the newest row', () => {
    const rows = [row('u1', 'user', [text('go')]), row('a1', 'assistant', [text('On it.')]), row('r1', 'reasoning', [text('hmm')])]
    expect([...agentTurnsByEnd(rows).keys()]).toEqual(['a1'])
    expect([...messageIdsEndingATurn(rows)]).toEqual(['a1'])
  })

  it('never copies a thought into the reply', () => {
    const rows = [row('u1', 'user', [text('go')]), row('r1', 'reasoning', [text('secret plan')]), row('a1', 'assistant', [text('Done.')])]
    expect(agentTurnPlainText(agentTurnsByEnd(rows).get('a1')!)).toBe('Done.')
  })

  it('never copies a notice that opens a turn, or a subagent\'s message', () => {
    const notice = row('s1', 'system', [{ type: 'text', text: 'Context compacted', presentation: 'compaction' }])
    const agentNote = row('s2', 'system', [{ type: 'text', text: 'hello lead', presentation: 'agent-message:Reviewer' }])
    const rows = [row('u1', 'user', [text('go')]), notice, row('a1', 'assistant', [text('Done.')]), agentNote]
    const turns = agentTurnsByEnd(rows)
    expect([...turns.keys()]).toEqual(['a1'])
    expect(agentTurnPlainText(turns.get('a1')!)).toBe('Done.')
  })

  it('starts at the first row after the prompt, a thought included', () => {
    const rows = [
      row('u0', 'user', [text('hi')]),
      row('a0', 'assistant', [text('Hello.')]),
      row('u1', 'user', [text('go')]),
      row('r1', 'reasoning', [text('hmm')]),
      row('a1', 'assistant', [text('First.'), ...bashCall]),
      row('a2', 'assistant', [text('Done.')])
    ]
    const turns = agentTurnsByEnd(rows)
    expect(turns.get('a2')!.replyRows.map((reply) => reply.id)).toEqual(['a1', 'a2'])
    expect(turns.get('a0')!.replyRows.map((reply) => reply.id)).toEqual(['a0'])
  })

  it('is nothing for an empty list, one row for a turn of one, and no Copy for its wordless only row', () => {
    expect(agentTurnsByEnd([]).size).toBe(0)
    const one = agentTurnsByEnd([row('u1', 'user', [text('go')]), row('a1', 'assistant', [text('Done.')])]).get('a1')!
    expect(one).toMatchObject({ hasProse: true })
    expect(agentTurnPlainText(one)).toBe('Done.')
    const wordless = agentTurnsByEnd([row('u1', 'user', [text('go')]), row('a1', 'assistant', bashCall)]).get('a1')!
    expect(wordless.hasProse).toBe(false)
    expect(agentTurnPlainText(wordless)).toBe('')
  })

  it('has no end at all for a turn of nothing but a thought', () => {
    expect(agentTurnsByEnd([row('u1', 'user', [text('go')]), row('r1', 'reasoning', [text('hmm')])]).size).toBe(0)
  })
})

// Review of the #26125 port: a roster row draws its live group in place of the frozen sentence,
// so the turn's Copy must not hand over that sentence either.
describe('a turn ending on a subagent roster row', () => {
  const user: NativeChatMessage = {
    id: 'u',
    role: 'user',
    blocks: [{ type: 'text', text: 'go' }],
    timestamp: null,
    source: 'transcript'
  }
  const spawn: NativeChatMessage = {
    id: 'spawn',
    role: 'system',
    blocks: [
      { type: 'text', text: 'Kicked off 2 subagents' },
      { type: 'subagent-group', groupId: 'g', agents: [{ id: 'a', label: 'review', state: 'working' }] }
    ],
    timestamp: null,
    source: 'transcript'
  }

  it('has no words to copy when the roster is all it holds', () => {
    const turn = agentTurnsByEnd([user, spawn]).get('spawn')
    expect(turn?.hasProse).toBe(false)
    expect(turn ? agentTurnPlainText(turn) : null).toBe('')
  })

  it('keeps the sentence where no group can draw', () => {
    const childless: NativeChatMessage = {
      ...spawn,
      blocks: [spawn.blocks[0]!, { type: 'subagent-group', groupId: 'g', agents: [] }]
    }
    const turn = agentTurnsByEnd([user, childless]).get('spawn')
    expect(turn ? agentTurnPlainText(turn) : null).toBe('Kicked off 2 subagents')
  })
})

// Rows the chat hides (src/shared/native-chat-noise.ts) and where a reply ends around them
// (mobile-native-chat-harness-turn-starts.ts). A `<task-notification>` user turn opens a turn
// Claude starts on (session 0954729d, 2026-10-11, Claude Code 2.1.296); any other hidden row can sit
// inside a turn and must not cut it (Opus review of 0176d0563).
describe('where a reply ends around a row the chat hides', () => {
  const notification = (id: string) =>
    row(id, 'user', [
      text('<task-notification>\n<task-id>bq251ftrg</task-id>\n<status>completed</status>\n<summary>Background command "Build" completed (exit code 0)</summary>\n</task-notification>')
    ])

  it('starts a new reply after a hidden background-task notification', () => {
    const folded = foldMobileNativeChatMessages([
      row('u1', 'user', [text('build it')]),
      row('a1', 'assistant', [text("It's building now.")]),
      notification('n1'),
      row('a2', 'assistant', [text('The build is ready.')])
    ])
    const turns = agentTurnsByEnd(folded)
    expect([...turns.keys()]).toEqual(['a1', 'a2'])
    expect(agentTurnPlainText(turns.get('a2')!)).toBe('The build is ready.')
  })

  it('does not cut a reply at a hidden system reminder inside it', () => {
    const folded = foldMobileNativeChatMessages([
      row('u1', 'user', [text('go')]),
      row('a1', 'assistant', [text('Looking.')]),
      row('s1', 'user', [text('<system-reminder>The task tools have not been used recently.</system-reminder>')]),
      row('a2', 'assistant', [text('Done.')])
    ])
    const turns = agentTurnsByEnd(folded)
    expect([...turns.keys()]).toEqual(['a2'])
    expect(turns.get('a2')!.replyRows.map((reply) => reply.id)).toEqual(['a1', 'a2'])
  })

  it('does not let a row id seen after a notification in one transcript cut a turn in another', () => {
    foldMobileNativeChatMessages([notification('n1'), row('m-3', 'assistant', [text('other session')])])
    const turns = agentTurnsByEnd([
      row('p', 'user', [text('go')]),
      row('m-2', 'assistant', [text('First.')]),
      row('m-3', 'assistant', [text('Second.')])
    ])
    expect([...turns.keys()]).toEqual(['m-3'])
  })

  it('degenerate: a notification with nothing after it yet marks nothing, and a lone reply after one is its own turn', () => {
    expect(foldMobileNativeChatMessages([row('a1', 'assistant', [text('Only.')]), notification('n1')]).map((r) => r.id)).toEqual(['a1'])
    const folded = foldMobileNativeChatMessages([notification('n1'), row('a1', 'assistant', [text('Only.')])])
    expect([...agentTurnsByEnd(folded).keys()]).toEqual(['a1'])
  })
})
