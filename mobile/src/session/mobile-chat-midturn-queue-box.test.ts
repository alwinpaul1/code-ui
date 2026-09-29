// The agent's queue box and the messages the chat remembers from it: a
// message the box still listed when the chat closed, taken while it was
// closed, and one Claude dequeued at a turn's end. Split out of
// mobile-chat-midturn-prompt-after-reply.test.ts (the report and its records
// are described there), from the final review of fix/midturn-prompt-at-end
// and the reviews of fix/midturn-gaps, 2026-09-29.

import { describe, expect, it, vi } from 'vitest'
import { act } from 'react-test-renderer'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import {
  at,
  FIRST_SEND,
  SECOND_SEND,
  EARLIER,
  NEXT,
  text,
  user,
  WRITTEN_BEFORE_SECOND,
  WRITTEN_AFTER_SECOND,
  BEFORE_FIRST,
  AFTER_FIRST,
  BEFORE_SECOND,
  WHOLE_TURN,
  TURN_ENDED,
  working,
  done,
  statusReader,
  drawn,
  oneLine,
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

describe('a mid-turn message the queue box lists', () => {
  let agent: 'claude' | 'codex' = 'claude'
  const { unmount, drafts, showAt, queueBox, where } = midturnChat(frames, () => agent)

  // Found with gap 2: the queue box took a message the chat had drawn out of
  // the chat when it listed a later one whose words are the first's less the
  // last word. It read the row as its own shortened reading of that message
  // (its prefix rule for the phone's sends), and drew the earlier message in
  // the box in the later one's place.
  it('keeps an earlier message in the chat when the queue box lists a later one that is its words less the last', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:01.700'))
    prompts = reader.read(working(FIRST_SEND, '05:36:01.523'))
    await showAt('05:36:03.000', AFTER_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    await showAt('05:36:40.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    expect(queueBox()).toEqual([oneLine(SECOND_SEND)])
    const first = where(FIRST_SEND)
    expect(first.at).toHaveLength(1)
    expect(first.after(first.at[0]!)).toBe(BEFORE_FIRST[0]!.id)
    reader.unmount()
    unmount()
  })

  // Gap 2 of the final review of fix/midturn-prompt-at-end: a message still
  // in the agent's queue box when the chat closed was drawn only in the box,
  // so the phone never remembered it. Claude took it while the chat was
  // closed, and on the chat's return the status copy, found and timed by its
  // run's start, was on a page not loaded: the message was lost.
  for (const kind of ['claude', 'codex'] as const) {
    it(`draws a message the queue box still held when the chat closed where it arrived once it is taken, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      vi.setSystemTime(at('05:36:01.700'))
      prompts = reader.read(working(FIRST_SEND, '05:36:01.523'))
      await showAt('05:36:03.000', AFTER_FIRST, prompts)
      // Sent at 05:36:34.891 and queued behind a long call.
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
      await showAt('05:36:40.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
      expect(queueBox()).toEqual([oneLine(SECOND_SEND)])
      expect(where(SECOND_SEND).at).toEqual([])
      await showAt('05:37:00.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
      reader.unmount()
      unmount()
      // Taken at 05:37:31 while the chat was closed; back after the turn.
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      prompts = again.read(done(SECOND_SEND))
      await showAt('05:48:00.100', WHOLE_TURN, prompts, false)
      await showAt('05:48:01.000', WHOLE_TURN, prompts, false)
      const rows = drawn(frames.at(-1)!)
      const second = where(SECOND_SEND)
      expect(second.at).toHaveLength(1)
      expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
      expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
      again.unmount()
      unmount()
    })
  }

  it('keeps a message the queue box still holds when the chat comes back in the box, then draws it once where it arrived', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:36:35.000'))
    let prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    await showAt('05:37:00.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:37:10.000'))
    prompts = again.read(working(SECOND_SEND, '05:37:09.000'))
    await showAt('05:37:10.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    expect(queueBox()).toEqual([oneLine(SECOND_SEND)])
    expect(where(SECOND_SEND).at).toEqual([])
    const taken = WHOLE_TURN.filter((row) => row.timestamp! <= at('05:37:38.938'))
    await showAt('05:37:40.000', taken, prompts, true, [])
    const second = where(SECOND_SEND)
    expect(queueBox()).toEqual([])
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    again.unmount()
    unmount()
  })

  // The review of fix/midturn-gaps: the status copy reaches the chat a beat
  // before the screen read lists the message in the box (the usual order),
  // so its echo is drawn for that beat and remembered as `desk-<nonce>`. The
  // chat's reader then starts over while the message is still queued. The
  // stored message kept its place against the copy found then (242fa47f), and
  // was drawn as a bubble beside the box's row of it.
  for (const how of ['terminal', 'remount'] as const) {
    it(`draws a message still in the queue box only there after the chat ${how === 'terminal' ? 'shows the terminal and comes back' : 'remounts'}`, async () => {
      agent = 'claude'
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [])
      await showAt('05:36:36.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
      await showAt('05:36:40.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
      expect(queueBox()).toEqual([oneLine(SECOND_SEND)])
      expect(where(SECOND_SEND).at).toEqual([])
      let again = reader
      if (how === 'terminal') {
        vi.setSystemTime(at('05:37:00.000'))
        reader.read(working(SECOND_SEND, '05:36:59.000'), { shown: false })
      } else {
        reader.unmount()
        unmount()
        again = statusReader()
      }
      vi.setSystemTime(at('05:37:10.000'))
      prompts = again.read(working(SECOND_SEND, '05:37:09.000'))
      await showAt('05:37:10.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
      await showAt('05:37:12.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
      expect(queueBox()).toEqual([oneLine(SECOND_SEND)])
      expect(where(SECOND_SEND).at).toEqual([])
      // Taken: drawn once, where it arrived.
      const taken = WHOLE_TURN.filter((row) => row.timestamp! <= at('05:37:38.938'))
      await showAt('05:37:40.000', taken, prompts, true, [])
      expect(queueBox()).toEqual([])
      expect(where(SECOND_SEND).at).toHaveLength(1)
      again.unmount()
      unmount()
    })
  }

  // The same review: a relay drop hands the chat an empty box for a moment
  // while the message is still queued. The stored message was taken for let
  // go, and drawn as a bubble beside the box's row once the box listed it
  // again.
  it('keeps a message still in the queue box only in the box after a relay drop', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:36:35.000'))
    let prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    await showAt('05:37:00.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:37:10.000'))
    prompts = again.read(working(SECOND_SEND, '05:37:09.000'))
    await showAt('05:37:10.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    expect(queueBox()).toEqual([oneLine(SECOND_SEND)])
    expect(where(SECOND_SEND).at).toEqual([])
    await showAt('05:37:20.000', BEFORE_SECOND, prompts, true, [])
    await showAt('05:37:25.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    await showAt('05:37:26.000', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    expect(queueBox()).toEqual([oneLine(SECOND_SEND)])
    expect(where(SECOND_SEND).at).toEqual([])
    again.unmount()
    unmount()
  })

  // Gap D of the final review of fix/midturn-prompt-at-end (the same words
  // sent mid-turn, then typed at the desk as the next turn's prompt: the next
  // turn's row retires the first turn's bubble) is left as it was. The rule
  // tried for it, a desk copy landing only on a row stamped as the agent took
  // it, drew a message still queued when a turn ended twice whenever the
  // phone did not see the box let it go at the moment Claude dequeued it (the
  // review of fix/midturn-gaps): asleep through the turn's end, a box reader
  // that never listed it, a phone clock running behind. Those cannot be told
  // from gap D on the same inputs, and a message drawn twice is the worse
  // error. These pin the side kept.
  /** Claude dequeues a message still queued as the turn ends, as the next
   *  turn's row, and answers it. */
  const DEQUEUED = user('7d1e0c5a-3b2f-4e61-9a8d-0c4b5e6f7a81', SECOND_SEND, '05:46:54.300')
  const ANSWER = text('8e2f1d6b-4c3a-4f72-8b9e-1d5c6f7a8b92', '05:47:20.000')
  const dequeuedRun = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
    ...working(SECOND_SEND, stamped),
    stateStartedAt: at('05:46:54.200'),
    stateHistory: [...done(SECOND_SEND).stateHistory!, { state: 'done', prompt: normalizePromptField(SECOND_SEND), startedAt: TURN_ENDED }]
  })
  /** The chat watched the message queue behind the long run, then the phone
   *  slept from 05:40 to 06:05, through the turn's end and the dequeue. */
  async function queuedThenAsleep(reader: ReturnType<typeof statusReader>): Promise<DesktopPrompt[]> {
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    await showAt('05:40:00.000', WHOLE_TURN.slice(0, -3), prompts, true, [SECOND_SEND])
    vi.setSystemTime(at('06:05:00.000'))
    prompts = reader.read(done(SECOND_SEND, '05:47:30.000'))
    await showAt('06:05:00.100', [...WHOLE_TURN, DEQUEUED, ANSWER], prompts, false, [])
    await showAt('06:05:10.000', [...WHOLE_TURN, DEQUEUED, ANSWER], prompts, false, [])
    return prompts
  }
  for (const kind of ['claude', 'codex'] as const) {
    it(`draws a message the queue box held until the turn ended once when the phone slept through the dequeue, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const reader = statusReader()
      await queuedThenAsleep(reader)
      expect(queueBox()).toEqual([])
      expect(where(SECOND_SEND).at).toHaveLength(1)
      reader.unmount()
      unmount()
    })
  }

  it('draws that message once when the chat comes back later on the next prompt', async () => {
    agent = 'claude'
    const reader = statusReader()
    await queuedThenAsleep(reader)
    reader.unmount()
    unmount()
    const nextRow = user('9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', NEXT, '06:10:00.000')
    const later = text('3f4e5d6c-7b8a-4c9d-8e0f-1a2b3c4d5e6f', '06:10:30.000')
    const again = statusReader()
    vi.setSystemTime(at('06:20:00.000'))
    const prompts = again.read({ ...done(NEXT, '06:10:31.000'), stateStartedAt: at('06:10:31.000') })
    await showAt('06:20:00.100', [...WHOLE_TURN, DEQUEUED, ANSWER, nextRow, later], prompts, false, [])
    await showAt('06:20:01.000', [...WHOLE_TURN, DEQUEUED, ANSWER, nextRow, later], prompts, false, [])
    expect(where(SECOND_SEND).at).toHaveLength(1)
    again.unmount()
    unmount()
  })

  it('draws a queued message the box reader never listed once after Claude dequeues it at the turn end', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [])
    await showAt('05:36:45.000', BEFORE_SECOND, prompts, true, [])
    await showAt('05:46:50.900', WHOLE_TURN, prompts, true, [])
    vi.setSystemTime(at('05:46:54.800'))
    prompts = reader.read(dequeuedRun('05:46:54.400'))
    await showAt('05:46:56.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [])
    await showAt('05:47:21.000', [...WHOLE_TURN, DEQUEUED, ANSWER], prompts, true, [])
    expect(where(SECOND_SEND).at).toHaveLength(1)
    reader.unmount()
    unmount()
  })

  it('draws a message the queue box held until the turn ended once with the phone clock 3 s behind', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:34:57.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:34:57.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:32.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:32.100', BEFORE_SECOND, prompts, true, [SECOND_SEND])
    await showAt('05:46:47.900', WHOLE_TURN, prompts, true, [SECOND_SEND])
    vi.setSystemTime(at('05:46:51.800'))
    prompts = reader.read(done(SECOND_SEND, '05:46:54.200'))
    await showAt('05:46:52.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [])
    await showAt('05:47:10.000', [...WHOLE_TURN, DEQUEUED], prompts, true, [])
    expect(where(SECOND_SEND).at).toHaveLength(1)
    reader.unmount()
    unmount()
  })

  // Round 2 of the review of fix/midturn-gaps: the queue box's row of a
  // remembered message is not always its exact words.
  // Codex keeps its preview's ellipsis: three lines, then a `…` line
  // (codex-terminal-queued-messages.test.ts).
  it('draws a long desk message Codex still holds only in the box after the chat comes back', async () => {
    agent = 'codex'
    const preview =
      'Password changes now end only password sessions. Next, setting up your own\nbirth-date sign-in: it will now end your app sessions but keep your Google\nweb session.\n…'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [])
    await showAt('05:36:36.000', BEFORE_SECOND, prompts, true, [preview])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:37:10.000'))
    prompts = again.read(working(SECOND_SEND, '05:37:09.000'))
    await showAt('05:37:10.100', BEFORE_SECOND, prompts, true, [preview])
    await showAt('05:37:12.000', BEFORE_SECOND, prompts, true, [preview])
    expect(queueBox()).toHaveLength(1)
    expect(where(SECOND_SEND).at).toEqual([])
    again.unmount()
    unmount()
  })

  // A message longer than the tab status's 200-character field: the status
  // copy, and the message the chat remembered from its echo, are cut there,
  // while the box lists the whole message.
  for (const how of ['terminal', 'remount'] as const) {
    it(`draws a long desk message Claude Code still holds only in the box after the chat ${how === 'terminal' ? 'shows the terminal and comes back' : 'remounts'}`, async () => {
      agent = 'claude'
      const long = `${SECOND_SEND} issue, and also please check whether the session list on the account page still shows the ended sessions after a refresh, because it looked stale to me yesterday`
      expect(normalizePromptField(long).length).toBeLessThan(long.length)
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(long, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, [])
      await showAt('05:36:36.000', BEFORE_SECOND, prompts, true, [long])
      await showAt('05:36:40.000', BEFORE_SECOND, prompts, true, [long])
      let again = reader
      if (how === 'terminal') {
        vi.setSystemTime(at('05:37:00.000'))
        reader.read(working(long, '05:36:59.000'), { shown: false })
      } else {
        reader.unmount()
        unmount()
        again = statusReader()
      }
      vi.setSystemTime(at('05:37:10.000'))
      prompts = again.read(working(long, '05:37:09.000'))
      await showAt('05:37:10.100', BEFORE_SECOND, prompts, true, [long])
      await showAt('05:37:12.000', BEFORE_SECOND, prompts, true, [long])
      expect(queueBox()).toHaveLength(1)
      expect(drawn(frames.at(-1)!).filter((row) => row.role === 'user')).toEqual([])
      // Taken: drawn once.
      const taken = WHOLE_TURN.filter((row) => row.timestamp! <= at('05:37:38.938'))
      await showAt('05:37:40.000', taken, prompts, true, [])
      await showAt('05:37:41.000', taken, prompts, true, [])
      expect(queueBox()).toEqual([])
      expect(drawn(frames.at(-1)!).filter((row) => row.role === 'user').map((row) => row.text)).toEqual([oneLine(long)])
      again.unmount()
      unmount()
    })
  }

  // Photos of no words have no words to match: a row of `[Image #6]` is not
  // the remembered `[Image #5]`.
  it('keeps an earlier desk photo of no words in the chat while a later one waits in the box', async () => {
    agent = 'claude'
    const photoBubbles = () => drawn(frames.at(-1)!).flatMap((row, index) => (row.role === 'user' && row.text === '' ? [index] : []))
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working('[Image #5]', '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    await showAt('05:37:40.000', WHOLE_TURN.slice(0, -5), prompts)
    expect(photoBubbles()).toHaveLength(1)
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:39:30.000'))
    prompts = again.read(working('[Image #6]', '05:39:29.000'))
    await showAt('05:39:30.100', WHOLE_TURN.slice(0, -4), prompts, true, ['[Image #6]'])
    await showAt('05:39:31.000', WHOLE_TURN.slice(0, -4), prompts, true, ['[Image #6]'])
    expect(queueBox()).toHaveLength(1)
    expect(photoBubbles()).toHaveLength(1)
    again.unmount()
    unmount()
  })

  // The chat opens as Claude dequeues a message at the turn's end: its first
  // box read still lists the message, and the transcript already holds the
  // row Claude dequeued it as.
  it('draws a desk message dequeued at the turn end once when the chat first sees it in a box read older than its row', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:46:54.600'))
    const prompts = reader.read(dequeuedRun('05:46:54.400'))
    await showAt('05:46:54.700', [...WHOLE_TURN, DEQUEUED], prompts, true, [SECOND_SEND])
    await showAt('05:46:55.300', [...WHOLE_TURN, DEQUEUED], prompts, true, [])
    await showAt('05:47:21.000', [...WHOLE_TURN, DEQUEUED, ANSWER], prompts, true, [])
    expect(where(SECOND_SEND).at).toHaveLength(1)
    reader.unmount()
    unmount()
  })

  // Round 3 of the review of fix/midturn-gaps: a message the person typed
  // ending in an ellipsis (the Claude app's smart punctuation makes "..." a
  // "…") is not the box's cut of an earlier message it merely begins.
  for (const [earlier, later] of [
    ['wait, the build is still running on the old branch', 'wait…'],
    ['Hmm, the retry path never logs the second failure', 'Hmm…'],
    ['ok so the migration ran twice on staging last night', 'ok so…']
  ] as const) {
    it(`keeps "${earlier}" in the chat while "${later}" waits in the box`, async () => {
      agent = 'claude'
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(earlier, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts)
      await showAt('05:37:40.000', WHOLE_TURN.slice(0, -5), prompts)
      expect(where(earlier).at).toHaveLength(1)
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:39:30.000'))
      prompts = again.read(working(later, '05:39:29.000'))
      await showAt('05:39:30.100', WHOLE_TURN.slice(0, -4), prompts, true, [later])
      await showAt('05:39:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [later])
      expect(queueBox()).toEqual([later])
      expect(where(earlier).at).toHaveLength(1)
      again.unmount()
      unmount()
    })
  }

  // Round 3 of the review of fix/midturn-gaps: two long desk messages that
  // share their first 200 characters, so the tab status carries the same cut
  // copy of both and the reader makes one copy, the first's. The first is
  // taken at once and drawn; the second waits in the box minutes later.
  it('draws both of two long desk messages that share their first 200 characters, sent minutes apart, and after the chat comes back', async () => {
    agent = 'claude'
    const base = `${SECOND_SEND} issue, and also please check whether the session list on the account page still shows the ended sessions after a refresh`
    const one = `${base}, first on staging`
    const two = `${base}, then on production with the new flag`
    expect(normalizePromptField(one)).toBe(normalizePromptField(two))
    const users = () => drawn(frames.at(-1)!).filter((row) => row.role === 'user').map((row) => row.text)
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(one, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    await showAt('05:37:40.000', WHOLE_TURN.slice(0, -5), prompts)
    vi.setSystemTime(at('05:39:30.000'))
    prompts = reader.read(working(two, '05:39:29.000'))
    await showAt('05:39:30.100', WHOLE_TURN.slice(0, -4), prompts, true, [two])
    await showAt('05:39:31.000', WHOLE_TURN.slice(0, -4), prompts, true, [two])
    await showAt('05:40:00.000', WHOLE_TURN.slice(0, -3), prompts, true, [])
    expect(users()).toEqual([normalizePromptField(one), oneLine(two)])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:48:00.000'))
    prompts = again.read(done(two))
    await showAt('05:48:00.100', WHOLE_TURN, prompts, false)
    await showAt('05:48:01.000', WHOLE_TURN, prompts, false)
    expect(users()).toEqual([normalizePromptField(one), oneLine(two)])
    again.unmount()
    unmount()
  })

  // Round 4 of the review of fix/midturn-gaps: the copy the tab status cut and
  // the box's whole reading of one long message, stored minutes apart. While
  // the box lists the message its echo is held, so its copy is first stored,
  // or stored again, when Claude takes it.
  for (const when of ['in the same read as its status copy', 'a beat after its status copy'] as const) {
    it(`draws a long desk message the box listed ${when} once after Claude takes it minutes later, and after the chat comes back`, async () => {
      agent = 'claude'
      const long = `${SECOND_SEND} issue, and also please check whether the session list on the account page still shows the ended sessions after a refresh, first on staging`
      const drawnOf = () => drawn(frames.at(-1)!).filter((row) => row.role === 'user' && row.text.startsWith(oneLine(SECOND_SEND).slice(0, 60)))
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(long, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts, true, when === 'a beat after its status copy' ? [] : [long])
      await showAt('05:36:36.000', BEFORE_SECOND, prompts, true, [long])
      await showAt('05:37:30.000', BEFORE_SECOND, prompts, true, [long])
      // Taken mid-turn at 05:38:40.
      await showAt('05:38:41.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
      await showAt('05:38:45.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
      expect(drawnOf()).toHaveLength(1)
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      prompts = again.read(done(long))
      await showAt('05:48:00.100', WHOLE_TURN, prompts, false)
      await showAt('05:48:01.000', WHOLE_TURN, prompts, false)
      expect(drawnOf().map((row) => row.text)).toEqual([oneLine(long)])
      again.unmount()
      unmount()
    })
  }

  // Round 4 of the review of fix/midturn-gaps: a phone send that begins with
  // the first 200 characters of an earlier desk message is not that message.
  it('keeps a long desk message after the chat comes back when a later phone send begins with its first 200 characters', async () => {
    agent = 'claude'
    const base = `${SECOND_SEND} issue, and also please check whether the session list on the account page still shows the ended sessions after a refresh`
    const one = `${base}, first on staging`
    const two = `${base}, then on production with the new flag`
    const users = () => drawn(frames.at(-1)!).filter((row) => row.role === 'user').map((row) => row.text)
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(one, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    await showAt('05:37:40.000', WHOLE_TURN.slice(0, -5), prompts)
    vi.setSystemTime(at('05:39:10.000'))
    const origin = drafts()!.captureSendOrigin(two)!
    await act(async () => {
      drafts()!.acceptSend(origin, two, [], undefined)
    })
    await showAt('05:39:11.000', WHOLE_TURN.slice(0, -4), prompts, true, [two])
    await showAt('05:39:40.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
    await showAt('05:39:45.000', WHOLE_TURN.slice(0, -4), prompts, true, [])
    expect(users()).toEqual([normalizePromptField(one), oneLine(two)])
    reader.unmount()
    unmount()
    const again = statusReader()
    vi.setSystemTime(at('05:48:00.000'))
    prompts = again.read(done(two))
    await showAt('05:48:00.100', WHOLE_TURN, prompts, false)
    await showAt('05:48:01.000', WHOLE_TURN, prompts, false)
    expect(users()).toEqual([normalizePromptField(one), oneLine(two)])
    again.unmount()
    unmount()
  })
})
