// The cases the tab status alone cannot settle, and the prompt hook's own copy
// of each submission, which can (agent-hud-launch-args.ts; Claude Code tabs
// launched with the hook, `hk=1`). The status carries the pane's last prompt
// cut at 200 characters, and nothing when the pane's prompt did not change;
// the hook's copy carries the words as typed, up to 2,000 bytes, the text row
// they were typed after (`at=`), and a nonce of its own for every submission.
//
// Checked on Claude Code 2.1.284 (2026-09-29, a private tmux server with no
// Orca environment, a hook that logs each event): a prompt typed while a turn
// ran fired UserPromptSubmit at its enqueue, 21 ms after the Enter, and none
// when Claude dequeued it as its own turn after the first one ended. So a
// second copy of the same words is a second submission, never a dequeue.
//
// The report and its records are described in
// mobile-chat-midturn-prompt-after-reply.test.ts.

import { describe, expect, it, vi } from 'vitest'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import {
  at,
  SECOND_SEND,
  EARLIER,
  WRITTEN_BEFORE_SECOND,
  WRITTEN_AFTER_SECOND,
  BEFORE_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  LAST_REPLY,
  TURN_ENDED,
  BEFORE_TURN,
  standIn,
  text,
  user,
  working,
  done,
  statusReader,
  drawn,
  oneLine,
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

const hooked = { promptHook: true }
/** Over the status's 200 characters: the status carries its first 200. */
const BASE = `${SECOND_SEND} issue, and also please check whether the session list on the account page still shows the ended sessions after a refresh`
/** The row a bubble of these words is drawn after, for each such bubble. */
const drawnAfter = (words: string) => {
  const rows = drawn(frames.at(-1)!)
  return rows.flatMap((row, index) => (row.role === 'user' && row.text === oneLine(words) ? [rows[index - 1]?.id] : []))
}
/** The user bubbles that carry the long messages' opening words. */
const longBubbles = () =>
  drawn(frames.at(-1)!)
    .filter((row) => row.role === 'user' && row.text.startsWith(oneLine(SECOND_SEND).slice(0, 60)))
    .map((row) => row.text)

describe('a long desk message, with the prompt hook’s copy of it', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, queueBox } = midturnChat(frames, () => agent)

  // W1 of the review of fix/midturn-gaps: the chat closed in the second
  // between the message's echo and the first box read that listed it, and
  // came back more than 30 s later with the message still queued. The chat
  // remembered the status's cut copy from the echo and the box's whole
  // reading from the box, and could not tell them from two messages that
  // share their first 200 characters: drawn beside the box row while it
  // waited, then cut and whole once Claude took it.
  it('draws it once, whole, when the chat closed before the box listed it and came back while it waited', async () => {
    agent = 'claude'
    const long = `${BASE}, first on staging`
    const hook = beaconCopy('71001', long, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(long, '05:36:34.891'), { beacon: [hook] })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
    expect(longBubbles()).toHaveLength(1)
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:41:40.000'))
    prompts = again.read(working(long, '05:41:39.000'), { beacon: [hook] })
    await showAt('05:41:40.100', WHOLE_TURN.slice(0, -4), prompts, true, [long], hooked)
    await showAt('05:41:41.000', WHOLE_TURN.slice(0, -4), prompts, true, [long], hooked)
    expect(queueBox()).toEqual([oneLine(long)])
    expect(longBubbles()).toEqual([])
    // Taken mid-turn.
    await showAt('05:42:30.000', WHOLE_TURN.slice(0, -4), prompts, true, [], hooked)
    await showAt('05:42:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [], hooked)
    expect(longBubbles()).toEqual([oneLine(long)])
    again.unmount()
    unmount()
    const last = statusReader()
    vi.setSystemTime(at('05:48:00.000'))
    prompts = last.read(done(long), { beacon: [hook] })
    await showAt('05:48:00.100', WHOLE_TURN, prompts, false, [], hooked)
    await showAt('05:48:01.000', WHOLE_TURN, prompts, false, [], hooked)
    expect(longBubbles()).toEqual([oneLine(long)])
    last.unmount()
    unmount()
  })

  // The limit, pinned. Without the hook's copy (a Codex tab, a Windows host,
  // a Claude tab launched without the hook) the phone holds only the status's
  // 200-character cut and the box's whole reading, and the same inputs are
  // the two messages below. The store merges the two only when the box read
  // them within 30 s of the cut copy (mobile-native-chat-remember-echo.ts), so
  // here the message is drawn cut beside its box row while it waits and cut
  // and whole once Claude takes it: drawn twice, never lost. What would
  // settle it is the words past the field, which only the hook carries.
  for (const kind of ['claude', 'codex'] as const) {
    it(`still draws it cut and whole with no hook copy of it, on a ${kind === 'claude' ? 'Claude Code tab launched without the hook' : 'Codex tab'} (a limit)`, async () => {
      agent = kind
      const long = `${BASE}, first on staging`
      const cut = oneLine(normalizePromptField(long))
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(long, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts)
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:41:40.000'))
      prompts = again.read(working(long, '05:41:39.000'))
      await showAt('05:41:40.100', WHOLE_TURN.slice(0, -4), prompts, true, [long])
      await showAt('05:41:41.000', WHOLE_TURN.slice(0, -4), prompts, true, [long])
      expect(longBubbles()).toEqual([cut])
      await showAt('05:42:30.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
      await showAt('05:42:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
      expect(longBubbles()).toEqual([cut, oneLine(long)])
      again.unmount()
      unmount()
    })
  }

  // The case W1's merge window was kept for: two long messages that share
  // their first 200 characters, the first taken at once, the second queued
  // minutes later. The status carries one cut copy of the two; the hook
  // carries each whole.
  it('draws both of two long desk messages that share their first 200 characters, each whole, while open and after the chat comes back', async () => {
    agent = 'claude'
    const one = `${BASE}, first on staging`
    const two = `${BASE}, then on production with the new flag`
    const hookOne = beaconCopy('71002', one, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const hookTwo = beaconCopy('71003', two, WRITTEN_AFTER_SECOND, '05:39:29.100')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(one, '05:36:34.891'), { beacon: [hookOne] })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:37:40.000', WHOLE_TURN.slice(0, -5), prompts, true, [], hooked)
    vi.setSystemTime(at('05:39:30.000'))
    prompts = reader.read(working(two, '05:39:29.000'), { beacon: [hookOne, hookTwo] })
    await showAt('05:39:30.100', WHOLE_TURN.slice(0, -4), prompts, true, [two], hooked)
    await showAt('05:39:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [two], hooked)
    await showAt('05:40:00.000', WHOLE_TURN.slice(0, -4), prompts, true, [], hooked)
    expect(longBubbles()).toEqual([oneLine(one), oneLine(two)])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:48:00.000'))
    prompts = again.read(done(two), { beacon: [hookOne, hookTwo] })
    await showAt('05:48:00.100', WHOLE_TURN, prompts, false, [], hooked)
    await showAt('05:48:01.000', WHOLE_TURN, prompts, false, [], hooked)
    expect(longBubbles()).toEqual([oneLine(one), oneLine(two)])
    again.unmount()
    unmount()
  })

  // The hook's copy of the first never reached the phone (it was typed
  // before the phone listened to the terminal, or the chunk was lost), so a
  // status copy may pair only with a hook copy that reached the phone by the
  // time it did, give or take the two streams' lag: the second's copy,
  // minutes later, is a submission of its own. Paired with it, the first
  // took the second's words and the second was drawn nowhere.
  it('draws the first by its status cut and the second whole when the phone never got the first one’s hook copy, and after the chat comes back', async () => {
    agent = 'claude'
    const one = `${BASE}, first on staging`
    const two = `${BASE}, then on production with the new flag`
    const hookTwo = beaconCopy('71004', two, WRITTEN_AFTER_SECOND, '05:39:29.100')
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(one, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:37:40.000', WHOLE_TURN.slice(0, -5), prompts, true, [], hooked)
    vi.setSystemTime(at('05:39:30.000'))
    prompts = reader.read(working(two, '05:39:29.000'), { beacon: [hookTwo] })
    await showAt('05:39:30.100', WHOLE_TURN.slice(0, -4), prompts, true, [two], hooked)
    await showAt('05:39:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [two], hooked)
    await showAt('05:40:00.000', WHOLE_TURN.slice(0, -4), prompts, true, [], hooked)
    expect(longBubbles()).toEqual([oneLine(normalizePromptField(one)), oneLine(two)])
    expect(drawnAfter(normalizePromptField(one))).toEqual([WRITTEN_BEFORE_SECOND])
    expect(drawnAfter(two)).toEqual([WRITTEN_AFTER_SECOND])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:48:00.000'))
    prompts = again.read(done(two), { beacon: [hookTwo] })
    await showAt('05:48:00.100', WHOLE_TURN, prompts, false, [], hooked)
    await showAt('05:48:01.000', WHOLE_TURN, prompts, false, [], hooked)
    expect(longBubbles()).toEqual([oneLine(normalizePromptField(one)), oneLine(two)])
    expect(drawnAfter(normalizePromptField(one))).toEqual([WRITTEN_BEFORE_SECOND])
    expect(drawnAfter(two)).toEqual([WRITTEN_AFTER_SECOND])
    again.unmount()
    unmount()
  })
})

// Once for words the tab status folds (several lines), whose hook copies pair
// by that folding, and once for words it carries as typed.
for (const [label, WORDS] of [
  ['a message of several lines', SECOND_SEND],
  ['a message of one line', 'yes, go ahead with the migration']
] as const) {
  /** The next turn, started by the same words typed at the desk once the first
   *  turn was over: its row, and the pane as Orca holds it then. */
  const AGAIN_ROW = user('5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', WORDS, '05:49:46.995')
  const AGAIN_REPLY = text('6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c', '05:50:05.000')
  function againRun(stamped: string): NonNullable<AgentStatusPromptSource> {
    return {
      ...working(WORDS, stamped),
      stateStartedAt: at('05:49:47.000'),
      stateHistory: [...BEFORE_TURN, { state: 'working', prompt: normalizePromptField(WORDS), startedAt: at('05:08:00.600') }, { state: 'done', prompt: normalizePromptField(WORDS), startedAt: TURN_ENDED }]
    }
  }
  /** Claude dequeues a message still queued as the turn ends, as the next
   *  turn's row, and fires no UserPromptSubmit for it (checked on 2.1.284). */
  const DEQUEUED = user('7d1e0c5a-3b2f-4e61-9a8d-0c4b5e6f7a81', WORDS, '05:46:54.300')
  const DEQUEUED_ANSWER = text('8e2f1d6b-4c3a-4f72-8b9e-1d5c6f7a8b92', '05:47:20.000')

  describe(`the same words mid-turn, then as the prompt that starts the next turn: ${label}`, () => {
    let agent: 'claude' | 'codex' = 'claude'
    const { unmount, showAt, where } = midturnChat(frames, () => agent)
    /** Every user bubble or row of the words, each with the row it follows. */
    const placesOf = (words: string) => {
      const found = where(words)
      return found.at.map((index) => found.after(index))
    }
    /** The mid-turn message watched arriving and taken mid-turn, the turn's
     *  end, and the same words typed at the desk as the next prompt. */
    async function sentTwice(reader: ReturnType<typeof statusReader>, beacon: (upTo: 'first' | 'both') => DesktopPrompt[] | undefined, hook: { promptHook?: boolean }): Promise<DesktopPrompt[]> {
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hook)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: beacon('first') })
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hook)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [], hook)
      vi.setSystemTime(at('05:46:51.100'))
      prompts = reader.read(done(WORDS), { beacon: beacon('first') })
      await showAt('05:46:51.200', WHOLE_TURN, prompts, false, [], hook)
      vi.setSystemTime(at('05:49:47.100'))
      prompts = reader.read(againRun('05:49:47.000'), { beacon: beacon('both') })
      await showAt('05:49:47.200', WHOLE_TURN, prompts, true, [], hook)
      await showAt('05:49:48.000', [...WHOLE_TURN, AGAIN_ROW], prompts, true, [], hook)
      await showAt('05:50:06.000', [...WHOLE_TURN, AGAIN_ROW, AGAIN_REPLY], prompts, true, [], hook)
      return prompts
    }
    const first = beaconCopy('71101', WORDS, WRITTEN_BEFORE_SECOND, '05:36:35.050')
    const second = beaconCopy('71102', WORDS, LAST_REPLY, '05:49:47.050')

    // Gap D of the final review of fix/midturn-prompt-at-end: the second turn's
    // row landed the first turn's bubble too, and one of the two was lost. The
    // hook's copy of the second submission is the evidence: Claude fires no
    // UserPromptSubmit when it dequeues a message, so a second copy of the words
    // is a second submission, and that row is its own.
    it('keeps both, each where it was sent, on a tab with the prompt hook, and after the chat comes back', async () => {
      agent = 'claude'
      const reader = statusReader()
      await sentTwice(reader, (upTo) => (upTo === 'first' ? [first] : [first, second]), hooked)
      expect(placesOf(WORDS)).toEqual([WRITTEN_BEFORE_SECOND, LAST_REPLY])
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:52:00.000'))
      const prompts = again.read({ ...againRun('05:50:05.500'), state: 'done', stateStartedAt: at('05:50:05.500') }, { beacon: [first, second] })
      await showAt('05:52:00.100', [...WHOLE_TURN, AGAIN_ROW, AGAIN_REPLY], prompts, false, [], hooked)
      await showAt('05:52:01.000', [...WHOLE_TURN, AGAIN_ROW, AGAIN_REPLY], prompts, false, [], hooked)
      expect(placesOf(WORDS)).toEqual([WRITTEN_BEFORE_SECOND, LAST_REPLY])
      again.unmount()
      unmount()
    })

    // The phone never got the first's hook copy (a lost chunk), only its status
    // copy, which it drew and remembered. After the chat comes back the tab
    // status carries only the second turn's prompt, and the remembered bubble
    // is all that holds the first: the second's row is not its row either.
    it('keeps both when the phone got only the second submission’s hook copy, and after the chat comes back', async () => {
      agent = 'claude'
      const reader = statusReader()
      await sentTwice(reader, (upTo) => (upTo === 'first' ? undefined : [second]), hooked)
      expect(placesOf(WORDS)).toEqual([WRITTEN_BEFORE_SECOND, LAST_REPLY])
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:52:00.000'))
      const prompts = again.read({ ...againRun('05:50:05.500'), state: 'done', stateStartedAt: at('05:50:05.500') }, { beacon: [second] })
      await showAt('05:52:00.100', [...WHOLE_TURN, AGAIN_ROW, AGAIN_REPLY], prompts, false, [], hooked)
      await showAt('05:52:01.000', [...WHOLE_TURN, AGAIN_ROW, AGAIN_REPLY], prompts, false, [], hooked)
      expect(placesOf(WORDS)).toEqual([WRITTEN_BEFORE_SECOND, LAST_REPLY])
      again.unmount()
      unmount()
    })

    // The limit, pinned: with no hook copy of the second submission (a Codex
    // tab, a Windows host, a Claude tab launched without the hook, or a second
    // submission made while the phone did not listen to the terminal), the
    // second turn's row is the same input as the row Claude writes when it
    // dequeues the first message at the turn's end, and the first is retired
    // as it was: one of the two is lost, and none is drawn twice.
    for (const kind of ['claude', 'codex'] as const) {
      it(`still draws one of the two with no hook copy of the second submission, on a ${kind === 'claude' ? 'Claude Code tab launched without the hook' : 'Codex tab'} (a limit)`, async () => {
        agent = kind
        const reader = statusReader()
        await sentTwice(reader, () => undefined, {})
        expect(placesOf(WORDS)).toEqual([LAST_REPLY])
        reader.unmount()
        unmount()
      })
    }

    // The guards: the first message's own copies only, and the row Claude
    // writes when it dequeues it at the turn's end. Each of these drew the
    // message twice under the rule gap D's first fix tried (a4c67c53, withdrawn
    // in d57459ae), which went by when the phone saw the box let it go.
    const dequeuedRun = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
      ...working(WORDS, stamped),
      stateStartedAt: at('05:46:54.200'),
      stateHistory: [...done(WORDS).stateHistory!, { state: 'done', prompt: normalizePromptField(WORDS), startedAt: TURN_ENDED }]
    })
    it('draws a message Claude dequeued at the turn end once when the phone slept through the dequeue, with the hook copy', async () => {
      agent = 'claude'
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [first] })
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS], hooked)
      await showAt('05:40:00.000', WHOLE_TURN.slice(0, -3), prompts, true, [WORDS], hooked)
      vi.setSystemTime(at('06:05:00.000'))
      prompts = reader.read(done(WORDS, '05:47:30.000'), { beacon: [first] })
      await showAt('06:05:00.100', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER], prompts, false, [], hooked)
      await showAt('06:05:10.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER], prompts, false, [], hooked)
      expect(placesOf(WORDS)).toEqual([LAST_REPLY])
      reader.unmount()
      unmount()
      // A persisted witness coming back.
      const again = statusReader()
      vi.setSystemTime(at('06:20:00.000'))
      prompts = again.read(done(WORDS, '05:47:30.000'), { beacon: [first] })
      await showAt('06:20:00.100', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER], prompts, false, [], hooked)
      await showAt('06:20:01.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER], prompts, false, [], hooked)
      expect(placesOf(WORDS)).toEqual([LAST_REPLY])
      again.unmount()
      unmount()
    })

    it('draws a queued message the box reader never listed once after Claude dequeues it at the turn end, with the hook copy', async () => {
      agent = 'claude'
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [first] })
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [], hooked)
      vi.setSystemTime(at('05:46:54.800'))
      prompts = reader.read(dequeuedRun('05:46:54.400'), { beacon: [first] })
      await showAt('05:46:56.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [], hooked)
      await showAt('05:47:21.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER], prompts, true, [], hooked)
      expect(placesOf(WORDS)).toEqual([LAST_REPLY])
      reader.unmount()
      unmount()
    })

    it('draws a message the queue box held until the turn ended once with the phone clock 3 s behind, with the hook copy', async () => {
      agent = 'claude'
      const lateFirst = { ...first, seenAt: at('05:36:32.050') }
      const reader = statusReader()
      vi.setSystemTime(at('05:34:57.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:34:57.100', BEFORE_FIRST, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:32.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [lateFirst] })
      await showAt('05:36:32.100', BEFORE_SECOND, prompts, true, [WORDS], hooked)
      await showAt('05:46:47.900', WHOLE_TURN, prompts, true, [WORDS], hooked)
      vi.setSystemTime(at('05:46:51.800'))
      prompts = reader.read(done(WORDS, '05:46:54.200'), { beacon: [lateFirst] })
      await showAt('05:46:52.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [], hooked)
      await showAt('05:47:10.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [], hooked)
      expect(placesOf(WORDS)).toEqual([LAST_REPLY])
      reader.unmount()
      unmount()
    })

    // Both at once: the first dequeued at the turn end, then the same words
    // typed again for the turn after. Each row is its own submission's.
    it('draws a message Claude dequeued and the same words typed later as their two rows only', async () => {
      agent = 'claude'
      const typedAgain = user('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', WORDS, '05:49:46.995')
      const third = beaconCopy('71103', WORDS, DEQUEUED_ANSWER.id, '05:49:47.050')
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [first] })
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS], hooked)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [WORDS], hooked)
      vi.setSystemTime(at('05:46:54.800'))
      prompts = reader.read(dequeuedRun('05:46:54.400'), { beacon: [first] })
      await showAt('05:46:56.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [], hooked)
      await showAt('05:47:21.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER], prompts, false, [], hooked)
      vi.setSystemTime(at('05:49:47.100'))
      prompts = reader.read({ ...dequeuedRun('05:49:47.000'), stateStartedAt: at('05:49:47.000') }, { beacon: [first, third] })
      await showAt('05:49:48.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER, typedAgain], prompts, true, [], hooked)
      await showAt('05:49:49.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER, typedAgain], prompts, true, [], hooked)
      expect(placesOf(WORDS)).toEqual([LAST_REPLY, DEQUEUED_ANSWER.id])
      reader.unmount()
      unmount()
    })

    // The same words sent twice in one turn, both still queued when it ended:
    // Claude dequeues each as a turn's row, the first first. Each row is its
    // own submission's, not both the later one's.
    it('draws two messages of the same words both dequeued at the turn end as their two rows only, and after the chat comes back', async () => {
      agent = 'claude'
      const later = beaconCopy('71105', WORDS, WRITTEN_AFTER_SECOND, '05:38:10.050')
      const laterRow = user('1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', WORDS, '05:47:21.000')
      const laterAnswer = text('2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', '05:47:40.000')
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [first] })
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [WORDS], hooked)
      vi.setSystemTime(at('05:38:10.000'))
      prompts = reader.read(working(WORDS, '05:38:09.900'), { beacon: [first, later] })
      await showAt('05:38:10.100', WHOLE_TURN.slice(0, -5), prompts, true, [WORDS, WORDS], hooked)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [WORDS, WORDS], hooked)
      vi.setSystemTime(at('05:46:54.800'))
      prompts = reader.read(dequeuedRun('05:46:54.400'), { beacon: [first, later] })
      await showAt('05:46:56.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [WORDS], hooked)
      await showAt('05:47:22.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER, laterRow], prompts, true, [], hooked)
      await showAt('05:47:41.000', [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER, laterRow, laterAnswer], prompts, false, [], hooked)
      expect(placesOf(WORDS)).toEqual([LAST_REPLY, DEQUEUED_ANSWER.id])
      reader.unmount()
      unmount()
      // Review of 099b7eb0: while the first one's row was the only row of the
      // words, it went to the second, still queued, and the box's witness of
      // the first remembered it as not its own: drawn beside both rows once
      // the chat came back.
      const again = statusReader()
      vi.setSystemTime(at('05:52:00.000'))
      prompts = again.read({ ...dequeuedRun('05:47:40.500'), state: 'done', stateStartedAt: at('05:47:40.500') }, { beacon: [first, later] })
      const rows = [...WHOLE_TURN, DEQUEUED, DEQUEUED_ANSWER, laterRow, laterAnswer]
      await showAt('05:52:00.100', rows, prompts, false, [], hooked)
      await showAt('05:52:01.000', rows, prompts, false, [], hooked)
      expect(placesOf(WORDS)).toEqual([LAST_REPLY, DEQUEUED_ANSWER.id])
      again.unmount()
      unmount()
    })

    // The same words sent twice in one turn and taken mid-turn both times: the
    // status carries them once (its prompt did not change), the hook twice.
    it('draws two messages of the same words taken mid-turn in one turn as two, with the hook copies', async () => {
      agent = 'claude'
      const again = beaconCopy('71104', WORDS, WRITTEN_AFTER_SECOND, '05:38:10.050')
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(WORDS, '05:36:34.891'), { beacon: [first] })
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
      vi.setSystemTime(at('05:38:10.000'))
      prompts = reader.read(working(WORDS, '05:38:09.900'), { beacon: [first, again] })
      await showAt('05:38:10.100', WHOLE_TURN.slice(0, -5), prompts, true, [], hooked)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [], hooked)
      expect(placesOf(WORDS)).toEqual([WRITTEN_BEFORE_SECOND, WRITTEN_AFTER_SECOND])
      reader.unmount()
      unmount()
    })
  })
}

