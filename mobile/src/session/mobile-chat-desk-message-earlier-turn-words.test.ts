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
  done,
  statusReader,
  drawn,
  beaconCopy,
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
const hooked = { promptHook: true }

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
  // With the prompt hook (`hk=1`): its copy names the row the message was
  // typed after, and the earlier turn is above that row.
  it('is drawn once where it was sent with the prompt hook’s copy of it', async () => {
    agent = 'claude'
    const hook = beaconCopy('81001', WORDS, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', [...PAST, ...BEFORE_FIRST], prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [hook] })
    await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS], hooked)
    expect(queueBox()).toEqual([WORDS])
    await showAt('05:37:40.000', TAKEN, prompts, true, [], hooked)
    await showAt('05:37:41.000', TAKEN, prompts, true, [], hooked)
    expect(bubbles()).toEqual([null, WRITTEN_BEFORE_SECOND])
    vi.setSystemTime(at('05:46:51.100'))
    prompts = reader.read(done(WORDS), { beacon: [hook] })
    await showAt('05:46:51.200', [...PAST, ...WHOLE_TURN], prompts, false, [], hooked)
    expect(bubbles()).toEqual([null, WRITTEN_BEFORE_SECOND])
    reader.unmount()
    unmount()
  })

  // The failure path: the row Claude dequeues it as, after the row the hook
  // names, lands the hook copy, and is the one bubble of it.
  it('is drawn once, as its own row, when the prompt hook’s copy of it is dequeued at the turn’s end', async () => {
    agent = 'claude'
    const hook = beaconCopy('81002', WORDS, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', [...PAST, ...BEFORE_FIRST], prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [hook] })
    await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS], hooked)
    await showAt('05:46:50.900', [...PAST, ...WHOLE_TURN], prompts, true, [WORDS], hooked)
    await showAt('05:46:54.800', [...PAST, ...WHOLE_TURN, DEQUEUED], prompts, true, [], hooked)
    await showAt('05:46:55.800', [...PAST, ...WHOLE_TURN, DEQUEUED], prompts, true, [], hooked)
    expect(bubbles()).toEqual([null, LAST_REPLY])
    reader.unmount()
    unmount()
  })

  // The limit, pinned. With only the tab status’s copy of it (a Claude Code
  // tab launched without the prompt hook, a hand-started one, a Codex tab)
  // the message is still drawn nowhere. The status copy names no row, so the
  // earlier turn’s row still lands it (desk-prompt-landed.ts). Its time is
  // the status’s stamp, and a stamp from an update that also carried a later
  // tool ping would be later than the copy’s own idle row, which would then
  // draw twice. And the queue box’s echo is retired because a desk copy of
  // its words exists: ownPrompts in MobileNativeChatOverlay.tsx holds every
  // desk copy, landed or not. Either side changing flips this test.
  for (const kind of ['claude', 'codex'] as const) {
    it(`is still drawn nowhere with only the status’s copy of it, on ${kind === 'claude' ? 'Claude Code' : 'Codex'} (a limit)`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', [...PAST, ...BEFORE_FIRST], prompts, true, [])
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'))
      await showAt('05:36:35.100', [...PAST, ...BEFORE_SECOND], prompts, true, [WORDS])
      expect(queueBox()).toEqual([WORDS])
      await showAt('05:37:40.000', TAKEN, prompts, true, [])
      await showAt('05:37:41.000', TAKEN, prompts, true, [])
      expect(bubbles()).toEqual([null])
      reader.unmount()
      unmount()
    })
  }
})
