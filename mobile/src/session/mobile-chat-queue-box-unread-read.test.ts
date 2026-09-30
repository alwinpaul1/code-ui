// A message typed at the desk mid-turn, still queued, while one screen read in
// between could not see the agent's queue box: the link was down, an entry was
// selected at the desk (the reader refuses the rows then), or a dialog covered
// the composer. Each of those handed the chat an EMPTY box. The queue-box
// witness took the message for taken and held an echo of it, and when the box
// listed it again after a streaming row had landed, the echo stayed: the
// message was drawn as a bubble AND in the queue box, and once the agent took
// it a second echo was held, with no row ever written to retire either (review
// of the per-entry echo rewrite, 2026-09-30). An unreadable read is unknown,
// not empty (use-absorbed-queue-echoes.ts, mobile-terminal-queue-read.ts).
//
// The words are an earlier turn's ("keep going with the task"), so the chat
// stores no copy of the message from the box (use-queued-desk-witnesses.ts)
// and the queue box's echo is its only copy, as on the device. The turn is the
// one of the report of 2026-09-29 (mobile-chat-midturn-prompt-after-reply.test.ts).

import { describe, expect, it, vi } from 'vitest'
import {
  at,
  EARLIER,
  WRITTEN_BEFORE_SECOND,
  BEFORE_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  text,
  user,
  working,
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

const WORDS = 'keep going with the task'
/** The earlier turn: the same words typed with the agent idle, and its reply. */
const PAST = [user('5a1c2e3d-4b5f-4a6e-8c7d-9e0f1a2b3c4d', WORDS, '05:20:00.000'), text('6b2d3f4e-5c6a-4b7f-9d8e-0f1a2b3c4d5e', '05:20:30.000')]
/** A streaming row lands while the message still waits: the tool's result. */
const ROW_LANDED = [...PAST, ...WHOLE_TURN.slice(0, BEFORE_SECOND.length + 1)]
/** Taken mid-turn: Claude writes no row for it, only the words after. */
const TAKEN = [...PAST, ...WHOLE_TURN.slice(0, BEFORE_SECOND.length + 2)]
const unread = { queueReadable: false }

describe('a desk message still queued while one box read could not see the box', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, queueBox } = midturnChat(frames, () => agent)
  /** The user bubbles of these words, top to bottom, by the row above each:
   *  the earlier turn's row (null, the first row) and the queued message. */
  const bubbles = () => {
    const rows = drawn(frames.at(-1)!)
    return rows.flatMap((row, index) => (row.role === 'user' && row.text === WORDS ? [rows[index - 1]?.id ?? null] : []))
  }

  for (const kind of ['claude', 'codex'] as const) {
    const on = kind === 'claude' ? 'Claude Code' : 'Codex'
    it(`is drawn only in the box while it waits, and once where it arrived when taken, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      const prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', [...PAST, ...BEFORE_FIRST], prompts, true, [])
      await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS])
      expect(queueBox()).toEqual([WORDS])
      // The read that could not see the box.
      await showAt('05:36:50.000', [...PAST, ...BEFORE_SECOND], prompts, true, [], unread)
      // A row lands, and the box lists the message again.
      await showAt('05:37:32.000', ROW_LANDED, prompts, true, [WORDS])
      await showAt('05:37:33.000', ROW_LANDED, prompts, true, [WORDS])
      expect(queueBox()).toEqual([WORDS])
      expect(bubbles()).toEqual([null])
      // Taken: one bubble, after the words written before it was sent.
      await showAt('05:37:40.000', TAKEN, prompts, true, [])
      await showAt('05:37:41.000', TAKEN, prompts, true, [])
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual([null, WRITTEN_BEFORE_SECOND])
      await showAt('05:46:51.200', [...PAST, ...WHOLE_TURN], prompts, false, [])
      expect(bubbles()).toEqual([null, WRITTEN_BEFORE_SECOND])
      reader.unmount()
      unmount()
    })

    // The failure path the unread read hides: the agent takes the message
    // while the box cannot be seen. It is drawn once the box can be read
    // again, where it arrived.
    it(`draws a message taken while the box could not be seen once the box can be read again, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      const prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', [...PAST, ...BEFORE_FIRST], prompts, true, [])
      await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS])
      await showAt('05:37:40.000', TAKEN, prompts, true, [], unread)
      await showAt('05:37:45.000', TAKEN, prompts, true, [])
      await showAt('05:37:46.000', TAKEN, prompts, true, [])
      expect(bubbles()).toEqual([null, WRITTEN_BEFORE_SECOND])
      reader.unmount()
      unmount()
    })
  }
})
