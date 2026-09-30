// A short desk message queued mid-turn with the words of an earlier turn,
// through the chat (review of 2026-09-30, F13). The queue-box witness
// remembers a message the agent's box lists, so one the agent takes while the
// chat is closed is still drawn where it arrived when the chat comes back
// (mobile-chat-midturn-queue-box.test.ts). A "keep going" was never
// remembered: the earlier turn's "keep going" row was taken for its own
// landed row, wherever it sat. Claude Code writes no transcript row for a
// message it takes mid-turn, so once the chat closed the message was gone.
// The records and times are the report's of 2026-09-29
// (mobile-chat-midturn-prompt.test-support.ts); the box is each agent's, read
// by the phone's own reader (queue-box-screens.test-support.ts).

import { describe, expect, it, vi } from 'vitest'
import {
  at,
  BEFORE_FIRST,
  AFTER_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  WRITTEN_BEFORE_SECOND,
  WRITTEN_AFTER_SECOND,
  drawn,
  user,
  midturnChat
} from './mobile-chat-midturn-prompt.test-support'
import { claudeQueueBox, codexQueueBox } from './queue-box-screens.test-support'

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
/** The earlier turn's prompt of the same words, as its own user row. */
const EARLIER_TURN = user('5b0e7c1d-2a3f-4e8b-9c6d-7f1a2b3c4d5e', WORDS, '05:20:00.000')

describe('a mid-turn desk message with the words of an earlier turn', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, queueBox, where } = midturnChat(frames, () => agent)

  for (const [kind, box] of [
    ['claude', claudeQueueBox],
    ['codex', codexQueueBox]
  ] as const) {
    it(`draws a "keep going" the queue box held when the chat closed where it arrived once it is taken, though an earlier turn said the same, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      vi.setSystemTime(at('05:35:00.000'))
      // No status copy of it: the witness is the only one.
      await showAt('05:35:00.100', [EARLIER_TURN, ...BEFORE_FIRST], [], true, box([]))
      await showAt('05:36:03.000', [EARLIER_TURN, ...AFTER_FIRST], [], true, box([]))
      // Sent at 05:36:34 and queued behind a long call.
      await showAt('05:36:35.100', [EARLIER_TURN, ...BEFORE_SECOND], [], true, box([WORDS]))
      await showAt('05:36:40.000', [EARLIER_TURN, ...BEFORE_SECOND], [], true, box([WORDS]))
      expect(queueBox()).toEqual([WORDS])
      expect(where(WORDS).at).toHaveLength(1)
      unmount()
      // Taken at 05:37:31 while the chat was closed; back after the turn.
      await showAt('05:48:00.100', [EARLIER_TURN, ...WHOLE_TURN], [], false, box([]))
      await showAt('05:48:01.000', [EARLIER_TURN, ...WHOLE_TURN], [], false, box([]))
      const rows = drawn(frames.at(-1)!)
      const kept = where(WORDS)
      // The earlier turn's row, and this one: one is the bug, three a double draw.
      expect(kept.at).toHaveLength(2)
      expect(kept.after(kept.at[1]!)).toBe(WRITTEN_BEFORE_SECOND)
      expect(kept.at[1]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
      unmount()
    })
  }
})
