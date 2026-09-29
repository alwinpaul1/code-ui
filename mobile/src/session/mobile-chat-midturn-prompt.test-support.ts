// The report of 2026-09-29, "Prompt leaking at the end", as the chat's
// tests replay it: the transcript's own records, the tab statuses Orca
// stored, and the chat drawn at each time of that day. The story is at the
// top of mobile-chat-midturn-prompt-after-reply.test.ts. A test file that
// uses it mocks the chat view into `frames` itself (vi.mock is per file).
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { beforeEach, expect, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizePromptField } from '../../../src/shared/agent-status-field-normalization'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { AgentStatusPromptSource } from './agent-status-prompts'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { landingHarness } from './mobile-chat-phone-photo-landing.test-support'
import { useAgentStatusPrompts } from './use-agent-status-prompts'

/** A session of its own for each case: the chat's echo anchors are kept by
 *  the copy's nonce, which names the session, for the life of the process. */
let SESSION = ''
let sessions = 0
beforeEach(() => {
  sessions += 1
  SESSION = `4f6c0f7e-2b1d-4c58-9a3e-${String(sessions).padStart(12, '0')}`
})
export const at = (clock: string) => Date.parse(`2026-09-29T${clock}Z`)

/** The two messages, as typed: the second is the first less its last word. */
export const FIRST_SEND =
  'Password changes now end only password sessions. Next, setting up your own birth-date sign-in: it will now end your app sessions but keep your Google web session.\n\nWhats this issue'
export const SECOND_SEND =
  'Password changes now end only password sessions. Next, setting up your own birth-date sign-in: it will now end your app sessions but keep your Google web session.\n\nWhats this'
/** Modeled: the prompt the pane carried before them (the last of the turn's
 *  earlier mid-turn messages, 05:30:40.761). */
export const EARLIER = 'an earlier message sent during the turn'
export const OPENING = 'the prompt that opened the turn'
/** Its row, line 6, 05:08:00.467: on a page the chat has not loaded. */
export const OPENING_ROW = 'd01807a3-bea6-4f29-8a97-bc9a106d86ae'
export const NEXT = 'Yes do it and open a pr'

