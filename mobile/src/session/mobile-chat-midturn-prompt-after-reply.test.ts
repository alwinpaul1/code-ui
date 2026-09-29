// Reported from the phone on 2026-09-29 with a screenshot, "Prompt leaking at
// the end": a Claude Code chat whose last reply ends "…Should I push them and
// open one PR? … session:ok", its Copy and scroll-up row under it, and under
// THAT a user bubble reading "Password changes now end only password sessions.
// … Whats this". The message was sent mid-turn at 05:36 and Claude answered it
// in that last reply ("You asked what the … line means"), so it belongs where
// it arrived, not under the answer as a new prompt.
//
// The session's own records, Claude Code 2.1.284 (1-based lines of the turn):
//     6 user, promptSource "typed", the prompt that opened the turn, 05:08:00.467
//   638 queue-operation enqueue, 05:36:01.523 ("…web session.\n\nWhats this issue")
//   642 queue-operation remove, reason `absorbed_mid_turn`, 05:36:02.185
//   643 attachment `queued_command`, origin human, stamped 05:36:01.523
//   661 queue-operation enqueue, 05:36:34.891 ("…web session.\n\nWhats this",
//       the same words less " issue")
//   665 queue-operation remove, reason `absorbed_mid_turn`, 05:37:31.338
//   666 attachment `queued_command`, stamped 05:36:34.891
//   748 assistant text, the last reply, 05:46:50.778
//   749 the first Stop hook's record, 05:46:51.005
// Orca's transcript reader keeps only `user` and `assistant` records, so the
// phone holds no row for either message; the tab status's `agentStatus.prompt`
// is its copy of them (agent-status-prompts.ts).
//
// Every clock that copy can be timed by puts it above the last reply: each
// working status that carried it was stamped by a hook at or before the last
// PostToolUse (05:46:41.308), and the `done` after it is placed by the run it
// came in, which began at 05:08. The bubble can only land under the reply when
// the status reader takes the message for a NEW prompt after the turn ended.
// It did that when a status carrying no prompt came between two that carried
// it: the reader forgot the text it had last read, took the next copy of the
// same message for a new submission, and timed it by the last status read
// before the reconnect, the turn's `done`, which is after the last reply.
// Two such statuses exist: a tab snapshot with no status at all (a relay
// re-dial or a re-hydrating tab list, which use-agent-status-prompts.ts
// already guards its reconnect latch against), and Orca's own stand-in when
// its hook row is stale or the terminal title is not the agent's
// (`buildRuntimeMobileAgentStatus` and the idle-title branch of
// runtime-mobile-session-projection.ts, origin/main 8d6fec597b): `done`,
// `prompt: ''`, `stateHistory: []`. On the build the phone ran, its log
// names the clock (`[desk-prompt] drawn: "Password changes now end…" (found
// on the first status since a reconnect or the cached tab list) placed from
// 2026-09-29T05:46:51.005Z, the last status read before it`), not which of
// the two came before it; both are pinned here. The line now also names the
// prompt the reader held when the copy came (agent-status-prompts.ts).
//
// The rows are the transcript's own records (uuid, role, time), a tail page of
// them as the chat holds one (its first read is 40 rows, so the prompt that
// opened the turn is on a page not loaded). Their words are placeholders. The
// statuses follow Orca's agent-status store, which pushes a history entry only
// on a state change, so a prompt taken mid-run leaves the state's start where
// it was; their stamps are the hook records' own times.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { landingHarness } from './mobile-chat-phone-photo-landing.test-support'
import { useAgentStatusPrompts } from './use-agent-status-prompts'

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

/** A session of its own for each case: the chat's echo anchors are kept by
 *  the copy's nonce, which names the session, for the life of the process. */
let SESSION = ''
let sessions = 0
beforeEach(() => {
  sessions += 1
  SESSION = `4f6c0f7e-2b1d-4c58-9a3e-${String(sessions).padStart(12, '0')}`
})
const at = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)

/** The two messages, as typed: the second is the first less its last word. */
const FIRST_SEND =
  'Password changes now end only password sessions. Next, setting up your own birth-date sign-in: it will now end your app sessions but keep your Google web session.\n\nWhats this issue'
