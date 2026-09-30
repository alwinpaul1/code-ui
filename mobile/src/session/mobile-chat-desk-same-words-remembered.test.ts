// Two messages of the same words typed at the desk mid-turn ("keep going",
// twice) on a tab without the prompt hook. Claude writes no row for a message
// it takes mid-turn, so the chat's copies from the queue box are all there is,
// and the chat remembers them with the phone's own sends so they survive a
// tab switch, a reconnect and a relaunch. Both were remembered under one id,
// the hash of the words, and the store keeps one item per id: only the first
// was kept, and the chat drew one bubble (review, 2026-09-30). The queue box's
// witness also kept the first sighting of the words for good, so a later
// message of them the agent took while the chat was closed was remembered at
// the first one's row, under the first one's id, and lost.
// The turn is the one of the report of 2026-09-29
// (mobile-chat-midturn-prompt-after-reply.test.ts).

import { describe, expect, it, vi } from 'vitest'
import {
  at,
  EARLIER,
  WRITTEN_BEFORE_SECOND,
  BEFORE_FIRST,
  AFTER_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  text,
  user,
  working,
  done,
  statusReader,
  drawn,
  midturnChat
} from './mobile-chat-midturn-prompt.test-support'

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View'
}))
const frames = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) => {
      frames.push(props)
      return h('ChatView', props)
    }
  }
})

const WORDS = 'keep going'
/** Where each is drawn: after the words written before the box first listed
 *  it (the call that was last then folds into them). */
const FIRST_AT = BEFORE_FIRST[0]!.id
const SECOND_AT = WRITTEN_BEFORE_SECOND
/** The second taken mid-turn: a result lands, then the words after it. */
const SECOND_TAKEN = WHOLE_TURN.slice(0, BEFORE_SECOND.length + 2)
/** An earlier turn typed with the agent idle, of the same words, and its
 *  reply: the chat then stores nothing from the box while a message of those
 *  words waits (use-queued-desk-witnesses.ts landedRowOf), so each echo is
 *  its message's only copy. */
const PAST = [user('5a1c2e3d-4b5f-4a6e-8c7d-9e0f1a2b3c4d', WORDS, '05:20:00.000'), text('6b2d3f4e-5c6a-4b7f-9d8e-0f1a2b3c4d5e', '05:20:30.000')]