// Gap C of the final review of fix/midturn-prompt-at-end: Orca's stand-in (a
// status with no prompt and no history, when its hook row is stale) as the
// chat's first status used up the chat's first reading, so a message taken
// before the chat opened, on the next status, read as one the chat watched
// arrive: timed by that status's ping, it was drawn at the tail, below the
// rows written after it. Taken for a found one instead (67763919, withdrawn in
// f4a46e18), a message typed after the chat opened was timed by its run's
// start and, with that start off the page, drawn nowhere. The status cannot
// tell the two; the prompt hook's copy can: it names the row the message was
// typed after, and on a tab with the hook the chat listens to the terminal
// while it is open, so a message typed then always has one.
describe('a message on the first status after Orca’s stand-in', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, showAt, where } = midturnChat(frames, () => agent)
  const placesOf = (words: string) => {
    const found = where(words)
    return found.at.map((index) => found.after(index))
  }
  /** The run the message came in began on the page the chat holds, after the
   *  result written at 05:36:02; the chat opens at 05:40, mid-run. */
  const RUN_START = at('05:36:10.000')
  const run = (stamped: string): NonNullable<AgentStatusPromptSource> => ({ ...working(SECOND_SEND, stamped), stateStartedAt: RUN_START })
  const UP_TO_05_40 = WHOLE_TURN.slice(0, -4)
  const hookCopy = (received: string) => beaconCopy('72001', SECOND_SEND, WRITTEN_BEFORE_SECOND, received)

  async function openOnStandIn(reader: ReturnType<typeof statusReader>, hook: { promptHook?: boolean }): Promise<void> {
    vi.setSystemTime(at('05:40:00.000'))
    const prompts = reader.read({ ...standIn('05:39:59.000'), state: 'working' })
    await showAt('05:40:00.100', UP_TO_05_40, prompts, true, [], hook)
  }

  // Taken before the chat opened, while the tab showed its terminal: the
  // phone got the hook's copy then.
  it('draws a message taken before the chat opened where it was sent, by the hook copy the phone got then', async () => {
    agent = 'claude'
    const reader = statusReader()
    await openOnStandIn(reader, hooked)
    vi.setSystemTime(at('05:40:05.100'))
    const prompts = reader.read(run('05:40:05.000'), { beacon: [hookCopy('05:36:35.050')] })
    await showAt('05:40:05.200', UP_TO_05_40, prompts, true, [], hooked)
    await showAt('05:40:30.000', UP_TO_05_40, prompts, true, [], hooked)
    expect(placesOf(SECOND_SEND)).toEqual([WRITTEN_BEFORE_SECOND])
    reader.unmount()
    unmount()
  })

  // No hook copy of it: the tab has the hook, and the chat has listened to
  // the terminal since it opened, so the message came before: it is placed by
  // the start of the run it came in, above the rows written after it, not by
  // the status's ping at the tail.
  it('draws a message taken before the chat opened in its run, not at the tail, when the phone never got its hook copy', async () => {
    agent = 'claude'
    const reader = statusReader()
    await openOnStandIn(reader, hooked)
    vi.setSystemTime(at('05:40:05.100'))
    const prompts = reader.read(run('05:40:05.000'))
    await showAt('05:40:05.200', UP_TO_05_40, prompts, true, [], hooked)
    await showAt('05:40:30.000', UP_TO_05_40, prompts, true, [], hooked)
    // After the result written at 05:36:02, which folds into the words
    // written at 05:34:51 with the call before it.
    expect(placesOf(SECOND_SEND)).toEqual([BEFORE_FIRST[0]!.id])
    reader.unmount()
    unmount()
  })

  // Found, with its run begun on a page the chat has not loaded: there is no
  // row to place it by, and it is drawn by the status's ping rather than
  // nowhere, as before.
  it('still draws a message taken before the chat opened, at the status’s ping, when its run began off the page', async () => {
    agent = 'claude'
    const reader = statusReader()
    await openOnStandIn(reader, hooked)
    vi.setSystemTime(at('05:40:05.100'))
    const prompts = reader.read(working(SECOND_SEND, '05:40:05.000'))
    await showAt('05:40:05.200', UP_TO_05_40, prompts, true, [], hooked)
    await showAt('05:40:30.000', UP_TO_05_40, prompts, true, [], hooked)
    expect(placesOf(SECOND_SEND)).toEqual([WRITTEN_AFTER_SECOND])
    reader.unmount()
    unmount()
  })

  // The same after a reconnect: the stand-in first on the way back, and a
  // message taken while the link was down, when the phone heard nothing of
  // the terminal. Found, it came after the last status read before the drop.
  it('draws a message taken while the link was down after the last status read before it, not at the tail, with the hook', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hooked)
    reader.read(working(EARLIER, '05:34:55.850'), { connected: false })
    vi.setSystemTime(at('05:40:00.000'))
    reader.read(working(EARLIER, '05:34:55.850'))
    prompts = reader.read({ ...standIn('05:39:59.000'), state: 'working' })
    await showAt('05:40:00.100', UP_TO_05_40, prompts, true, [], hooked)
    vi.setSystemTime(at('05:40:05.100'))
    prompts = reader.read(working(SECOND_SEND, '05:40:05.000'))
    await showAt('05:40:05.200', UP_TO_05_40, prompts, true, [], hooked)
    await showAt('05:40:30.000', UP_TO_05_40, prompts, true, [], hooked)
    expect(placesOf(SECOND_SEND)).toEqual([BEFORE_FIRST[0]!.id])
    reader.unmount()
    unmount()
  })

  // The guard f4a46e18 kept: a message typed after the chat opened, whose
  // hook copy the chat got as it arrived, the status's first or a moment
  // after it. Its run began off the page this time.
  for (const order of ['with its status', 'a second after its status'] as const) {
    it(`draws a message typed after the chat opened where it was sent, its hook copy ${order}`, async () => {
      agent = 'claude'
      const reader = statusReader()
      vi.setSystemTime(at('05:36:26.000'))
      let prompts = reader.read({ ...standIn('05:36:25.500'), state: 'working' })
      await showAt('05:36:26.100', BEFORE_SECOND, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:35.000'))
      const copy = hookCopy('05:36:35.050')
      prompts = reader.read(working(SECOND_SEND, '05:36:34.891'), { beacon: order === 'with its status' ? [copy] : [] })
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
      vi.setSystemTime(at('05:36:36.000'))
      prompts = reader.read(working(SECOND_SEND, '05:36:34.891'), { beacon: [copy] })
      await showAt('05:36:36.100', BEFORE_SECOND, prompts, true, [], hooked)
      await showAt('05:37:40.000', WHOLE_TURN.filter((row) => row.timestamp! <= at('05:37:38.938')), prompts, true, [], hooked)
      expect(placesOf(SECOND_SEND)).toEqual([WRITTEN_BEFORE_SECOND])
      reader.unmount()
      unmount()
    })
  }

  // The review of 5d17a9d0. The chat opens on the stand-in at 05:36:26, and
  // the message is typed at 05:36:35 in a run that began at 05:36:10.
  const upTo = (clock: string) => WHOLE_TURN.filter((row) => row.timestamp! <= at(clock))
  async function openEarlyOnStandIn(reader: ReturnType<typeof statusReader>): Promise<void> {
    vi.setSystemTime(at('05:36:26.000'))
    const prompts = reader.read({ ...standIn('05:36:25.500'), state: 'working' })
    await showAt('05:36:26.100', BEFORE_SECOND, prompts, true, [], hooked)
  }

  // B1: its hook copy comes 6 s after its status copy, past the wait, when
  // the copy has been placed as found; it moves where the hook copy says.
  it('draws a message typed after the chat opened where it was sent when its hook copy comes after the wait', async () => {
    agent = 'claude'
    const reader = statusReader()
    await openEarlyOnStandIn(reader)
    vi.setSystemTime(at('05:36:35.000'))
    let prompts = reader.read(run('05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:36:40.500', BEFORE_SECOND, prompts, true, [], hooked)
    vi.setSystemTime(at('05:36:41.000'))
    prompts = reader.read(run('05:36:34.891'), { beacon: [hookCopy('05:36:41.000')] })
    await showAt('05:36:41.100', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:37:40.000', upTo('05:37:38.938'), prompts, true, [], hooked)
    expect(placesOf(SECOND_SEND)).toEqual([WRITTEN_BEFORE_SECOND])
    reader.unmount()
    unmount()
  })

  // B2: its hook copy came with it but names a row the phone does not hold.
  // Reaching the phone after the stand-in, it was heard as it was typed, and
  // the status's ping places it, as any watched copy.
  it('draws a message typed after the chat opened where it was sent when its hook copy names a row the phone does not hold', async () => {
    agent = 'claude'
    const reader = statusReader()
    await openEarlyOnStandIn(reader)
    vi.setSystemTime(at('05:36:35.000'))
    const copy = beaconCopy('73002', SECOND_SEND, 'aaaaaaaa-0000-4000-8000-000000000001', '05:36:35.050')
    const prompts = reader.read(run('05:36:34.891'), { beacon: [copy] })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:36:41.000', BEFORE_SECOND, prompts, true, [], hooked)
    await showAt('05:37:40.000', upTo('05:37:38.938'), prompts, true, [], hooked)
    expect(placesOf(SECOND_SEND)).toEqual([WRITTEN_BEFORE_SECOND])
    reader.unmount()
    unmount()
  })

  // B4 and E1: the chat comes back. During the wait the echo is drawn where
  // it was first seen and not remembered there; after it, a copy found on the
  // chat's first status goes after its hook copy's row, and with none the
  // remembered one stays in its run.
  for (const withCopy of [true, false]) {
    it(`keeps a message where it was placed after the chat comes back${withCopy ? ', left during the wait, with its hook copy' : ', with no hook copy'}`, async () => {
      agent = 'claude'
      const reader = statusReader()
      if (withCopy) {
        await openEarlyOnStandIn(reader)
        vi.setSystemTime(at('05:36:35.000'))
        const prompts = reader.read(run('05:36:34.891'))
        await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [], hooked)
      } else {
        await openOnStandIn(reader, hooked)
        vi.setSystemTime(at('05:40:05.100'))
        const prompts = reader.read(run('05:40:05.000'))
        await showAt('05:40:05.200', UP_TO_05_40, prompts, true, [], hooked)
        await showAt('05:40:30.000', UP_TO_05_40, prompts, true, [], hooked)
        expect(placesOf(SECOND_SEND)).toEqual([BEFORE_FIRST[0]!.id])
      }
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:42:00.000'))
      const prompts = again.read(run('05:41:59.000'), withCopy ? { beacon: [hookCopy('05:36:36.000')] } : {})
      await showAt('05:42:00.100', UP_TO_05_40, prompts, true, [], hooked)
      await showAt('05:42:10.000', UP_TO_05_40, prompts, true, [], hooked)
      expect(placesOf(SECOND_SEND)).toEqual(withCopy ? [WRITTEN_BEFORE_SECOND] : [BEFORE_FIRST[0]!.id])
      again.unmount()
      unmount()
    })
  }

  // The limit, pinned. With no hook (a Codex tab, a Windows host, a Claude
  // tab launched without it) a message taken before the chat opened and one
  // typed after reach the reader in the same shape, and it is drawn by the
  // status's ping as before: late, below the rows written after it, but
  // drawn. What would settle it is the row it was typed after, which only
  // the hook's copy names.
  for (const kind of ['claude', 'codex'] as const) {
    it(`still draws a message taken before the chat opened at the status's ping with no hook, on a ${kind === 'claude' ? 'Claude Code tab launched without the hook' : 'Codex tab'} (a limit)`, async () => {
      agent = kind
      const reader = statusReader()
      await openOnStandIn(reader, {})
      vi.setSystemTime(at('05:40:05.100'))
      const prompts = reader.read(run('05:40:05.000'))
      await showAt('05:40:05.200', UP_TO_05_40, prompts, true, [])
      await showAt('05:40:30.000', UP_TO_05_40, prompts, true, [])
      // Below the words written after it (the calls since fold into them).
      expect(placesOf(SECOND_SEND)).toEqual([WRITTEN_AFTER_SECOND])
      reader.unmount()
      unmount()
    })
  }
})