const SECOND_SEND =
  'Password changes now end only password sessions. Next, setting up your own birth-date sign-in: it will now end your app sessions but keep your Google web session.\n\nWhats this'
/** Modeled: the prompt the pane carried before them (the last of the turn's
 *  earlier mid-turn messages, 05:30:40.761). */
const EARLIER = 'an earlier message sent during the turn'
const OPENING = 'the prompt that opened the turn'
/** Its row, line 6, 05:08:00.467: on a page the chat has not loaded. */
const OPENING_ROW = 'd01807a3-bea6-4f29-8a97-bc9a106d86ae'
const NEXT = 'Yes do it and open a pr'

const text = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: `words of ${id.slice(0, 8)}` }],
  timestamp: at(clock),
  source: 'transcript'
})
const call = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'tool-call', name: 'Bash', input: {} }],
  timestamp: at(clock),
  source: 'transcript'
})
const result = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'tool',
  blocks: [{ type: 'tool-result', output: '' }],
  timestamp: at(clock),
  source: 'transcript'
})
const user = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'user',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})

// The transcript's records from 05:34:51 on (lines 636–748), less the calls
// in the middle of the long run after 05:37:38, which change nothing here.
/** The words written before the second message was sent (its call, the last
 *  row before the send, folds into them), and the first written after Claude
 *  took it. */
const WRITTEN_BEFORE_SECOND = 'c87c6d3e-1a98-4946-a845-df1e58f12acc'
const WRITTEN_AFTER_SECOND = '99b501a9-d5cb-4092-a1f1-2aa6898f24e8'
const BEFORE_FIRST = [
  text('fed3dc95-5dba-4516-8d8d-4cebbbae8078', '05:34:51.297'),
  call('0465a647-17fa-40a0-b277-87f5fd3561b2', '05:34:55.802')
]
const AFTER_FIRST = [...BEFORE_FIRST, result('fb42a005-40bf-4394-9b6c-f75dbb436f95', '05:36:02.163')]
const BEFORE_SECOND = [
  ...AFTER_FIRST,
  text(WRITTEN_BEFORE_SECOND, '05:36:16.011'),
  call('c23a95c6-02db-4b9d-9c85-eb30b5d479ce', '05:36:25.066')
]
const LAST_REPLY = 'bfe5cd40-04d9-4340-8b3f-2b89bb2e4c62'
const WHOLE_TURN = [
  ...BEFORE_SECOND,
  result('b2fc1eee-5953-4f0f-8c7f-030e47884fd2', '05:37:31.307'),
  text(WRITTEN_AFTER_SECOND, '05:37:38.938'),
  call('60a7be7b-a870-40e0-ad3d-b3278fb1c02a', '05:39:23.150'),
  result('00899e40-73d4-4924-ad6a-fa4c04c98134', '05:46:20.617'),
  call('c221689d-cbea-4fdb-8df2-d1971b70cc45', '05:46:39.566'),
  result('2a7ab6a0-cf20-459c-8eca-bbcf60d7838c', '05:46:41.310'),
  text(LAST_REPLY, '05:46:50.778')
]
/** The next prompt, line 755, and its row. */
const NEXT_ROW = user('2ec552d7-b75d-42d1-bee8-d2ca8cdff524', NEXT, '05:49:46.995')

const WORKING_SINCE = at('05:08:00.600')
const TURN_ENDED = at('05:46:51.005')
const BEFORE_TURN = [{ state: 'done', prompt: 'the turn before', startedAt: at('05:07:00.700') }]

/** The pane as Orca's store holds it while the turn runs, carrying `prompt`
 *  (folded to one line, as Orca's hook puts it on the status). */
function working(prompt: string, stamped: string): NonNullable<AgentStatusPromptSource> {
  return {
    state: 'working',
    prompt: normalizePromptField(prompt),
    updatedAt: at(stamped),
    stateStartedAt: WORKING_SINCE,
    stateHistory: BEFORE_TURN,
    providerSession: { id: SESSION }
  }
}
/** The pane after the Stop hook: the run pushed to the history with the
 *  prompt it ended carrying, which Orca keeps on the `done`. */