describe('two desk messages of the same words, each taken mid-turn', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, drafts, showAt, queueBox } = midturnChat(frames, () => agent)
  /** The user bubbles of these words, top to bottom, by the row above each. */
  const bubbles = () => {
    const rows = drawn(frames.at(-1)!)
    return rows.flatMap((row, index) => (row.role === 'user' && row.text === WORDS ? [rows[index - 1]?.id ?? null] : []))
  }
  const remembered = () => (drafts()?.pending ?? []).filter((item) => item.text === WORDS)

  for (const kind of ['claude', 'codex'] as const) {
    const on = kind === 'claude' ? 'Claude Code' : 'Codex'

    it(`draws both, and both again after the chat comes back, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:34:50.000'))
      const prompts = reader.read(working(EARLIER, '05:34:45.850'))
      await showAt('05:34:55.900', BEFORE_FIRST, prompts, true, [WORDS])
      await showAt('05:36:03.000', AFTER_FIRST, prompts, true, [])
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS])
      expect(queueBox()).toEqual([WORDS])
      await showAt('05:37:40.000', SECOND_TAKEN, prompts, true, [])
      await showAt('05:37:41.000', SECOND_TAKEN, prompts, true, [])
      expect(bubbles()).toEqual([FIRST_AT, SECOND_AT])
      expect(remembered()).toHaveLength(2)
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      const later = again.read(done(EARLIER))
      await showAt('05:48:00.100', WHOLE_TURN, later, false, [])
      await showAt('05:48:01.000', WHOLE_TURN, later, false, [])
      expect(bubbles()).toEqual([FIRST_AT, SECOND_AT])
      again.unmount()
      unmount()
    })

    // The first's remembered copy was taken for a copy of the second: every
    // echo of its words was retired by it, so the second was drawn nowhere
    // and never remembered (found with this review's fix, 2026-09-30).
    it(`draws both when their words are an earlier turn's, and both again after the chat comes back, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:34:50.000'))
      const prompts = reader.read(working(EARLIER, '05:34:45.850'))
      await showAt('05:34:55.900', [...PAST, ...BEFORE_FIRST], prompts, true, [WORDS])
      await showAt('05:36:03.000', [...PAST, ...AFTER_FIRST], prompts, true, [])
      await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS])
      await showAt('05:37:40.000', [...PAST, ...SECOND_TAKEN], prompts, true, [])
      await showAt('05:37:41.000', [...PAST, ...SECOND_TAKEN], prompts, true, [])
      expect(bubbles()).toEqual([null, FIRST_AT, SECOND_AT])
      expect(remembered()).toHaveLength(2)
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      const later = again.read(done(EARLIER))
      await showAt('05:48:00.100', [...PAST, ...WHOLE_TURN], later, false, [])
      await showAt('05:48:01.000', [...PAST, ...WHOLE_TURN], later, false, [])
      expect(bubbles()).toEqual([null, FIRST_AT, SECOND_AT])
      again.unmount()
      unmount()
    })

    it(`draws the second where the box first listed it when the agent took it while the chat was closed, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:34:50.000'))
      const prompts = reader.read(working(EARLIER, '05:34:45.850'))
      await showAt('05:34:55.900', BEFORE_FIRST, prompts, true, [WORDS])
      await showAt('05:36:03.000', AFTER_FIRST, prompts, true, [])
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS])
      await showAt('05:36:40.000', BEFORE_SECOND, prompts, true, [WORDS])
      reader.unmount()
      unmount()
      // Taken while the chat was closed; back after the turn.
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      const later = again.read(done(EARLIER))
      await showAt('05:48:00.100', WHOLE_TURN, later, false, [])
      await showAt('05:48:01.000', WHOLE_TURN, later, false, [])
      expect(bubbles()).toEqual([FIRST_AT, SECOND_AT])
      again.unmount()
      unmount()
    })

    // One message the box listed and the agent took: its echo and the box's
    // own witness of it are one message, remembered once.
    it(`remembers one message the box listed and the agent took once, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:30.000'))
      const prompts = reader.read(working(EARLIER, '05:34:45.850'))
      await showAt('05:36:30.100', AFTER_FIRST, prompts, true, [])
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS])
      await showAt('05:37:40.000', SECOND_TAKEN, prompts, true, [])
      await showAt('05:37:41.000', SECOND_TAKEN, prompts, true, [])
      expect(bubbles()).toEqual([SECOND_AT])
      expect(remembered()).toHaveLength(1)
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      const later = again.read(done(EARLIER))
      await showAt('05:48:00.100', WHOLE_TURN, later, false, [])
      expect(bubbles()).toEqual([SECOND_AT])
      again.unmount()
      unmount()
    })

    // A message still in the box when the chat comes back is the one it
    // remembered before, not a new one: the chat's first read after the
    // remount lists it at a later row.
    it(`keeps one message still queued across a remount one message, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:30.000'))
      const prompts = reader.read(working(EARLIER, '05:34:45.850'))
      await showAt('05:36:30.100', AFTER_FIRST, prompts, true, [])
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS])
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:37:35.000'))
      const later = again.read(working(EARLIER, '05:34:45.850'))
      const rowLanded = WHOLE_TURN.slice(0, BEFORE_SECOND.length + 1)
      await showAt('05:37:35.100', rowLanded, later, true, [WORDS])
      await showAt('05:37:36.000', rowLanded, later, true, [WORDS])
      expect(queueBox()).toEqual([WORDS])
      expect(bubbles()).toEqual([])
      await showAt('05:37:40.000', SECOND_TAKEN, later, true, [])
      await showAt('05:37:41.000', SECOND_TAKEN, later, true, [])
      expect(bubbles()).toEqual([SECOND_AT])
      expect(remembered()).toHaveLength(1)
      again.unmount()
      unmount()
    })
  }

  // The limit, pinned: the first's remembered copy is held in the queue box
  // by any row of its words (useQueuedOwnSends projectWaitingFirst), so while
  // the second waits the first is not drawn. It is again once the second is
  // taken. The hook's own echo keeps it drawn only until the remembered copy
  // retires it (absorbed-queue-echo-same-words-twice.test.ts pins the hook).
  it('does not draw the first while the second of the same words waits (a limit)', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:34:50.000'))
    const prompts = reader.read(working(EARLIER, '05:34:45.850'))
    await showAt('05:34:55.900', BEFORE_FIRST, prompts, true, [WORDS])
    await showAt('05:36:03.000', AFTER_FIRST, prompts, true, [])
    expect(bubbles()).toEqual([FIRST_AT])
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS])
    expect(bubbles()).toEqual([])
    await showAt('05:37:40.000', SECOND_TAKEN, prompts, true, [])
    await showAt('05:37:41.000', SECOND_TAKEN, prompts, true, [])
    expect(bubbles()).toEqual([FIRST_AT, SECOND_AT])
    reader.unmount()
    unmount()
  })

  // The limit, pinned: two copies already in the box when the chat first
  // reads it are each remembered by their words alone (either may be one it
  // remembered before a remount), so the store keeps one of them.
  it('keeps one of two copies of the same words the box already listed at the chat’s first read (a limit)', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:36:30.000'))
    const prompts = reader.read(working(EARLIER, '05:34:45.850'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS, WORDS])
    await showAt('05:37:40.000', SECOND_TAKEN, prompts, true, [])
    await showAt('05:37:41.000', SECOND_TAKEN, prompts, true, [])
    expect(remembered()).toHaveLength(1)
    reader.unmount()
    unmount()
  })
})
