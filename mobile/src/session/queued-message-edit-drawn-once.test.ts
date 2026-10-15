// "I tried to edit a queued job and it got duplicated" (0.9.150, 2026-10-15,
// a Claude Code tab working with 3 running tasks): after an edit the message
// was a sent user bubble in the chat AND entry 1 of the "Queued 1" box.
//
// Claude Code's transcript for that session (211c47c2, lines 9897-9916) says
// the agent had the message once the whole time: `enqueue` 07:06:06.543, the
// recall `popAll` 07:06:32.060, `enqueue` 07:06:38.098 as it was sent back,
// and one `remove` with reason `absorbed_mid_turn` 07:12:32.883. The phone's
// queue-box witness read the recall, where the entry leaves the box for the
// agent's input, as the agent taking it: it drew the message as sent and
// remembered it, and when the message was queued again the box drew it too
// (queue-recalls.ts).
//
// The screens are the real captures of fixtures/queued-tap-recall-2.1.296-0.153.4.ts
// (Claude Code 2.1.296 stock, Codex 0.153.4), read by the real queue reader
// with the `draft` Orca publishes beside them. Those were taken with tmux; a
// Claude screen reaches the phone through Orca, whose composer detector takes
// the input's words out of the rows and publishes them as `draft`, leaving a
// bare `❯` (claude-composer-screen.ts), so the Claude captures are given
// that shape (`throughOrca`). Two screens are derived and say so where they
// are built: the screen after the agent took the message (the recalled
// capture with its input emptied, as no take was captured), and a queue
// holding edited words (the queued capture with its queued row's words
// replaced).

import { describe, expect, it, vi } from 'vitest'
import { act } from 'react-test-renderer'
import { at, BEFORE_SECOND, working, statusReader, midturnChat } from './mobile-chat-midturn-prompt.test-support'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'
import { notePhoneQueueRecall } from './queue-recalls'
import {
  CLAUDE_2_1_296_VERSION,
  CLAUDE_ONE_QUEUED_2_1_296,
  CLAUDE_ONE_RECALLED_2_1_296,
  CLAUDE_QUEUED_TEXT,
  CLAUDE_TWO_QUEUED_2_1_296,
  CLAUDE_TWO_QUEUED_TEXTS,
  CLAUDE_TWO_RECALLED_2_1_296,
  CODEX_0_153_4_VERSION,
  CODEX_ONE_QUEUED_0_153_4,
  CODEX_ONE_RECALLED_0_153_4,
  CODEX_QUEUED_TEXT
} from './fixtures/queued-tap-recall-2.1.296-0.153.4'

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

const CLAUDE_RULE = '─'.repeat(100)
/** A Claude screen as Orca hands it over: the input row under the top rule is
 *  a bare `❯`, its wrapped rows gone, its words in `draft`. */
function throughOrca(lines: readonly string[]): string[] {
  const top = lines.findIndex((line, index) => line === CLAUDE_RULE && lines[index + 1]?.startsWith('❯'))
  if (top === -1) {
    return [...lines]
  }
  const bottom = lines.findIndex((line, index) => index > top && line === CLAUDE_RULE)
  return [...lines.slice(0, top + 1), '❯', ...lines.slice(bottom)]
}
/** Claude's empty input under a queue, as Orca publishes it: the placeholder. */
const CLAUDE_PLACEHOLDER = 'Press up to edit queued messages'
const EDITED = 'then also say goodbye in French and in German'

type Agent = 'claude' | 'codex'
type Screen = { lines: readonly string[]; draft: string }