function done(prompt: string, stamped = '05:46:51.005'): NonNullable<AgentStatusPromptSource> {
  return {
    state: 'done',
    prompt: normalizePromptField(prompt),
    updatedAt: at(stamped),
    stateStartedAt: TURN_ENDED,
    stateHistory: [...BEFORE_TURN, { state: 'working', prompt: normalizePromptField(prompt), startedAt: WORKING_SINCE }],
    providerSession: { id: SESSION }
  }
}
/** Orca's stand-in for a status whose hook row it will not use (stale, or a
 *  terminal title that is not the agent's): identity only, no prompt. */
function standIn(stamped: string): NonNullable<AgentStatusPromptSource> {
  return {
    state: 'done',
    prompt: '',
    updatedAt: at(stamped),
    stateStartedAt: at(stamped),
    stateHistory: [],
    providerSession: { id: SESSION }
  }
}

/** The chat's status reader (use-agent-status-prompts.ts) as the controller
 *  mounts it: the tab's status, whether the link is up, and whether the tab
 *  list is the host's (live) or still the one the last visit cached. */
function statusReader() {
  let renderer: ReactTestRenderer | null = null
  let prompts: DesktopPrompt[] = []
  function Reader({ status, connected, live, shown }: { status: AgentStatusPromptSource; connected: boolean; live: boolean; shown: boolean }) {
    // The controller hands the reader no session while the tab shows its
    // terminal (use-mobile-native-chat-controller.ts).
    prompts = useAgentStatusPrompts(shown ? SESSION : null, status, undefined, connected, live).prompts
    return null
  }
  return {
    read(
      status: AgentStatusPromptSource,
      { connected = true, live = true, shown = true }: { connected?: boolean; live?: boolean; shown?: boolean } = {}
    ): DesktopPrompt[] {
      act(() => {
        const element = createElement(Reader, { status, connected, live, shown })
        if (renderer) {
          renderer.update(element)
        } else {
          renderer = create(element)
        }
      })
      return [...prompts]
    },
    unmount(): void {
      act(() => renderer?.unmount())
      renderer = null
    }
  }
}

function drawn(props: Record<string, unknown>): { id: string; role: string; text: string }[] {
  const { data } = buildMobileNativeChatTransientData({
    messages: props.messages as NativeChatMessage[],
    folded: props.folded as NativeChatMessage[],
    streaming: null,
    pending: props.pending as never,
    imagePreviewsByMessageId: props.imagePreviewsByMessageId as Record<string, string[]>
  })
  return data.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  }))
}
const oneLine = (body: string) => body.replace(/\s+/g, ' ').trim()

