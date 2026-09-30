import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'
import { echoMemoryId, rememberEchoInPending, sweepWitnessedEchoes } from './mobile-native-chat-remember-echo'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

// A desk message that goes on from an earlier one at a word boundary, queued
// after the agent took the earlier one: "check the build", then "check the
// build again". Both were queued mid-turn on a tab without Orca's prompt
// hook, so the queue box is their only witness. The longer one was taken for
// the earlier one with the screen's rows glued on, a rule written for the
// scrollback reader, and was never drawn, nor kept in the store: the hold
// found the earlier echo and made none, and the sweep and the store dropped
// the second of two `absorbed-` readings. The queue reader stops at the
// transcript's tool rows now (queueBlockRows), so on this path the rule only
// cost a message (2026-09-30).

const FIRST = 'check the build'
const SECOND = 'check the build again'

function row(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: 'working' }], timestamp: 0, source: 'transcript' }
}

let latest: ReturnType<typeof useAbsorbedQueueEchoes> = []

function Probe({ queued, raw }: { queued: string[]; raw: NativeChatMessage[] }): null {
  latest = useAbsorbedQueueEchoes(queued, [], raw, 'tab-a', raw, [])
  return null
}

describe('a desk message that goes on from an earlier one, drawn off the queue box', () => {
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
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = []
  })
  const a1 = row('a1')
  const a2 = row('a2')

  it('draws both messages when the longer one was queued after the agent took the first', () => {
    show([FIRST], [a1])
    show([], [a1])
    show([SECOND], [a1, a2])
    show([], [a1, a2])
    expect(latest.map((echo) => echo.text)).toEqual([FIRST, SECOND])
    expect(latest.map((echo) => echo.baselineTailMessageId)).toEqual(['a1', 'a2'])
  })

  // A fuller reading of one message is not a second message: read longer by
  // the next read with no row between, it is the entry the box already listed.
  it('draws one message when the box reads the same entry longer on the next read', () => {
    show([FIRST], [a1])
    show([SECOND], [a1])
    show([], [a1])
    expect(latest).toHaveLength(1)
  })

  it('draws one message when the box lets an entry go and lists it longer with no row between', () => {
    show([FIRST], [a1])
    show([], [a1])
    show([SECOND], [a1])
    show([], [a1])
    expect(latest).toHaveLength(1)
    expect(latest[0]!.baselineTailMessageId).toBe('a1')
  })
})

function absorbed(text: string, anchor: string): MobileNativeChatPendingMessage {
  return { id: echoMemoryId(text), text, expectedOccurrence: 1, baselineTailMessageId: anchor, baselineResolved: true }
}

describe('a desk message that goes on from an earlier one, in the store', () => {
  it('stores the longer message when the box first listed it at a later row', () => {
    const first = rememberEchoInPending({}, 'k', echoMemoryId(FIRST), FIRST, 'a1', [], 'd')
    const both = rememberEchoInPending(first, 'k', echoMemoryId(SECOND), SECOND, 'a2', [], 'd')
    expect(both.k!.map((item) => [item.text, item.baselineTailMessageId])).toEqual([
      [FIRST, 'a1'],
      [SECOND, 'a2']
    ])
    const reversed = rememberEchoInPending(
      rememberEchoInPending({}, 'k', echoMemoryId(SECOND), SECOND, 'a2', [], 'd'),
      'k',
      echoMemoryId(FIRST),
      FIRST,
      'a1',
      [],
      'd'
    )
    expect(reversed.k!.map((item) => item.text)).toEqual([SECOND, FIRST])
  })

  it('restores both messages from a store that holds them at different rows', () => {
    expect(sweepWitnessedEchoes([absorbed(FIRST, 'a1'), absorbed(SECOND, 'a2')]).map((item) => item.text)).toEqual([
      FIRST,
      SECOND
    ])
  })

  // Anchored at one row, the longer reading may be the same message read with
  // the screen's rows glued on (mobile-native-chat-remember-echo.test.ts pins
  // the glued readings): still one message, the shorter kept.
  it('still keeps one of two readings anchored at the same row', () => {
    expect(sweepWitnessedEchoes([absorbed(FIRST, 'a1'), absorbed(SECOND, 'a1')]).map((item) => item.text)).toEqual([FIRST])
    const first = rememberEchoInPending({}, 'k', echoMemoryId(FIRST), FIRST, 'a1', [], 'd')
    expect(rememberEchoInPending(first, 'k', echoMemoryId(SECOND), SECOND, 'a1', [], 'd')).toBe(first)
  })

  it('restores an empty store as empty and one message as itself', () => {
    expect(sweepWitnessedEchoes([])).toEqual([])
    expect(sweepWitnessedEchoes([absorbed(SECOND, 'a2')]).map((item) => item.text)).toEqual([SECOND])
  })
})
