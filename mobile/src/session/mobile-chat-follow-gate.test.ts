import { describe, expect, it } from 'vitest'
import { createChatFollowGate } from './mobile-chat-follow-gate'

describe('following the live edge on a content-size change', () => {
  it('follows when new data arrived', () => {
    const gate = createChatFollowGate()
    gate.noteData(['m1'])
    expect(gate.shouldFollow(true)).toBe(true)
  })

  // 2026-09-12: press and hold a sentence, and the whole transcript scrolled
  // to the newest message before the copy toolbar could show. Selection
  // handles re-measure the text, which is a content-size change with no new
  // data behind it.
  it('does not follow on a re-measure with no new data, so a long-press keeps its place', () => {
    const gate = createChatFollowGate()
    gate.noteData(['m1'])
    expect(gate.shouldFollow(true)).toBe(true)
    // selection handles appear → another content-size change, same data
    expect(gate.shouldFollow(true)).toBe(false)
  })

  it('follows again once data changes again, one follow per change', () => {
    const gate = createChatFollowGate()
    gate.noteData(['m1'])
    gate.shouldFollow(true)
    gate.noteData(['m1', 'm2'])
    expect(gate.shouldFollow(true)).toBe(true)
    expect(gate.shouldFollow(true)).toBe(false)
  })

  it('never follows while the reader is up in history, and does not bank the change', () => {
    const gate = createChatFollowGate()
    gate.noteData(['m1'])
    expect(gate.shouldFollow(false)).toBe(false)
    // back at the edge with nothing new since: stay put
    expect(gate.shouldFollow(true)).toBe(false)
  })
})

// The screen recording of 2026-09-12 22:49: the copy toolbar appeared and the
// list kept moving under it, because the agent was still streaming and each
// streamed frame is new data. A finger on the screen holds the list still.
describe('while a finger is down', () => {
  it('follows nothing, and lets a tap\'s pending change through on release', () => {
    const gate = createChatFollowGate()
    gate.noteData(['m1'])
    expect(gate.shouldFollow(true, true)).toBe(false)
    expect(gate.shouldFollow(true, true)).toBe(false)
    expect(gate.shouldFollow(true, false)).toBe(true)
  })
})