// Two messages queued mid-turn and still queued when the turn ended: Claude
// dequeued them as one row, their words a line apart. Each is drawn beside
// that row, as on main: splitting it into its messages was tried (c3844d00)
// and withdrawn, since a prompt typed at the desk can be made of earlier
// messages' words, and it lost a message taken mid-turn
// (mobile-chat-midturn-joined-rows.test.ts). The first's words typed again
// as the next turn's prompt then land the first's copy, as on main: with the
// hook copies that row is the next submission's own, and the first stayed
// beside the joined row for good until the joined row between them was taken
// for a row that may be its own (joinedLineBetween; the review of d147a9c4,
// D1). The same on both kinds of tab: that limit is pinned.
describe('two queued messages Claude dequeued as one row', () => {
  const { unmount, showAt, where } = midturnChat(frames, () => 'claude')
  const X = 'first queued thing to look at'
  const Y = 'second queued thing to look at'
  const JOINED = user('9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', `${X}\n${Y}`, '05:46:54.300')
  const ANSWER = text('8e2f1d6b-4c3a-4f72-8b9e-1d5c6f7a8b92', '05:47:20.000')
  const AGAIN = user('0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', X, '05:49:46.995')
  const AGAIN_ANSWER = text('6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c', '05:50:05.000')
  const users = () => drawn(frames.at(-1)!).filter((row) => row.role === 'user').map((row) => row.text)
  const joinedWords = oneLine(`${X} ${Y}`)
  void where

  for (const withHook of [true, false]) {
    it(`still draws each message beside the joined row until a row of its own words comes${withHook ? ', with the hook copies' : ''} (a limit), and after the chat comes back`, async () => {
      const hx = beaconCopy('92001', X, WRITTEN_BEFORE_SECOND, '05:36:30.050')
      const hy = beaconCopy('92002', Y, WRITTEN_BEFORE_SECOND, '05:36:40.050')
      const hx2 = beaconCopy('92003', X, ANSWER.id, '05:49:47.050')
      const beacon = (list: DesktopPrompt[]) => (withHook ? { beacon: list } : {})
      const hook = withHook ? hooked : {}
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts, true, [], hook)
      vi.setSystemTime(at('05:36:30.000'))
      prompts = reader.read(working(X, '05:36:29.000'), beacon([hx]))
      await showAt('05:36:30.100', BEFORE_SECOND, prompts, true, [X], hook)
      vi.setSystemTime(at('05:36:40.000'))
      prompts = reader.read(working(Y, '05:36:39.000'), beacon([hx, hy]))
      await showAt('05:36:40.100', BEFORE_SECOND, prompts, true, [X, Y], hook)
      await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [X, Y], hook)
      await showAt('05:46:55.300', [...WHOLE_TURN, JOINED], prompts, true, [], hook)
      await showAt('05:47:21.000', [...WHOLE_TURN, JOINED, ANSWER], prompts, false, [], hook)
      expect(users()).toEqual([X, Y, joinedWords])
      const run: NonNullable<AgentStatusPromptSource> = {
        ...working(X, '05:49:47.000'),
        stateStartedAt: at('05:49:47.000'),
        stateHistory: [...done(Y).stateHistory!, { state: 'done', prompt: normalizePromptField(Y), startedAt: TURN_ENDED }]
      }
      vi.setSystemTime(at('05:49:47.100'))
      prompts = reader.read(run, beacon([hx, hy, hx2]))
      await showAt('05:49:48.000', [...WHOLE_TURN, JOINED, ANSWER, AGAIN], prompts, true, [], hook)
      await showAt('05:50:06.000', [...WHOLE_TURN, JOINED, ANSWER, AGAIN, AGAIN_ANSWER], prompts, false, [], hook)
      expect(users()).toEqual([Y, joinedWords, X])
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:52:00.000'))
      prompts = again.read({ ...run, state: 'done', stateStartedAt: at('05:50:05.500') }, beacon([hx, hy, hx2]))
      await showAt('05:52:00.100', [...WHOLE_TURN, JOINED, ANSWER, AGAIN, AGAIN_ANSWER], prompts, false, [], hook)
      await showAt('05:52:01.000', [...WHOLE_TURN, JOINED, ANSWER, AGAIN, AGAIN_ANSWER], prompts, false, [], hook)
      expect(users()).toEqual([Y, joinedWords, X])
      again.unmount()
      unmount()
    })
  }
})