/** Each agent's screens, as captured. */
const SCREENS: Record<Agent, { version: string; text: string; queued: Screen; recalled: Screen; taken: Screen; typing: Screen; queuedEdited: Screen }> = {
  claude: {
    version: CLAUDE_2_1_296_VERSION,
    text: CLAUDE_QUEUED_TEXT,
    queued: { lines: throughOrca(CLAUDE_ONE_QUEUED_2_1_296), draft: CLAUDE_PLACEHOLDER },
    recalled: { lines: throughOrca(CLAUDE_ONE_RECALLED_2_1_296), draft: CLAUDE_QUEUED_TEXT },
    // Derived: the recalled capture with its input emptied.
    taken: { lines: throughOrca(CLAUDE_ONE_RECALLED_2_1_296), draft: '' },
    // Derived: the same, with other words being typed at the desk.
    typing: { lines: throughOrca(CLAUDE_ONE_RECALLED_2_1_296), draft: 'wait, one more thing' },
    // Derived: the queued capture holding the edited words.
    queuedEdited: { lines: throughOrca(CLAUDE_ONE_QUEUED_2_1_296).map((line) => line.replace(CLAUDE_QUEUED_TEXT, EDITED)), draft: CLAUDE_PLACEHOLDER }
  },
  codex: {
    version: CODEX_0_153_4_VERSION,
    text: CODEX_QUEUED_TEXT,
    queued: { lines: CODEX_ONE_QUEUED_0_153_4, draft: '' },
    recalled: { lines: CODEX_ONE_RECALLED_0_153_4, draft: CODEX_QUEUED_TEXT },
    taken: { lines: CODEX_ONE_RECALLED_0_153_4.map((line) => (line === `› ${CODEX_QUEUED_TEXT}` ? '› Ask Codex to do anything' : line)), draft: '' },
    typing: { lines: CODEX_ONE_RECALLED_0_153_4.map((line) => (line === `› ${CODEX_QUEUED_TEXT}` ? '› wait, one more thing' : line)), draft: 'wait, one more thing' },
    queuedEdited: { lines: CODEX_ONE_QUEUED_0_153_4.map((line) => line.replace(CODEX_QUEUED_TEXT, EDITED)), draft: '' }
  }
}