export const text = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: `words of ${id.slice(0, 8)}` }],
  timestamp: at(clock),
  source: 'transcript'
})
export const call = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'tool-call', name: 'Bash', input: {} }],
  timestamp: at(clock),
  source: 'transcript'
})
export const result = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'tool',
  blocks: [{ type: 'tool-result', output: '' }],
  timestamp: at(clock),
  source: 'transcript'
})
export const user = (id: string, body: string, clock: string): NativeChatMessage => ({
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
export const WRITTEN_BEFORE_SECOND = 'c87c6d3e-1a98-4946-a845-df1e58f12acc'
export const WRITTEN_AFTER_SECOND = '99b501a9-d5cb-4092-a1f1-2aa6898f24e8'
export const BEFORE_FIRST = [
  text('fed3dc95-5dba-4516-8d8d-4cebbbae8078', '05:34:51.297'),
  call('0465a647-17fa-40a0-b277-87f5fd3561b2', '05:34:55.802')
]
export const AFTER_FIRST = [...BEFORE_FIRST, result('fb42a005-40bf-4394-9b6c-f75dbb436f95', '05:36:02.163')]
export const BEFORE_SECOND = [
  ...AFTER_FIRST,
  text(WRITTEN_BEFORE_SECOND, '05:36:16.011'),
  call('c23a95c6-02db-4b9d-9c85-eb30b5d479ce', '05:36:25.066')
]
export const LAST_REPLY = 'bfe5cd40-04d9-4340-8b3f-2b89bb2e4c62'
export const WHOLE_TURN = [
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
export const NEXT_ROW = user('2ec552d7-b75d-42d1-bee8-d2ca8cdff524', NEXT, '05:49:46.995')

export const WORKING_SINCE = at('05:08:00.600')
export const TURN_ENDED = at('05:46:51.005')
export const BEFORE_TURN = [{ state: 'done', prompt: 'the turn before', startedAt: at('05:07:00.700') }]

/** The pane as Orca's store holds it while the turn runs, carrying `prompt`
 *  (folded to one line, as Orca's hook puts it on the status). */
export function working(prompt: string, stamped: string): NonNullable<AgentStatusPromptSource> {
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
export function done(prompt: string, stamped = '05:46:51.005'): NonNullable<AgentStatusPromptSource> {
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
export function standIn(stamped: string): NonNullable<AgentStatusPromptSource> {
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
export function statusReader() {
  let renderer: ReactTestRenderer | null = null
  const last = { prompts: [] as DesktopPrompt[] }
  function Reader({
    status,
    connected,
    live,
    shown,
    beacon
  }: {
    status: AgentStatusPromptSource
    connected: boolean
    live: boolean
    shown: boolean
    beacon: readonly DesktopPrompt[] | undefined
  }) {
    // The controller hands the reader no session while the tab shows its
    // terminal (use-mobile-native-chat-controller.ts).
    last.prompts = useAgentStatusPrompts(shown ? SESSION : null, status, beacon, connected, live).prompts
    return null
  }
  return {
    read(
      status: AgentStatusPromptSource,
      {
        connected = true,
        live = true,
        shown = true,
        beacon
      }: {
        connected?: boolean
        live?: boolean
        shown?: boolean
        /** The prompt hook's copies the terminal's beacon carried so far
         *  (the controller's `hudBeacon.desktopPrompts`), oldest first. */
        beacon?: readonly DesktopPrompt[]
      } = {}
    ): DesktopPrompt[] {
      act(() => {
        const element = createElement(Reader, { status, connected, live, shown, beacon })
        if (renderer) {
          renderer.update(element)
        } else {
          renderer = create(element)
        }
      })
      return [...last.prompts]
    },
    unmount(): void {
      act(() => renderer?.unmount())
      renderer = null
    }
  }
}

export function drawn(props: Record<string, unknown>): { id: string; role: string; text: string }[] {
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
export const oneLine = (body: string) => body.replace(/\s+/g, ' ').trim()

/** The prompt hook's copy of a submission as the beacon store holds it
 *  (agent-hud-beacon.ts): the hook's pid for a nonce, the words as typed (cut
 *  at 2,000 bytes, which no fixture here reaches), the text row it was typed
 *  after (`at=`), and when the phone received it. */
export function beaconCopy(nonce: string, words: string, anchorId: string, received: string): DesktopPrompt {
  return { nonce, text: words, cut: false, anchorId, seenAt: at(received) }
}

/** The chat as the report's tests draw it, into `frames`, on the agent
 *  `agent()` names. Call it inside a describe: it hooks each case. */
export function midturnChat(frames: Record<string, unknown>[], agent: () => 'claude' | 'codex') {
  const { show, unmount, drafts } = landingHarness(frames)
  /** The chat drawn at this time of the day of the report. */
  async function showAt(
    clock: string,
    messages: NativeChatMessage[],
    prompts: DesktopPrompt[],
    working = true,
    /** The rows the agent's queue box lists, as the screen reader took them. */
    queued: string[] = [],
    /** Whether the tab was launched with the prompt hook (`hk=1` on its
     *  beacon), so every prompt it took while the phone listened was beaconed. */
    { promptHook }: { promptHook?: boolean } = {}
  ): Promise<void> {
    const delta = at(clock) - Date.now()
    if (delta > 0) {
      await act(async () => {
        vi.advanceTimersByTime(delta)
      })
    }
    // Twice: the witness memory settles on the render after it stores.
    await show('00:00:00.000', { messages, working, prompts, hasMore: true, agent: agent(), queued, promptHook })
    await show('00:00:00.000', { messages, working, prompts, hasMore: true, agent: agent(), queued, promptHook })
  }
  /** The rows the chat's queue box draws, as their words. */
  function queueBox(): string[] {
    const entries = (frames.at(-1)!.queuedMessages ?? []) as (string | { text: string })[]
    return entries.map((entry) => oneLine(typeof entry === 'string' ? entry : entry.text))
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
  return { unmount, drafts, showAt, queueBox, where, watchTheTurn, expectSentWhereItArrived }
}
