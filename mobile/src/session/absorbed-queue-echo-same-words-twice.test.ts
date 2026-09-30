import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'

// On a tab without Orca's prompt hook, a message the desk queued mid-turn
// reaches the phone only as the queue box's witness: Claude writes no
// transcript row for a message it takes mid-turn, so the held echo is the only
// copy of it. Two messages of the same words are two messages the person
// sent. The echo was keyed by its words, so the second hold made no second
// echo, and a copy of the same words listed again retired the first, which
// was already taken: the first bubble vanished while the second waited, and
// only one was drawn once both were taken (batch b5, 2026-09-30).

function row(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: 'working' }], timestamp: 0, source: 'transcript' }
}

let latest: ReturnType<typeof useAbsorbedQueueEchoes> = []

function Probe({ queued, raw }: { queued: string[]; raw: NativeChatMessage[] }): null {
  latest = useAbsorbedQueueEchoes(queued, [], raw, 'tab-a', raw, [])
  return null
}

const WORDS = 'keep going with the task'
const a1 = row('a1')
const a2 = row('a2')
const a3 = row('a3')
const a4 = row('a4')

describe('the same words queued twice at the desk', () => {
  let renderer: ReactTestRenderer | null = null
  const show = (queued: string[], raw: NativeChatMessage[]): void => {
    act(() => {
      if (renderer === null) {
        renderer = create(createElement(Probe, { queued, raw }))
      } else {
        renderer.update(createElement(Probe, { queued, raw }))
      }
    })
  }
  const anchors = (): (string | null)[] => latest.map((echo) => echo.baselineTailMessageId)
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = []
  })

  // The row written between the two sightings is what says the second is a
  // new message. A box that lists nothing for a moment while rows land, then
  // lists the same message again, is this same sequence of reads, and draws
  // that message twice: the hook cannot tell the two apart.
  it('keeps the first bubble while the second copy waits, and draws both once both are taken', () => {
    show([WORDS], [a1])
    show([], [a1])
    expect(anchors()).toEqual(['a1'])
    show([WORDS], [a1, a2])
    expect(anchors()).toEqual(['a1'])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a1', 'a2'])
    expect(latest.map((echo) => echo.text)).toEqual([WORDS, WORDS])
  })

  it('draws both copies when the box listed them together and the agent took them together', () => {
    show([WORDS], [a1])
    show([WORDS, WORDS], [a1, a2])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a1', 'a2'])
  })

  it('draws both copies when the box listed them together and the agent took one, then the other', () => {
    show([WORDS], [a1])
    show([WORDS, WORDS], [a1, a2])
    show([WORDS], [a1, a2, a3])
    expect(anchors()).toEqual(['a1'])
    show([], [a1, a2, a3, a4])
    expect(anchors()).toEqual(['a1', 'a2'])
  })

  it('still draws a message queued once and taken once as one bubble', () => {
    show([WORDS], [a1])
    show([], [a1])
    show([], [a1, a2])
    expect(anchors()).toEqual(['a1'])
  })

  // The failure path: a box read that lists nothing for a moment (a relay
  // drop, a dialog over the box) while the message is still queued. Relisted
  // with no row between, it is the same message, and it is drawn once, in the
  // box while it waits and then where it arrived.
  it('draws one bubble for a message the box let go of and listed again with no row between', () => {
    show([WORDS], [a1])
    show([], [a1])
    show([WORDS], [a1])
    expect(anchors()).toEqual([])
    show([WORDS], [a1, a2])
    show([], [a1, a2, a3])
    expect(anchors()).toEqual(['a1'])
  })

  it('draws nothing for an empty box, and nothing for a box that never lets its entry go', () => {
    show([], [a1])
    expect(latest).toEqual([])
    show([WORDS], [a1, a2])
    show([WORDS], [a1, a2, a3])
    expect(latest).toEqual([])
  })
})

// The chat draws a message it remembered from the box from the store, and a
// held echo of it steps aside for that copy (ownPrompts). The copy was taken
// for one of every echo of its words: "keep going" sent twice mid-turn, the
// first's copy retired the second's echo the moment it was held, and the
// second was drawn nowhere and never remembered (2026-09-30). A remembered
// copy is the copy of the echo at its own row only.
describe('the same words queued twice, with the first drawn from what the chat remembered', () => {
  let renderer: ReactTestRenderer | null = null
  let echoes: ReturnType<typeof useAbsorbedQueueEchoes> = []
  function OwnProbe({ queued, raw, own }: { queued: string[]; raw: NativeChatMessage[]; own: (string | { text: string; anchorId: string | null })[] }): null {
    echoes = useAbsorbedQueueEchoes(queued, [], raw, 'tab-b', raw, own)
    return null
  }
  const show = (queued: string[], raw: NativeChatMessage[], own: (string | { text: string; anchorId: string | null })[] = []): void => {
    act(() => {
      const element = createElement(OwnProbe, { queued, raw, own })
      if (renderer === null) {
        renderer = create(element)
      } else {
        renderer.update(element)
      }
    })
  }
  const anchors = (): (string | null)[] => echoes.map((echo) => echo.baselineTailMessageId)
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    echoes = []
  })
  const first = { text: WORDS, anchorId: 'a1' }

  it('keeps the second echo beside the first one’s remembered copy', () => {
    show([], [a1])
    show([WORDS], [a1])
    show([], [a1, a2], [first])
    expect(anchors()).toEqual([])
    show([WORDS], [a1, a2, a3], [first])
    show([], [a1, a2, a3, a4], [first])
    expect(anchors()).toEqual(['a3'])
  })

  it('still steps aside for a copy at its own row, and for a phone send or desk prompt of its words', () => {
    show([], [a1])
    show([WORDS], [a1])
    show([], [a1, a2], [first])
    expect(anchors()).toEqual([])
    show([WORDS], [a1, a2, a3])
    show([], [a1, a2, a3, a4], [WORDS])
    expect(anchors()).toEqual([])
  })

  // A message still queued across a remount is listed at the chat's first
  // read at a later row: the copy remembered before is its copy.
  it('steps aside for a copy at another row when the box already listed it at the first read', () => {
    show([WORDS], [a2])
    show([], [a2, a3], [first])
    expect(anchors()).toEqual([])
  })
})