describe('a message sent mid-turn, after the reply that answered it', () => {
  const { show, unmount } = landingHarness(frames)
  let agent: 'claude' | 'codex' = 'claude'
  /** The chat drawn at this time of the day of the report. */
  async function showAt(clock: string, messages: NativeChatMessage[], prompts: DesktopPrompt[], working = true): Promise<void> {
    const delta = at(clock) - Date.now()
    if (delta > 0) {
      await act(async () => {
        vi.advanceTimersByTime(delta)
      })
    }
    // Twice: the witness memory settles on the render after it stores.
    await show('00:00:00.000', { messages, working, prompts, hasMore: true, agent })
    await show('00:00:00.000', { messages, working, prompts, hasMore: true, agent })
  }
  function where(body: string): { at: number[]; reply: number; after: (index: number) => string | undefined } {
    const rows = drawn(frames.at(-1)!)
    return {
      at: rows.flatMap((row, index) => (row.role === 'user' && row.text === oneLine(body) ? [index] : [])),
      reply: rows.findIndex((row) => row.id === LAST_REPLY),
      after: (index) => rows[index - 1]?.id
    }
  }
  /** The chat open through the turn: the earlier message on the status, the
   *  two sends watched arriving, and the turn's end. */
  async function watchTheTurn(reader: ReturnType<typeof statusReader>): Promise<DesktopPrompt[]> {
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    // The UserPromptSubmit of each send, at its enqueue.
    vi.setSystemTime(at('05:36:01.700'))
    prompts = reader.read(working(FIRST_SEND, '05:36:01.523'))
    await showAt('05:36:01.800', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    vi.setSystemTime(at('05:46:41.500'))
    prompts = reader.read(working(SECOND_SEND, '05:46:41.308'))
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    vi.setSystemTime(at('05:46:51.100'))
    prompts = reader.read(done(SECOND_SEND))
    await showAt('05:46:51.200', WHOLE_TURN, prompts, false)
    return prompts
  }
  /** Each message drawn once, between the words written before it was sent
   *  and the words written after Claude took it, and above the reply. */
  function expectSentWhereItArrived(): void {
    const rows = drawn(frames.at(-1)!)
    const row = (id: string) => rows.findIndex((drawnRow) => drawnRow.id === id)
    const first = where(FIRST_SEND)
    const second = where(SECOND_SEND)
    expect(first.at).toHaveLength(1)
    expect(second.at).toHaveLength(1)
    expect(first.after(first.at[0]!)).toBe(BEFORE_FIRST[0]!.id)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(second.at[0]!).toBeLessThan(row(WRITTEN_AFTER_SECOND))
    expect(second.at[0]!).toBeLessThan(second.reply)
  }

  for (const kind of ['claude', 'codex'] as const) {
    describe(`on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, () => {
      it('stays where it was sent, once, when a reconnect after the turn comes back through a tab snapshot with no status', async () => {
        agent = kind
        const reader = statusReader()
        await watchTheTurn(reader)
        expectSentWhereItArrived()
        // The relay drops and re-dials; the tab list comes back before the
        // tab's status does.
        vi.setSystemTime(at('05:47:30.000'))
        reader.read(done(SECOND_SEND), { connected: false })
        reader.read(null, { connected: false })
        reader.read(null)
        const prompts = reader.read(done(SECOND_SEND))
        await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
        expectSentWhereItArrived()
        reader.unmount()
        unmount()
      })

      it('stays where it was sent, once, when Orca stands in a status with no prompt after the turn and a reconnect brings the real one back', async () => {
        agent = kind
        const reader = statusReader()
        await watchTheTurn(reader)
        vi.setSystemTime(at('05:47:10.000'))
        let prompts = reader.read(standIn('05:47:09.000'))
        await showAt('05:47:10.100', WHOLE_TURN, prompts, false)
        vi.setSystemTime(at('05:47:30.000'))
        reader.read(standIn('05:47:09.000'), { connected: false })
        reader.read(standIn('05:47:09.000'))
        prompts = reader.read(done(SECOND_SEND))
        await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
        expectSentWhereItArrived()
        reader.unmount()
        unmount()
      })
    })
  }

  it('is not drawn a second time when the status carries no prompt for a moment mid-turn', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:01.700'))
    prompts = reader.read(working(FIRST_SEND, '05:36:01.523'))
    await showAt('05:36:01.800', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    // A tab snapshot with no status, then the next tool ping (line 664).
    vi.setSystemTime(at('05:37:31.400'))
    reader.read(null)
    prompts = reader.read(working(SECOND_SEND, '05:37:31.306'))
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    expectSentWhereItArrived()
    reader.unmount()
    unmount()
  })

  // What the reader must still do: a message it never read, taken while the
  // link was down, is drawn after the last status it read before the drop.
  // Here that status is the earlier message's, so the message is drawn above
  // the reply, not under it; a status with no prompt read between says
  // nothing about the message and does not move it down.
  it('draws a message it never read, taken while the link was down, above the reply when a status with no prompt came between', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    // Orca's stand-in through the rest of the turn, then the drop.
    vi.setSystemTime(at('05:47:10.000'))
    prompts = reader.read(standIn('05:47:09.000'))
    await showAt('05:47:10.100', WHOLE_TURN, prompts, false)
    reader.read(standIn('05:47:09.000'), { connected: false })
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(standIn('05:47:09.000'))
    prompts = reader.read(done(SECOND_SEND))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.at[0]!).toBeLessThan(second.reply)
    reader.unmount()
    unmount()
  })

  // Review of 257768bc: the reconnect latch is left to any status that is not
  // null, as before. Held through statuses with no prompt, it took a message
  // the chat watched arrive long after the reconnect for one found there: on
  // a Claude lead whose cached prompt is empty (after startup, resume or
  // clear, with its run started by a teammate's message, which keeps the
  // cached prompt), Orca's genuine hook rows carry `prompt: ''`, and the
  // message was timed by the run's start and never drawn.
  it('draws a message watched arriving after a reconnect through hook rows with no prompt where it was sent', async () => {
    agent = 'claude'
    const reader = statusReader()
    const noPrompt = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
      ...working('', stamped),
      prompt: '',
      stateHistory: [{ state: 'done', prompt: '', startedAt: at('05:07:00.700') }]
    })
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(noPrompt('05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    reader.read(noPrompt('05:34:55.850'), { connected: false })
    vi.setSystemTime(at('05:36:03.000'))
    reader.read(noPrompt('05:34:55.850'))
    prompts = reader.read(noPrompt('05:36:02.200'))
    await showAt('05:36:30.000', BEFORE_SECOND, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read({ ...noPrompt('05:36:34.891'), prompt: normalizePromptField(SECOND_SEND) })
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    const rows = drawn(frames.at(-1)!)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
    reader.unmount()
    unmount()
  })

  // The same with Orca's stand-in first on the way back, rows written while
  // the link was down, and the message sent after the reconnect. A message
  // taken WHILE the link was down, with the stand-in first on the way back,
  // reaches the reader in the same shape and is timed by its ping, below
  // the words written after it; the reader cannot tell the two apart, and
  // this one is the case the latch is not for.
  for (const kind of ['claude', 'codex'] as const) {
    it(`draws a message sent after a reconnect whose first status was Orca's stand-in below the rows written during the drop, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const reader = statusReader()
      vi.setSystemTime(at('05:35:00.000'))
      let prompts = reader.read(working(EARLIER, '05:34:55.850'))
      await showAt('05:35:00.100', BEFORE_FIRST, prompts)
      reader.read(working(EARLIER, '05:34:55.850'), { connected: false })
      vi.setSystemTime(at('05:36:28.000'))
      reader.read(working(EARLIER, '05:34:55.850'))
      prompts = reader.read({ ...standIn('05:36:26.000'), state: 'working' })
      await showAt('05:36:28.100', BEFORE_SECOND, prompts)
      vi.setSystemTime(at('05:36:35.000'))
      prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
      await showAt('05:36:35.100', BEFORE_SECOND, prompts)
      await showAt('05:46:50.900', WHOLE_TURN, prompts)
      const rows = drawn(frames.at(-1)!)
      const second = where(SECOND_SEND)
      expect(second.at).toHaveLength(1)
      expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
      expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
      reader.unmount()
      unmount()
    })
  }

  // Round-2 review of this branch: a hook row that carries no prompt, on a
  // pane whose cached prompt is empty, is a real reading (the message's
  // UserPromptSubmit would have put it on the next row). A message taken
  // while the link was down came after the last such row, and 257768bc's
  // `readAt` left it bounded by nothing but its run's start, 05:08, on a page
  // the chat has not loaded: never drawn. Only null and Orca's stand-in, with
  // no history of its own, are no reading.
  it('draws a message taken while the link was down, on hook rows with no prompt, after the rows watched before the drop', async () => {
    agent = 'claude'
    const reader = statusReader()
    const noPrompt = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
      ...working('', stamped),
      prompt: '',
      stateHistory: [{ state: 'done', prompt: '', startedAt: at('05:07:00.700') }]
    })
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(noPrompt('05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:03.000'))
    prompts = reader.read(noPrompt('05:36:02.200'))
    await showAt('05:36:03.100', AFTER_FIRST, prompts)
    vi.setSystemTime(at('05:36:26.000'))
    prompts = reader.read(noPrompt('05:36:25.100'))
    await showAt('05:36:26.100', BEFORE_SECOND, prompts)
    reader.read(noPrompt('05:36:25.100'), { connected: false })
    vi.setSystemTime(at('05:37:40.000'))
    reader.read(noPrompt('05:36:25.100'))
    prompts = reader.read({ ...noPrompt('05:37:31.306'), prompt: normalizePromptField(SECOND_SEND) })
    await showAt('05:37:40.100', WHOLE_TURN.filter((row) => row.timestamp! <= at('05:37:38.938')), prompts)
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    const rows = drawn(frames.at(-1)!)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
    reader.unmount()
    unmount()
  })

  // Gap C (final review of fix/midturn-prompt-at-end): Orca's stand-in as the
  // chat's first status used up the chat's first read, so the message the
  // host's next status carried, taken before the chat opened, was read as one
  // the chat watched arrive and timed by that status's ping: drawn under the
  // words written after it. A chat opened straight on that status finds it and
  // places it by the run it came in; so must this one, on both agents' tabs.
  for (const kind of ['claude', 'codex'] as const) {
    it(`draws a message taken before the chat opened where it would without Orca's stand-in first, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const opened = [user(OPENING_ROW, OPENING, '05:08:00.467'), ...WHOLE_TURN.filter((row) => row.timestamp! <= at('05:39:23.200'))]
      const onTheMessage = statusReader()
      vi.setSystemTime(at('05:40:00.000'))
      const straight = onTheMessage.read(working(SECOND_SEND, '05:39:23.200'))
      onTheMessage.unmount()
      const reader = statusReader()
      reader.read({ ...standIn('05:39:30.000'), state: 'working' })
      const prompts = reader.read(working(SECOND_SEND, '05:39:23.200'))
      expect(prompts.map((prompt) => prompt.at)).toEqual(straight.map((prompt) => prompt.at))
      await showAt('05:40:00.100', opened, prompts)
      const rows = drawn(frames.at(-1)!)
      const second = where(SECOND_SEND)
      expect(second.at).toHaveLength(1)
      expect(second.after(second.at[0]!)).toBe(OPENING_ROW)
      expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
      reader.unmount()
      unmount()
    })
  }

  // Gap B of the final review of fix/midturn-prompt-at-end: after the chat
  // remounts (a relaunch, a tab switch back), the first status finds the last
  // message and times it by its run's start, 05:08, on a page the chat has not
  // loaded, so that copy is not drawn; and the message's stored bubble, which
  // the phone drew where it arrived, gave way to it. Nothing was drawn.
  for (const kind of ['claude', 'codex'] as const) {
    it(`keeps a mid-turn message where it was drawn after the chat remounts, on a ${kind === 'claude' ? 'Claude Code' : 'Codex'} tab`, async () => {
      agent = kind
      const reader = statusReader()
      await watchTheTurn(reader)
      expectSentWhereItArrived()
      reader.unmount()
      unmount()
      const again = statusReader()
      vi.setSystemTime(at('05:48:00.000'))
      const prompts = again.read(done(SECOND_SEND))
      await showAt('05:48:00.100', WHOLE_TURN, prompts, false)
      await showAt('05:48:01.000', WHOLE_TURN, prompts, false)
      expectSentWhereItArrived()
      again.unmount()
      unmount()
    })
  }

  // Degenerate: a turn with no mid-turn message. The status carries the
  // prompt that opened it, whose row is on a page the chat has not loaded.
  it('draws nothing under the reply of a turn that had no mid-turn message', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:46:41.500'))
    let prompts = reader.read(working(OPENING, '05:46:41.308'))
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    vi.setSystemTime(at('05:46:51.100'))
    prompts = reader.read(done(OPENING))
    await showAt('05:46:51.200', WHOLE_TURN, prompts, false)
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(done(OPENING), { connected: false })
    reader.read(null)
    prompts = reader.read(done(OPENING))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    const rows = drawn(frames.at(-1)!)
    expect(rows.filter((row) => row.role === 'user')).toEqual([])
    reader.unmount()
    unmount()
  })

  // Degenerate: the message is the only user row the chat holds, and it was
  // sent twice with the same words, so the status never changed between them.
  it('draws a message sent twice with the same words once, where it was first sent', async () => {
    agent = 'claude'
    const reader = statusReader()
    vi.setSystemTime(at('05:35:00.000'))
    let prompts = reader.read(working(EARLIER, '05:34:55.850'))
    await showAt('05:35:00.100', BEFORE_FIRST, prompts)
    vi.setSystemTime(at('05:36:35.000'))
    prompts = reader.read(working(SECOND_SEND, '05:36:34.891'))
    await showAt('05:36:35.100', BEFORE_SECOND, prompts)
    vi.setSystemTime(at('05:37:31.400'))
    prompts = reader.read(working(SECOND_SEND, '05:37:31.306'))
    await showAt('05:46:50.900', WHOLE_TURN, prompts)
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(done(SECOND_SEND), { connected: false })
    reader.read(null)
    prompts = reader.read(done(SECOND_SEND))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    reader.unmount()
    unmount()
  })

  // The two messages differ only by the first's last word, and each is a
  // message of its own. The chat keeps what it drew of them in its witness
  // memory, which is all it draws from once its reader starts over and the
  // status carries only the second (the tab's terminal looked at, then the
  // chat again). That memory took the first for the second with the screen's
  // rows glued on, and kept only the second.
  it('keeps both of two messages that differ by a last word, each where it was sent, after the terminal is looked at', async () => {
    agent = 'claude'
    const reader = statusReader()
    await watchTheTurn(reader)
    expectSentWhereItArrived()
    vi.setSystemTime(at('05:47:30.000'))
    reader.read(done(SECOND_SEND), { shown: false })
    const prompts = reader.read(done(SECOND_SEND))
    await showAt('05:47:31.000', WHOLE_TURN, prompts, false)
    expectSentWhereItArrived()
    reader.unmount()
    unmount()
  })

  // The same message by the other copy the phone can hold, the prompt hook's
  // beacon (agent-hud-launch-args.ts; Claude Code only, a Codex tab's beacon
  // carries no prompt). The beacon names the row the message was typed after
  // (`at=`), and the hook skips every record with `"tool_use"` in it. Claude
  // Code 2.1.284 writes each text record of a turn that goes on to a tool
  // with `"stop_reason":"tool_use"`, so a message sent mid-turn names the
  // last row of a finished turn: here the prompt that opened this one (line
  // 6), on a page the chat has not loaded. The copy waits for that row, drawn
  // meanwhile where it was first seen. use-desktop-prompt-echoes.ts alone
  // settles it on the tail of its 30th reading, which with the phone asleep
  // through the turn is the last reply; the chat keeps it where it was first
  // seen because the witness memory stores that place and draws it instead.
  // This passed before the fixes above and pins that it still does.
  it('keeps a beaconed mid-turn message where it was first seen when the row it names never loads', async () => {
    agent = 'claude'
    vi.setSystemTime(at('05:36:35.000'))
    const beaconed: DesktopPrompt = { nonce: '48213', text: SECOND_SEND, anchorId: OPENING_ROW, seenAt: at('05:36:35.000') }
    await showAt('05:36:35.100', BEFORE_SECOND, [beaconed])
    // The phone wakes after the turn with every row in, and the chat is read
    // again on every beat.
    for (let beat = 0; beat < 20; beat += 1) {
      await showAt(`05:47:${String(10 + beat).padStart(2, '0')}.000`, WHOLE_TURN, [beaconed], false)
    }
    const rows = drawn(frames.at(-1)!)
    const second = where(SECOND_SEND)
    expect(second.at).toHaveLength(1)
    expect(second.after(second.at[0]!)).toBe(WRITTEN_BEFORE_SECOND)
    expect(second.at[0]!).toBeLessThan(rows.findIndex((row) => row.id === WRITTEN_AFTER_SECOND))
    unmount()
  })

  // The next prompt starts a turn and lands as a row; its status copy is
  // drawn until the row comes and never again after, blink or not.
  it('draws the next prompt once, before its row lands and after, across a status with no prompt', async () => {
    agent = 'claude'
    const reader = statusReader()
    await watchTheTurn(reader)
    // The new run: the turn and its end pushed to the history.
    const nextRun = (stamped: string): NonNullable<AgentStatusPromptSource> => ({
      ...working(NEXT, stamped),
      stateStartedAt: at('05:49:47.000'),
      stateHistory: [...done(SECOND_SEND).stateHistory!, { state: 'done', prompt: normalizePromptField(SECOND_SEND), startedAt: TURN_ENDED }]
    })
    vi.setSystemTime(at('05:49:47.100'))
    let prompts = reader.read(nextRun('05:49:47.000'))
    await showAt('05:49:47.200', WHOLE_TURN, prompts)
    expect(where(NEXT).at).toHaveLength(1)
    expect(where(NEXT).at[0]!).toBeGreaterThan(where(NEXT).reply)
    reader.read(null)
    prompts = reader.read(nextRun('05:49:50.000'))
    await showAt('05:49:50.100', [...WHOLE_TURN, NEXT_ROW], prompts)
    expect(where(NEXT).at).toHaveLength(1)
    expectSentWhereItArrived()
    reader.unmount()
    unmount()
  })
})
