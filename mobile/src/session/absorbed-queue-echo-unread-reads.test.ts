import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'

// A message still queued at the desk, and one screen read that could not see
// the agent's queue box: the link was down (the controller hands the chat an
// empty box then), an entry was selected at the desk (the reader lists nothing
// while the rows are ambiguous), or a dialog covered the composer. The hook
// took the empty box for the message leaving it and held an echo; when the box
// listed it again after a streaming row had landed, the echo stayed, so the
// message was drawn as a bubble beside its own queue entry, and once the agent
// took it a second echo was held (review of the per-entry echo rewrite,
// 2026-09-30; the base hook retired an echo whenever the box listed its words,
// which round 2 withdrew for the same words queued twice). An unreadable read
// is unknown, not empty: it changes nothing.

function row(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: 'working' }], timestamp: 0, source: 'transcript' }
}

let latest: ReturnType<typeof useAbsorbedQueueEchoes> = []

function Probe({ queued, raw, readable, scope }: { queued: string[]; raw: NativeChatMessage[]; readable: boolean; scope: string }): null {
  latest = useAbsorbedQueueEchoes(queued, [], raw, scope, raw, [], readable)
  return null
}

const A = 'please keep going and run the tests'
const a1 = row('a1')
const a2 = row('a2')
const a3 = row('a3')

describe('a queue box read that could not see the box', () => {
  let renderer: ReactTestRenderer | null = null
  const show = (queued: string[], raw: NativeChatMessage[], readable = true, scope = 'tab-a'): void => {
    const element = createElement(Probe, { queued, raw, readable, scope })
    act(() => {
      if (renderer === null) {
        renderer = create(element)
      } else {
        renderer.update(element)
      }
    })
  }
  /** An unreadable read hands the hook what the controller hands it: nothing. */
  const unread = (raw: NativeChatMessage[], scope?: string): void => show([], raw, false, scope)
  const anchors = (): (string | null)[] => latest.map((echo) => echo.baselineTailMessageId)
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = []
  })

  // The reviewer's probe, with the middle read one that could not see the box.
  it('draws no echo while the box lists the message again after a row landed, and one once the agent takes it', () => {
    show([A], [a1])
    unread([a1])
    expect(anchors()).toEqual([])
    show([A], [a1, a2])
    expect(anchors()).toEqual([])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a1'])
    expect(latest.map((echo) => echo.text)).toEqual([A])
  })

  it('draws a message the agent took while the box could not be seen at the next read that sees it, where it arrived', () => {
    show([A], [a1])
    unread([a1, a2])
    unread([a1, a2, a3])
    expect(anchors()).toEqual([])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a1'])
  })

  // The failure path is untouched: a readable empty box is the agent taking it.
  it('still holds an echo when a read that sees the box finds it let go', () => {
    show([A], [a1])
    show([], [a1, a2])
    expect(anchors()).toEqual(['a1'])
    // …and a read that cannot see the box afterwards changes nothing.
    unread([a1, a2])
    expect(anchors()).toEqual(['a1'])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a1'])
  })

  // Degenerate: the scope's first read is one that cannot see the box.
  it('treats a message first seen after an unreadable first read as arriving then', () => {
    unread([a1])
    expect(anchors()).toEqual([])
    show([A], [a1, a2])
    unread([a1, a2, a3])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a2'])
  })

  // Degenerate: an empty box, then a read that cannot see it.
  it('holds nothing across an unreadable read after an empty box', () => {
    show([], [a1])
    unread([a1, a2])
    expect(anchors()).toEqual([])
    show([A], [a1, a2])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a2'])
  })

  // Degenerate: nothing ever listed, only reads that cannot see the box.
  it('draws nothing from reads that never see the box', () => {
    unread([a1])
    unread([a1, a2])
    expect(latest).toEqual([])
  })

  // A new chat scope starts over whatever the last read of the old one was.
  it('starts a new scope over after an unreadable read of the old one', () => {
    show([A], [a1])
    unread([a1], 'tab-b')
    show([], [a1, a2], true, 'tab-b')
    expect(anchors()).toEqual([])
  })
})
