import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { PEER_BOILERPLATE_PRESENTATION, PEER_BOILERPLATE_TEXT } from './mobile-native-chat-peer-messages'
import { observeScreenPeerNotices, withScreenPeerNotices, type ScreenPeerNotice } from './screen-peer-notices'
import { paintedAfterAnchor } from './use-screen-peer-notices'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { agentMessageOf } from './mobile-native-chat-agent-messages'
import { peerNoticesFromScreen } from './mobile-terminal-peer-notices'

function row(id: string, role: NativeChatMessage['role'], text: string, presentation?: string): NativeChatMessage {
  return { id, role, timestamp: 10, source: 'transcript', blocks: [{ type: 'text', text, ...(presentation ? { presentation } : {}) }] }
}
/** A transcript peer turn as the fold draws it: the boilerplate bubble, no sender in sight. */
const peerRow = (id: string, _sender: string) => row(id, 'system', PEER_BOILERPLATE_TEXT, PEER_BOILERPLATE_PRESENTATION)
const textOf = (message: NativeChatMessage) => (message.blocks[0]?.type === 'text' ? message.blocks[0].text : '')

describe('peer message rows read off the screen, placed into the chat', () => {
  const folded = [row('u1', 'user', 'start'), row('a1', 'assistant', 'working'), row('a2', 'assistant', 'done')]

  it('records a sighting once, anchored at the tail of that moment, and keeps it across polls', () => {
    const first = observeScreenPeerNotices([], [{ sender: 'probe' }], 'a1', 5)
    expect(first).toEqual([{ id: 'peer-notice:probe:1', sender: 'probe', anchorId: 'a1', sightedAt: 5 }])
    expect(observeScreenPeerNotices(first, [{ sender: 'probe' }], 'a2', 6)).toBe(first)
    expect(observeScreenPeerNotices(first, [], 'a2', 6)).toBe(first)
  })

  it('counts a second row from the same sender as a second message, anchored where it was first seen', () => {
    const one = observeScreenPeerNotices([], [{ sender: 'probe' }], 'a1', 5)
    const two = observeScreenPeerNotices(one, [{ sender: 'probe' }, { sender: 'probe' }], 'a2', 6)
    expect(two.map((notice) => [notice.sender, notice.anchorId])).toEqual([
      ['probe', 'a1'],
      ['probe', 'a2']
    ])
  })

  // 2026-09-21: the user wants the same bubble before every subagent reply
  // and no "From <sender>" card, whichever surface the message came from.
  // The screen row's body is remembered but not drawn.
  it('draws another session\'s message as the same boilerplate bubble a transcript turn gets, right after its anchor', () => {
    const seen = observeScreenPeerNotices([], [{ sender: 'code-ui-6f', body: 'Capture probe: reply with received.' }], 'a1', 5)
    expect(seen[0]).toMatchObject({ sender: 'code-ui-6f', body: 'Capture probe: reply with received.' })
    const out = withScreenPeerNotices(folded, seen)
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'peer-notice:code-ui-6f:1', 'a2'])
    expect(out[2]?.role).toBe('system')
    expect(out[2]?.blocks).toEqual([{ type: 'text', presentation: PEER_BOILERPLATE_PRESENTATION, text: PEER_BOILERPLATE_TEXT }])

  })

  // 2026-09-24, from the phone: the Claude app draws no bubble for a row that
  // names only its sender, a subagent handing its report back.
  it('draws nothing for a row that names only its sender', () => {
    const bare = withScreenPeerNotices(folded, [{ id: 'peer-notice:probe:1', sender: 'probe', anchorId: 'a1', sightedAt: 5 }])
    expect(bare).toBe(folded)
  })

  it('draws a notice whose anchor has left the loaded window at the top, not nowhere', () => {
    const out = withScreenPeerNotices(folded, [{ id: 'n', sender: 'probe', body: 'status?', anchorId: 'gone', sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['n', 'u1', 'a1', 'a2'])
  })

  it('goes after the drawn row it was seen under only while that row sits after its anchor', () => {
    const notice = { id: 'n', sender: 'code-ui-6f', body: 'status?', anchorId: 'a1', afterId: 'm', sightedAt: 5 }
    const drawn = row('m', 'system', 'Message from probe')
    const ids = (rows: NativeChatMessage[]) => withScreenPeerNotices(rows, [notice]).map((message) => message.id)
    expect(ids([folded[0]!, folded[1]!, drawn, folded[2]!])).toEqual(['u1', 'a1', 'm', 'n', 'a2'])
    expect(ids([folded[0]!, drawn, folded[1]!, folded[2]!])).toEqual(['u1', 'm', 'a1', 'n', 'a2'])
    expect(ids(folded)).toEqual(['u1', 'a1', 'n', 'a2'])
  })

  it('draws a notice sighted on an empty chat at the end', () => {
    const out = withScreenPeerNotices(folded, [{ id: 'n', sender: 'probe', body: 'status?', anchorId: null, sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'a2', 'n'])
  })

  it('steps aside once the transcript carries the message itself, after the anchor', () => {
    const landed = [folded[0]!, folded[1]!, peerRow('p1', 'probe'), folded[2]!]
    const out = withScreenPeerNotices(landed, [{ id: 'n', sender: 'probe', body: 'status?', anchorId: 'a1', sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'p1', 'a2'])
  })

  it('steps aside when the landed row IS the anchor: the poll saw the screen row after the transcript already had it', () => {
    const landed = [...folded, peerRow('p1', 'probe')]
    const out = withScreenPeerNotices(landed, [{ id: 'n', sender: 'probe', body: 'status?', anchorId: 'p1', sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'a2', 'p1'])
  })

  it('does not step aside for a transcript message from before the sighting', () => {
    const earlier = [peerRow('p0', 'probe'), ...folded]
    expect(withScreenPeerNotices(earlier, [{ id: 'n', sender: 'probe', body: 'status?', anchorId: 'a1', sightedAt: 5 }]).map((m) => m.id)).toEqual([
      'p0', 'u1', 'a1', 'n', 'a2'
    ])
  })

  it('steps aside for a landed bubble whoever sent it: every bubble reads the same, so a mispairing changes nothing on screen', () => {
    // The transcript bubble names no sender any more (the card that did is
    // gone), so retirement pairs notices with landed bubbles in order.
    const other = [folded[0]!, folded[1]!, peerRow('p1', 'reviewer'), folded[2]!]
    expect(withScreenPeerNotices(other, [{ id: 'n', sender: 'probe', body: 'status?', anchorId: 'a1', sightedAt: 5 }]).map((m) => m.id)).toEqual([
      'u1', 'a1', 'p1', 'a2'
    ])
  })

  it('retires five notices against five landed rows one each, never all against one', () => {
    const notices = [1, 2, 3].map((n) => ({ id: `n${n}`, sender: 'probe', body: 'status?', anchorId: 'a1', sightedAt: n }))
    const oneLanded = [folded[0]!, folded[1]!, peerRow('p1', 'probe'), folded[2]!]
    const out = withScreenPeerNotices(oneLanded, notices)
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'p1', 'n2', 'n3', 'a2'])
  })

  it('returns the same array with no notices', () => {
    expect(withScreenPeerNotices(folded, [])).toBe(folded)
    expect(textOf(withScreenPeerNotices([], [{ id: 'n', sender: 'x', body: 'hi', anchorId: null, sightedAt: 1 }])[0]!)).toBe(PEER_BOILERPLATE_TEXT)
  })
})

// Claude Code 2.1.280 paints a lead's message in a teammate session as the
// collapsed `› Message from @team-lead (ctrl+o to expand)` row, and the
// transcript carries it as a bare <teammate-message> turn the fold draws as the
// user's bubble. One message, so one bubble: the landed row takes the notice.
describe("a lead's message the screen and the transcript both carry", () => {
  const lead = (text: string) => `<teammate-message teammate_id="team-lead">\n${text}\n</teammate-message>`

  it('draws the opening task once, not again as a peer bubble', () => {
    const folded = foldMobileNativeChatMessages([
      row('task', 'user', lead('Build the job.')),
      row('a1', 'assistant', 'Reading the code.')
    ])
    const seen = observeScreenPeerNotices([], [{ sender: 'team-lead' }], null, 5)
    expect(withScreenPeerNotices(folded, seen).map((message) => message.id)).toEqual(['task', 'a1'])
  })

  it('draws the opening task once when the screen was first read after the chat had moved past it', () => {
    // Opening a teammate tab soon after it spawned: the snapshot lands before
    // the first screen read, so the sighting is anchored after the task.
    const folded = foldMobileNativeChatMessages([
      row('task', 'user', lead('Build the job.')),
      row('a1', 'assistant', 'Reading the code.'),
      row('a2', 'assistant', 'Writing it.')
    ])
    const seen = observeScreenPeerNotices([], [{ sender: 'team-lead' }], 'a2', 5)
    expect(withScreenPeerNotices(folded, seen).map((message) => message.id)).toEqual(['task', 'a1', 'a2'])
  })

  it('draws the task once when it quotes an image marker the phone turns into a chip', () => {
    const folded = foldMobileNativeChatMessages([
      row('task', 'user', lead('Match the layout in [Image #1].')),
      row('a1', 'assistant', 'Reading the code.')
    ])
    const seen = observeScreenPeerNotices([], [{ sender: 'team-lead' }], null, 5)
    expect(withScreenPeerNotices(folded, seen).map((message) => message.id)).toEqual(['task', 'a1'])
  })

  it("keeps another session's bubble in a teammate session when a lead's follow-up lands after it", () => {
    const before = foldMobileNativeChatMessages([row('task', 'user', lead('Build the job.')), row('a1', 'assistant', 'Built.')])
    const seen = observeScreenPeerNotices([], [{ sender: 'observer-7', body: 'Status?' }], 'a1', 5)
    const after = foldMobileNativeChatMessages([
      row('task', 'user', lead('Build the job.')),
      row('a1', 'assistant', 'Built.'),
      row('more', 'user', lead('Also time the CPU path.')),
      row('a2', 'assistant', 'Timing it.')
    ])
    expect(withScreenPeerNotices(before, seen).map((message) => message.id)).toEqual([
      'task',
      'a1',
      'peer-notice:observer-7:1'
    ])
    expect(withScreenPeerNotices(after, seen).map((message) => message.id)).toEqual([
      'task',
      'a1',
      'peer-notice:observer-7:1',
      'more',
      'a2'
    ])
  })

  // The lead's rows name only their sender on a teammate's screen. Drawn as
  // subagent rows (a tab with no prompt hook), they would stand beside the
  // task bubble that is the same message.
  it('draws the task and a follow-up once on a tab with no prompt hook, never also as "Message from team-lead"', () => {
    const folded = foldMobileNativeChatMessages([
      row('task', 'user', lead('Build the job.')),
      row('a1', 'assistant', 'Reading the code.'),
      row('more', 'user', lead('Also time the CPU path.')),
      row('a2', 'assistant', 'Timing it.')
    ])
    const first = observeScreenPeerNotices([], [{ sender: 'team-lead' }], null, 5)
    const both = observeScreenPeerNotices(first, [{ sender: 'team-lead' }, { sender: 'team-lead' }], 'a2', 6)
    expect(withScreenPeerNotices(folded, both, { subagentRows: true }).map((message) => message.id)).toEqual([
      'task',
      'a1',
      'more',
      'a2'
    ])
  })

  it('draws a follow-up once, when the screen saw it before the transcript landed it', () => {
    const before = foldMobileNativeChatMessages([row('task', 'user', lead('Build the job.')), row('a1', 'assistant', 'Built.')])
    const first = observeScreenPeerNotices([], [{ sender: 'team-lead' }], null, 5)
    const second = observeScreenPeerNotices(first, [{ sender: 'team-lead' }, { sender: 'team-lead' }], 'a1', 6)
    const after = foldMobileNativeChatMessages([
      row('task', 'user', lead('Build the job.')),
      row('a1', 'assistant', 'Built.'),
      row('more', 'user', lead('Also time the CPU path.')),
      row('a2', 'assistant', 'Timing it.')
    ])
    expect(withScreenPeerNotices(before, first).map((message) => message.id)).toEqual(['task', 'a1'])
    expect(withScreenPeerNotices(after, second).map((message) => message.id)).toEqual(['task', 'a1', 'more', 'a2'])
  })
})

// Session 967668df, 2026-09-24 (Claude Code 2.1.280): a subagent this session
// launched hands its report back as a queued_command with origin.kind "peer"
// and handback true. The Claude app draws no bubble for it, only the session's
// own "Messaged @agent" call; the phone drew the peer boilerplate off the
// screen's "› Message from @a8f65c53ecfad2908" row.
describe("a report handed back by this session's own subagent", () => {
  const call = (id: string, name: string, input: unknown): NativeChatMessage => ({
    id,
    role: 'assistant',
    timestamp: 10,
    source: 'transcript',
    blocks: [{ type: 'tool-call', name, input }]
  })
  const result = (id: string, output: string): NativeChatMessage => ({
    id,
    role: 'user',
    timestamp: 10,
    source: 'transcript',
    blocks: [{ type: 'tool-result', output }]
  })
  const launched = [
    call('c1', 'Agent', { description: 'Review Windows host-control fixes', prompt: 'Review…' }),
    result(
      'r1',
      'Async agent launched successfully. (This tool result is internal metadata — never quote it.)\nagentId: a8f65c53ecfad2908 (internal ID - do not mention to user.)'
    ),
    row('a1', 'assistant', 'Reviewer is running.')
  ]

  it('draws no peer bubble for a hand-back from an agent this session launched', () => {
    const seen = observeScreenPeerNotices([], [{ sender: 'a8f65c53ecfad2908' }], 'a1', 5)
    expect(withScreenPeerNotices(launched, seen).map((message) => message.id)).toEqual(['c1', 'r1', 'a1'])
  })

  it('draws none for an agent this session messaged by name either', () => {
    const folded = [...launched, call('c2', 'SendMessage', { to: 'reviewer', summary: 'Re-check', message: '…' })]
    const seen = observeScreenPeerNotices([], [{ sender: 'reviewer' }], 'c2', 5)
    expect(withScreenPeerNotices(folded, seen).map((message) => message.id)).toEqual(['c1', 'r1', 'a1', 'c2'])
  })

  it('still draws the bubble for a message from anyone this session did not launch or message', () => {
    const seen = observeScreenPeerNotices([], [{ sender: 'observer-7', body: 'Status?' }], 'a1', 5)
    expect(withScreenPeerNotices(launched, seen).map((message) => message.id)).toEqual([
      'c1',
      'r1',
      'a1',
      'peer-notice:observer-7:1'
    ])
  })
})


// 2026-09-26, the user's screenshots of Claude Code 2.1.283's TUI: a subagent's
// message is a folded row in the turn, "› Message from @general-purpose (ctrl+o
// to expand)". Where no prompt hook carries it, that row is all the phone has.
describe("a subagent's row on a tab with no prompt hook", () => {
  const SCREEN = ['  Read 1 file, ran 2 shell commands', '', '› Message from @general-purpose (ctrl+o to expand)', '', '  Read 1 file']
  const drawn = (rows: readonly NativeChatMessage[]) =>
    rows.map((message) => {
      const agent = agentMessageOf(message)
      return agent ? `Message from ${agent.sender}${agent.body ? `: ${agent.body}` : ''}` : message.id
    })

  it('is drawn as "Message from general-purpose" after the row it was seen under, with no words it never had', () => {
    const folded = [row('u1', 'user', 'start'), row('a1', 'assistant', 'working'), row('a2', 'assistant', 'done')]
    const seen = observeScreenPeerNotices([], peerNoticesFromScreen(SCREEN), 'a1', 5)
    expect(drawn(withScreenPeerNotices(folded, seen, { subagentRows: true }))).toEqual([
      'u1',
      'a1',
      'Message from general-purpose',
      'a2'
    ])
  })

  it('never takes over a peer bubble the transcript landed after it, and that bubble still retires its own notice', () => {
    const folded = [row('a1', 'assistant', 'working'), peerRow('t1', 'code-ui-6f')]
    const seen = observeScreenPeerNotices(
      [],
      [{ sender: 'general-purpose' }, { sender: 'code-ui-6f', body: 'Capture probe' }],
      'a1',
      5
    )
    expect(drawn(withScreenPeerNotices(folded, seen, { subagentRows: true }))).toEqual([
      'a1',
      'Message from general-purpose',
      't1'
    ])
  })

  it('is drawn on a chat of one row, and at the end of an empty one', () => {
    const one = [row('a1', 'assistant', 'only')]
    const seen = observeScreenPeerNotices([], [{ sender: 'probe' }], 'a1', 5)
    expect(drawn(withScreenPeerNotices(one, seen, { subagentRows: true }))).toEqual(['a1', 'Message from probe'])
    const empty = observeScreenPeerNotices([], [{ sender: 'probe' }], null, 5)
    expect(drawn(withScreenPeerNotices([], empty, { subagentRows: true }))).toEqual(['Message from probe'])
  })
})

// Review of 2026-09-26: a sender's rows on the screen were counted, and the
// Nth row taken as the Nth message. A subagent's row names only its sender,
// and the first has scrolled off by the time the agent writes again, so the
// screen shows one row, the count says one is known, and the second message
// was never drawn. What was painted above each row tells them apart.
//
// The screen is the real capture of Claude Code 2.1.278 at 46 columns
// (fixtures/claude-screen-peer-message-2.1.278.txt; the row is unchanged
// through 2.1.283, mobile-terminal-peer-notices.ts). The later screen is that
// capture scrolled past its row, with a second row from the same agent
// painted the same way at the end of the turn.
describe('a second message from the same subagent on a tab with no prompt hook', () => {
  const capture = readFileSync(
    fileURLToPath(new URL('./fixtures/claude-screen-peer-message-2.1.278.txt', import.meta.url)),
    'utf8'
  ).split('\n')
  const ROW = '› Message from @probe (ctrl+o to expand)'
  const at = capture.indexOf(ROW)
  const box = capture.findIndex((line) => line.startsWith('───'))
  /** The turn after the first row, a second row, and the input box. */
  const later = [...capture.slice(at + 1, box), '', ROW, '', ...capture.slice(box)]
  // The transcript rows the chat holds: the reply above the first row, and
  // the one the capture paints after it (its lines 32 to 35), as Claude
  // wrote them.
  const folded = [
    row('a1', 'assistant', "The probe agent is running. I'll reply once its message arrives.\n\nsession:ok"),
    row('a2', 'assistant', 'received\n\nsession:ok'),
    row('a3', 'assistant', 'The probe agent has finished and gone idle.\nNothing further to do.\n\nsession:ok')
  ]
  /** What the chat reads above a row: its own transcript after the notice's anchor. */
  const evidence = (notice: ScreenPeerNotice, above: string) => paintedAfterAnchor(folded, notice.anchorId, above)
  const observe = (previous: readonly ScreenPeerNotice[], screen: readonly string[], tail: string, now: number) =>
    observeScreenPeerNotices(previous, peerNoticesFromScreen(screen), tail, now, undefined, evidence)
  const drawn = (rows: readonly NativeChatMessage[]) =>
    rows.map((message) => (agentMessageOf(message) ? `from ${agentMessageOf(message)!.sender}` : message.id))

  it('is drawn as a second row once the first has scrolled off', () => {
    // The first row and the reply above it are off this screen.
    expect(later.filter((line) => line === ROW)).toHaveLength(1)
    expect(later).not.toContain('  its message arrives.')
    const first = observe([], capture, 'a1', 5)
    const second = observe(first, later, 'a3', 9)
    expect(drawn(withScreenPeerNotices(folded, second, { subagentRows: true }))).toEqual([
      'a1',
      'from probe',
      'a2',
      'a3',
      'from probe'
    ])
  })

  it('is not drawn again while the first is still on screen, however far the screen scrolled', () => {
    const first = observe([], capture, 'a1', 5)
    expect(observe(first, capture.slice(8), 'a3', 9)).toBe(first)
    const both = observe(first, [...capture.slice(0, box), '', ROW, '', ...capture.slice(box)], 'a3', 9)
    expect(both.map((notice) => notice.anchorId)).toEqual(['a1', 'a3'])
    expect(observe(both, later, 'a3', 10)).toBe(both)
  })

  it('is refused while its row is too near the top of the screen to read what is above it', () => {
    const first = observe([], capture, 'a1', 5)
    const top = later.slice(later.indexOf(ROW) - 1)
    expect(peerNoticesFromScreen(top)[0]?.above).toBeUndefined()
    expect(observe(first, top, 'a3', 9)).toBe(first)
  })

  it('is refused when it reads like an older message than the last one drawn', () => {
    const first = observe([], capture, 'a1', 5)
    const second = observe(first, later, 'a3', 9)
    // The desk scrolled back to the first: nothing new is drawn for it.
    expect(observe(second, capture, 'a3', 10)).toBe(second)
  })

  // Review of 2026-09-27: the text above a known row changes when the desk
  // repaints it, and a changed text alone is no evidence of a new message. A
  // reply ending in a table is repainted with narrower borders after a resize.
  it('is still one message when a table above its row is repainted narrower', () => {
    const wide = ['⏺ Done. The two runs:', '  ┌──────────────────────┬────────────┐', '  │ run                  │ result     │', '  └──────────────────────┴────────────┘', '', ROW]
    const narrow = ['⏺ Done. The two runs:', '  ┌──────────────┬──────────┐', '  │ run          │ result   │', '  └──────────────┴──────────┘', '', ROW]
    const tables = [row('a1', 'assistant', 'Done. The two runs:\n\n| run | result |\n|---|---|')]
    const seen = (previous: readonly ScreenPeerNotice[], screen: readonly string[]) =>
      observeScreenPeerNotices(previous, peerNoticesFromScreen(screen), 'a1', 5, undefined, (notice, above) =>
        paintedAfterAnchor(tables, notice.anchorId, above)
      )
    const first = seen([], wide)
    expect(seen(first, narrow)).toBe(first)
    expect(seen(seen(first, narrow), wide)).toBe(first)
  })
})
