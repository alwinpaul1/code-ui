// A message typed at the desk while a turn runs, with the same words as an
// earlier turn ("keep going with the task"), taken by Claude mid-turn. Claude
// Code writes no row for a message it takes mid-turn, so the chat's copies of
// it (the prompt hook's, the tab status's, the queue box's) are all there is,
// and each was dropped because an earlier turn's row had its words (review of
// the chat-echo batch, 2026-09-30). The turn is the one of the report of
// 2026-09-29 (mobile-chat-midturn-prompt-after-reply.test.ts), with an
// earlier turn of the same words above it.

import { describe, expect, it, vi } from 'vitest'
import {
  at,
  EARLIER,
  WRITTEN_BEFORE_SECOND,
  BEFORE_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  LAST_REPLY,
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
/** Still queued as the turn ends, Claude dequeues it as the next turn's row. */
const DEQUEUED = user('7e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b', WORDS, '05:46:54.300')
const TAKEN = [...PAST, ...WHOLE_TURN.slice(0, -5)]

describe('a mid-turn desk message with the words of an earlier turn', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, queueBox } = midturnChat(frames, () => agent)
  /** The user bubbles of these words, top to bottom, by the row above each. */
  const bubbles = () => {
    const rows = drawn(frames.at(-1)!)
    return rows.flatMap((row, index) => (row.role === 'user' && row.text === WORDS ? [rows[index - 1]?.id ?? null] : []))
  }

  // The queue box's witness alone: no hook copy and no status copy of it
  // reached the phone (the status carried the earlier prompt throughout).
  for (const kind of ['claude', 'codex'] as const) {
    const on = kind === 'claude' ? 'Claude Code' : 'Codex'
    it(`is drawn once where the queue box first listed it when the box is its only copy, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      const prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', [...PAST, ...BEFORE_FIRST], prompts, true, [])
      await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS])
      expect(queueBox()).toEqual([WORDS])
      // Taken mid-turn at 05:37:31: the box lets it go, and no row is written.
      await showAt('05:37:40.000', TAKEN, prompts, true, [])
      await showAt('05:37:41.000', TAKEN, prompts, true, [])
      // After the words written before it: the call that was last when the
      // box first listed it folds into them.
      expect(bubbles()).toEqual([null, WRITTEN_BEFORE_SECOND])
      await showAt('05:46:51.200', [...PAST, ...WHOLE_TURN], prompts, false, [])
      expect(bubbles()).toEqual([null, WRITTEN_BEFORE_SECOND])
      reader.unmount()
      unmount()
    })

    // The failure path: still queued as the turn ends, it gets a row, and
    // that row is the one bubble of it.
    it(`is drawn once, as its own row, when the box's only copy is dequeued at the turn's end, on ${on}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      const prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', [...PAST, ...BEFORE_FIRST], prompts, true, [])
      await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS])
      await showAt('05:46:50.900', [...PAST, ...WHOLE_TURN], prompts, true, [WORDS])
      await showAt('05:46:54.800', [...PAST, ...WHOLE_TURN, DEQUEUED], prompts, true, [])
      await showAt('05:46:55.800', [...PAST, ...WHOLE_TURN, DEQUEUED], prompts, true, [])
      expect(bubbles()).toEqual([null, LAST_REPLY])
      reader.unmount()
      unmount()
    })
  }
})