describe('a queued message recalled for editing', () => {
  let agent: Agent = 'claude'
  const { showAt, queueBox, where, drafts } = midturnChat(frames, () => agent)

  /** The chat drawn over one screen read: the queue box and the agent's
   *  input as the real reader takes them off the screen. */
  async function readAt(clock: string, screen: Screen, prompts: ReturnType<ReturnType<typeof statusReader>['read']>) {
    const box = queueBoxReadFromScreen(screen.lines, agent, screen.draft)
    await showAt(clock, BEFORE_SECOND, prompts, true, box.entries, { queueReadable: box.readable, input: box.input })
  }
  async function sendFromPhone(clock: string, body: string): Promise<void> {
    vi.setSystemTime(at(clock))
    const origin = drafts()!.captureSendOrigin(body)!
    await act(async () => {
      drafts()!.acceptSend(origin, body, [])
    })
  }
  /** What the queue editor does with the phone's own send of the words it
   *  recalled (use-mobile-native-chat-queue-editor.ts). */
  async function editorTakesBack(body: string): Promise<void> {
    notePhoneQueueRecall([body])
    const own = drafts()!.pending.findLast(
      (item) => !item.images?.length && !item.id.startsWith('absorbed-') && !item.id.startsWith('desk-') && item.text.trim() === body.trim()
    )
    if (own) {
      await act(async () => {
        drafts()!.removePending(own.id)
      })
    }
  }

  for (const kind of ['claude', 'codex'] as const) {
    const { version, text, queued, recalled, taken, queuedEdited } = SCREENS[kind]

    it(`is not drawn as sent while it sits in the input, and is drawn once after it is sent again and taken, on ${version}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:35.000'))
      // Sent at the desk while the agent works: Orca's status copy, and the box.
      let prompts = reader.read(working(text, '05:36:34.891'))
      await readAt('05:36:35.100', queued, prompts)
      await readAt('05:36:36.000', queued, prompts)
      expect(queueBox()).toEqual([text])
      expect(where(text).at).toEqual([])
      // Tapped on the phone: the message is in the agent's input, out of the queue.
      await editorTakesBack(text)
      for (const clock of ['05:36:40.000', '05:36:41.000', '05:36:42.000']) {
        await readAt(clock, recalled, prompts)
        expect(queueBox()).toEqual([])
        expect(where(text).at).toEqual([])
      }
      // Sent again from the phone composer: queued once more.
      await sendFromPhone('05:36:45.000', text)
      vi.setSystemTime(at('05:36:45.200'))
      prompts = reader.read(working(text, '05:36:45.100'))
      await readAt('05:36:45.300', queued, prompts)
      await readAt('05:36:47.000', queued, prompts)
      expect(queueBox()).toEqual([text])
      expect(where(text).at).toEqual([])
      // The agent takes it mid-turn: one bubble, the box empty.
      await readAt('05:37:10.000', taken, prompts)
      await readAt('05:37:11.000', taken, prompts)
      expect(queueBox()).toEqual([])
      expect(where(text).at).toHaveLength(1)
      reader.unmount()
    })

    it(`draws only the edited words once after an edit saved from the sheet is taken, never the words it replaced, on ${version}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:35.000'))
      let prompts = reader.read(working(text, '05:36:34.891'))
      await readAt('05:36:35.100', queued, prompts)
      await readAt('05:36:36.000', queued, prompts)
      await editorTakesBack(text)
      await readAt('05:36:40.000', recalled, prompts)
      await readAt('05:36:41.000', recalled, prompts)
      expect(where(text).at).toEqual([])
      // Saved: the sheet typed the edited words into the input and queued them.
      vi.setSystemTime(at('05:36:50.000'))
      prompts = reader.read(working(EDITED, '05:36:49.900'))
      await readAt('05:36:50.100', queuedEdited, prompts)
      await readAt('05:36:51.000', queuedEdited, prompts)
      expect(queueBox()).toEqual([EDITED])
      expect(where(text).at).toEqual([])
      expect(where(EDITED).at).toEqual([])
      await readAt('05:37:10.000', taken, prompts)
      await readAt('05:37:11.000', taken, prompts)
      expect(queueBox()).toEqual([])
      expect(where(EDITED).at).toHaveLength(1)
      expect(where(text).at).toEqual([])
      reader.unmount()
    })

    it(`draws a message sent from the phone once after it is recalled, sent again and taken, on ${version}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:30.000'))
      let prompts = reader.read(working('an earlier message sent during the turn', '05:36:20.000'))
      await readAt('05:36:30.100', taken, prompts)
      await sendFromPhone('05:36:34.800', text)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(text, '05:36:34.891'))
      await readAt('05:36:35.100', queued, prompts)
      await readAt('05:36:36.000', queued, prompts)
      expect(queueBox()).toEqual([text])
      expect(where(text).at).toEqual([])
      await editorTakesBack(text)
      await readAt('05:36:40.000', recalled, prompts)
      await readAt('05:36:41.000', recalled, prompts)
      expect(queueBox()).toEqual([])
      expect(where(text).at).toEqual([])
      await sendFromPhone('05:36:45.000', text)
      vi.setSystemTime(at('05:36:45.200'))
      prompts = reader.read(working(text, '05:36:45.100'))
      await readAt('05:36:45.300', queued, prompts)
      await readAt('05:36:47.000', queued, prompts)
      expect(queueBox()).toEqual([text])
      expect(where(text).at).toEqual([])
      await readAt('05:37:10.000', taken, prompts)
      await readAt('05:37:11.000', taken, prompts)
      expect(queueBox()).toEqual([])
      expect(where(text).at).toHaveLength(1)
      reader.unmount()
    })

    // The failure side: what the new rule must not swallow.
    it(`still draws a queued message the agent took while other words were being typed at the desk, on ${version}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:35.000'))
      const prompts = reader.read(working(text, '05:36:34.891'))
      await readAt('05:36:35.100', queued, prompts)
      await readAt('05:36:36.000', queued, prompts)
      await readAt('05:37:10.000', SCREENS[kind].typing, prompts)
      await readAt('05:37:11.000', SCREENS[kind].typing, prompts)
      expect(queueBox()).toEqual([])
      expect(where(text).at).toHaveLength(1)
      reader.unmount()
    })

    it(`still draws a queued message the agent took after an edit was put back before any read saw it go, on ${version}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:35.000'))
      const prompts = reader.read(working(text, '05:36:34.891'))
      await readAt('05:36:35.100', queued, prompts)
      await readAt('05:36:36.000', queued, prompts)
      // Recalled and saved unchanged between two reads: the box never
      // showed it gone. What it lists is the message submitted again.
      await editorTakesBack(text)
      await readAt('05:36:40.000', queued, prompts)
      await readAt('05:36:41.000', queued, prompts)
      expect(queueBox()).toEqual([text])
      expect(where(text).at).toEqual([])
      await readAt('05:36:50.000', taken, prompts)
      await readAt('05:36:51.000', taken, prompts)
      expect(queueBox()).toEqual([])
      expect(where(text).at).toHaveLength(1)
      reader.unmount()
    })

    it(`keeps an earlier message of the same words drawn when a read asked for before the recall lands after it, on ${version}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:30:00.000'))
      let prompts = reader.read(working(text, '05:29:59.900'))
      await readAt('05:30:00.100', queued, prompts)
      await readAt('05:30:01.000', queued, prompts)
      // The agent took the first one.
      await readAt('05:31:00.000', taken, prompts)
      await readAt('05:31:01.000', taken, prompts)
      expect(where(text).at).toHaveLength(1)
      // The same words queued again, then tapped.
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(text, '05:36:34.891'))
      await readAt('05:36:35.100', queued, prompts)
      await readAt('05:36:36.000', queued, prompts)
      await editorTakesBack(text)
      // A read asked for before the recall, then the read that shows it.
      await readAt('05:36:37.000', queued, prompts)
      await readAt('05:36:38.000', recalled, prompts)
      await readAt('05:36:39.000', recalled, prompts)
      expect(queueBox()).toEqual([])
      expect(where(text).at).toHaveLength(1)
      reader.unmount()
    })

    it(`draws a message sent straight back from the composer once, though no read saw it leave the queue, on ${version}`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:36:35.000'))
      let prompts = reader.read(working(text, '05:36:34.891'))
      await readAt('05:36:35.100', queued, prompts)
      await readAt('05:36:36.000', queued, prompts)
      // Tapped, and sent again within the second before the next read.
      await editorTakesBack(text)
      await sendFromPhone('05:36:36.600', text)
      vi.setSystemTime(at('05:36:36.800'))
      prompts = reader.read(working(text, '05:36:36.700'))
      for (const clock of ['05:36:37.000', '05:36:38.000', '05:36:40.000', '05:36:41.000']) {
        await readAt(clock, queued, prompts)
        expect(queueBox()).toEqual([text])
        expect(where(text).at).toEqual([])
      }
      await readAt('05:37:10.000', taken, prompts)
      await readAt('05:37:11.000', taken, prompts)
      expect(queueBox()).toEqual([])
      expect(where(text).at).toHaveLength(1)
      reader.unmount()
    })
  }

  it(`draws neither of two queued messages while the stock Claude recall holds both in the input, on ${CLAUDE_2_1_296_VERSION}`, async () => {
    agent = 'claude'
    const [first, second] = CLAUDE_TWO_QUEUED_TEXTS
    const reader = statusReader()
    vi.setSystemTime(at('05:36:35.000'))
    const prompts = reader.read(working(second, '05:36:34.891'))
    const queuedBoth: Screen = { lines: throughOrca(CLAUDE_TWO_QUEUED_2_1_296), draft: CLAUDE_PLACEHOLDER }
    const recalledBoth: Screen = { lines: throughOrca(CLAUDE_TWO_RECALLED_2_1_296), draft: CLAUDE_TWO_QUEUED_TEXTS.join('\n') }
    await readAt('05:36:35.100', queuedBoth, prompts)
    await readAt('05:36:36.000', queuedBoth, prompts)
    expect(queueBox()).toEqual([first, second])
    await readAt('05:36:40.000', recalledBoth, prompts)
    await readAt('05:36:41.000', recalledBoth, prompts)
    expect(queueBox()).toEqual([])
    expect(where(first).at).toEqual([])
    expect(where(second).at).toEqual([])
    reader.unmount()
  })
})
