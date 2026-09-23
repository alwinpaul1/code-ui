import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { PEER_BOILERPLATE_PRESENTATION, PEER_BOILERPLATE_TEXT } from './mobile-native-chat-peer-messages'
import { observeScreenPeerNotices, withScreenPeerNotices } from './screen-peer-notices'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'

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

