import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countUserTextOccurrences,
  normalizeReconcileText
} from './mobile-native-chat-draft-reconcile'
import {
  appendMobileNativeChatPending,
  isTakenSend,
  takeMobileNativeChatPending,
  type MobileNativeChatPendingMessage
} from './mobile-native-chat-pending-echo'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'

// A phone send Claude takes out of its queue box mid-turn gets no row
// (Claude Code 2.1.282, session da53d612: queue-operation remove, reason
// absorbed_mid_turn, then only a queued_command attachment). One still queued
// when the turn ends gets a `user` row with promptSource "queued".

const KEY = 'host\0worktree\0tab\0session'
const NONE: ReadonlySet<string> = new Set()
const TAKEN_AT = Date.parse('2026-09-25T17:04:47.000Z')

function row(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: 1, source: 'transcript' }
}

/** Append a send against `messages`, as acceptSend does. */
function send(
  state: Record<string, MobileNativeChatPendingMessage[]>,
  id: string,
  text: string,
  messages: readonly NativeChatMessage[]
): Record<string, MobileNativeChatPendingMessage[]> {
  const normalizedText = normalizeReconcileText(text)
  return appendMobileNativeChatPending(
    state,
    KEY,
    id,
    {
      draftKey: 'host\0worktree\0tab',
      draftEditGeneration: 0,
      pendingKey: KEY,
      normalizedText,
      baselineOccurrences: countUserTextOccurrences(messages, normalizedText),
      baselineTailMessageId: messages.at(-1)?.id ?? null,
      baselineResolved: true
    },
    text
  )
}

const ids = (list: readonly MobileNativeChatPendingMessage[]) => list.map((item) => item.id)

describe('a send the agent took out of its queue box', () => {
  const history = [row('m1', 'assistant', 'Pushed. Waiting for the deploy…')]

  it('is no longer counted as waiting, so a later send of its text gets the ordinal its own row satisfies', () => {
    const taken = takeMobileNativeChatPending(send({}, 'pending-1', 'yes', history), KEY, ['pending-1'], TAKEN_AT)
    const both = send(taken, 'pending-2', 'yes', history)
    expect(both[KEY]!.map((item) => item.expectedOccurrence)).toEqual([1, 1])
    const landed = [...history, row('u1', 'user', 'yes')]
    expect(ids(retireLandedMobileNativeChatPending(landed, both[KEY]!, NONE))).toEqual(['pending-1'])
  })

  it('brings down the ordinal of a later copy sent while it still waited in the box', () => {
    const queued = send(send({}, 'pending-1', 'yes', history), 'pending-2', 'yes', history)
    expect(queued[KEY]!.map((item) => item.expectedOccurrence)).toEqual([1, 2])
    const taken = takeMobileNativeChatPending(queued, KEY, ['pending-1'], TAKEN_AT)
    expect(taken[KEY]!.map((item) => item.expectedOccurrence)).toEqual([1, 1])
    // The second is dequeued as a queued user row when the turn ends.
    const landed = [...history, row('u1', 'user', 'yes')]
    expect(ids(retireLandedMobileNativeChatPending(landed, taken[KEY]!, NONE))).toEqual(['pending-1'])
  })

  it('still leaves on its own row, if Claude wrote it as a queued user row after all', () => {
    const taken = takeMobileNativeChatPending(send({}, 'pending-1', 'yes', history), KEY, ['pending-1'], TAKEN_AT)
    const landed = [...history, row('u1', 'user', 'yes')]
    expect(retireLandedMobileNativeChatPending(landed, taken[KEY]!, NONE)).toEqual([])
  })

  it('stays, sealed, once a later copy claimed a row of its text, on that pass and every pass after', () => {
    const taken = takeMobileNativeChatPending(send({}, 'pending-1', 'yes', history), KEY, ['pending-1'], TAKEN_AT)
    const both = send(taken, 'pending-2', 'yes', history)
    const landed = [...history, row('u1', 'user', 'yes')]
    const first = retireLandedMobileNativeChatPending(landed, both[KEY]!, NONE)
    expect(first).toEqual([expect.objectContaining({ id: 'pending-1', takenSealed: true })])
    // The next frame: the copy that owned the row is gone, the row is not.
    expect(retireLandedMobileNativeChatPending(landed, first, NONE)).toBe(first)
  })

  it('leaves the list as it was when nothing is left to do', () => {
    const state = send({}, 'pending-1', 'yes', history)
    expect(takeMobileNativeChatPending(state, KEY, [], TAKEN_AT)).toBe(state)
    expect(takeMobileNativeChatPending(state, 'another', ['pending-1'], TAKEN_AT)).toBe(state)
    expect(takeMobileNativeChatPending({}, KEY, ['pending-1'], TAKEN_AT)).toEqual({})
    const taken = takeMobileNativeChatPending(state, KEY, ['pending-1'], TAKEN_AT)
    expect(takeMobileNativeChatPending(taken, KEY, ['pending-1'], TAKEN_AT + 1)).toBe(taken)
    expect(retireLandedMobileNativeChatPending(history, taken[KEY]!, NONE)).toBe(taken[KEY])
  })

  it('takes only the phone own text sends, never a witnessed message or a caption-less photo', () => {
    const witness: MobileNativeChatPendingMessage = {
      id: 'desk-status:s:1:0',
      text: 'typed at the desk',
      expectedOccurrence: 1,
      baselineTailMessageId: 'm1',
      baselineResolved: true
    }
    const photo: MobileNativeChatPendingMessage = { ...witness, id: 'pending-2', text: '', images: ['file:///a.png'] }
    const state = { [KEY]: [witness, photo] }
    expect(takeMobileNativeChatPending(state, KEY, [witness.id, photo.id], TAKEN_AT)).toBe(state)
  })

  // The pending store does not check the fields it reads back.
  it('treats a stored time that is not a number as not taken', () => {
    expect(isTakenSend({ takenAt: Number.NaN })).toBe(false)
    expect(isTakenSend({ takenAt: '17:04' as unknown as number })).toBe(false)
    expect(isTakenSend({})).toBe(false)
    expect(isTakenSend({ takenAt: TAKEN_AT })).toBe(true)
  })
})
