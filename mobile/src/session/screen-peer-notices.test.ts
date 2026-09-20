import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { PEER_MESSAGE_PRESENTATION } from './mobile-native-chat-peer-messages'
import {
  PEER_NOTICE_PRESENTATION,
  observeScreenPeerNotices,
  withScreenPeerNotices,
  type ScreenPeerNotice
} from './screen-peer-notices'

function row(id: string, role: NativeChatMessage['role'], text: string, presentation?: string): NativeChatMessage {
  return { id, role, timestamp: 10, source: 'transcript', blocks: [{ type: 'text', text, ...(presentation ? { presentation } : {}) }] }
}
const peerRow = (id: string, sender: string) => row(id, 'system', `From ${sender}\nhello`, PEER_MESSAGE_PRESENTATION)
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

  it('remembers the message when the row carried it, and draws it as the same card a transcript row gets', () => {
    const seen = observeScreenPeerNotices([], [{ sender: 'code-ui-6f', body: 'Capture probe: reply with received.' }], 'a1', 5)
    expect(seen[0]).toMatchObject({ sender: 'code-ui-6f', body: 'Capture probe: reply with received.' })
    const out = withScreenPeerNotices(folded, seen)
    expect(out[2]?.blocks[0]).toMatchObject({
      presentation: PEER_MESSAGE_PRESENTATION,
      text: 'From code-ui-6f\nCapture probe: reply with received.'
    })
  })

  it('draws each notice as a one-line row right after its anchor', () => {
    const notices: ScreenPeerNotice[] = [{ id: 'peer-notice:probe:1', sender: 'probe', anchorId: 'a1', sightedAt: 5 }]
    const out = withScreenPeerNotices(folded, notices)
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'peer-notice:probe:1', 'a2'])
    expect(out[2]?.role).toBe('system')
    expect(out[2]?.blocks[0]).toMatchObject({ presentation: PEER_NOTICE_PRESENTATION, text: 'Message from @probe' })
  })

  it('draws a notice whose anchor has left the loaded window at the top, not nowhere', () => {
    const out = withScreenPeerNotices(folded, [{ id: 'n', sender: 'probe', anchorId: 'gone', sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['n', 'u1', 'a1', 'a2'])
  })

  it('draws a notice sighted on an empty chat at the end', () => {
    const out = withScreenPeerNotices(folded, [{ id: 'n', sender: 'probe', anchorId: null, sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'a2', 'n'])
  })

  it('steps aside once the transcript carries the message itself, after the anchor', () => {
    const landed = [folded[0]!, folded[1]!, peerRow('p1', 'probe'), folded[2]!]
    const out = withScreenPeerNotices(landed, [{ id: 'n', sender: 'probe', anchorId: 'a1', sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'p1', 'a2'])
  })

  it('steps aside when the landed row IS the anchor: the poll saw the screen row after the transcript already had it', () => {
    const landed = [...folded, peerRow('p1', 'probe')]
    const out = withScreenPeerNotices(landed, [{ id: 'n', sender: 'probe', anchorId: 'p1', sightedAt: 5 }])
    expect(out.map((message) => message.id)).toEqual(['u1', 'a1', 'a2', 'p1'])
  })

  it('does not step aside for a transcript message from before the sighting, or from another sender', () => {
    const earlier = [peerRow('p0', 'probe'), ...folded]
    expect(withScreenPeerNotices(earlier, [{ id: 'n', sender: 'probe', anchorId: 'a1', sightedAt: 5 }]).map((m) => m.id)).toEqual([
      'p0', 'u1', 'a1', 'n', 'a2'
    ])
    const other = [folded[0]!, folded[1]!, peerRow('p1', 'reviewer'), folded[2]!]
    expect(withScreenPeerNotices(other, [{ id: 'n', sender: 'probe', anchorId: 'a1', sightedAt: 5 }]).map((m) => m.id)).toEqual([
      'u1', 'a1', 'n', 'p1', 'a2'
    ])
  })

  it('retires five notices against five landed rows one each, never all against one', () => {
    const notices = [1, 2, 3].map((n) => ({ id: `n${n}`, sender: 'probe', anchorId: 'a1', sightedAt: n }))
    const oneLanded = [folded[0]!, folded[1]!, peerRow('p1', 'probe'), folded[2]!]
    const out = withScreenPeerNotices(oneLanded, notices)
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'p1', 'n2', 'n3', 'a2'])
  })

  it('returns the same array with no notices', () => {
    expect(withScreenPeerNotices(folded, [])).toBe(folded)
    expect(textOf(withScreenPeerNotices([], [{ id: 'n', sender: 'x', anchorId: null, sightedAt: 1 }])[0]!)).toBe('Message from @x')
  })
})
