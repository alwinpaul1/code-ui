import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import { isTakenSend, type MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import { EMPTY_AGENT_STATUS_PROMPTS, observeAgentStatusPrompt } from './agent-status-prompts'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'

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
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return { MobileNativeChatView: (props: Record<string, unknown>) => h('ChatView', props) }
})

// Reported from the phone on 2026-09-25 against Claude Code 2.1.282, session
// da53d612 (1-based transcript lines). The phone sent a message while a long
// Bash call ran. Claude Code recorded it as:
//   3321 queue-operation enqueue            17:04:15.102 (the text, typed into the terminal)
//   3324 user tool_result (7600ea97)         17:04:46.455
//   3322 queue-operation remove, reason absorbed_mid_turn, 17:04:46.473
//   3326 attachment queued_command, origin.kind "human", humanTurn true
// and NO `user` row carries it. Orca's reader drops the attachment, so no
// transcript row will ever claim the phone's bubble. The turn went on and
// ended at 17:08:21.8 (3422 end_turn, 3425 turn_duration).
//
// Not this build's only shape: a prompt still queued when a turn ENDS is
// dequeued as an ordinary `user` row with `promptSource: "queued"`. On this
// machine, across Claude Code 2.1.205 to 2.1.282, 1,998 human prompts were
// written only as a queued_command and 378 as a queued user row; on 2.1.280
// to 2.1.282 alone, 65 and 16. Claude Code 2.1.283 (installed 2026-09-25
// 23:55) writes both the same way by its binary's strings: the same
// `messageQueue.consume(…, {reason: "absorbed_mid_turn"})` absorption, the same
// queued_command writer, and the same `inputSource ?? "queued"` promptSource
// for a dequeued prompt. No 2.1.283 transcript existed yet to read.
//
// Texts are neutral stand-ins; ids, times and record kinds are the real ones.
const SESSION = 'da53d612-5f7e-4aff-b8e8-1818049ba8f1'
const TEXT = 'check the menu on the right side of the screen'
const at = (clock: string) => Date.parse(`2026-09-25T${clock}Z`)
const text = (id: string, body: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: body }],
  timestamp: at(clock),
  source: 'transcript'
})
const call = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'sleep 30' } }],
  timestamp: at(clock),
  source: 'transcript'
})
const result = (id: string, clock: string): NativeChatMessage => ({
  id,
  role: 'tool',
  blocks: [{ type: 'tool-result', output: 'ok' }],
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

// What the phone held when the send left it, then the turn going on.
const beforeSend = [
  text('fa161a56', 'Pushed. Waiting for the deploy…', '17:03:30.106'),
  call('ddf36abe', '17:03:33.195')
]
const afterTake = [...beforeSend, result('7600ea97', '17:04:46.455')]
const turnGoesOn = [
  ...afterTake,
  call('19e57746', '17:05:45.068'),
  result('4a54473f', '17:05:45.244'),
  text('398d2cdc', 'The menu opens from the right edge.', '17:06:22.182'),
  call('bc308741', '17:07:16.637'),
  result('40990170', '17:08:17.311')
]
const turnEnded = [...turnGoesOn, text('cf22b103', 'Fixed: the menu opens from the left now.', '17:08:21.651')]

/** Claude Code's queue block above its spinner, as 2.1.281 paints it
 *  (transcribed from the phone's terminal view 2026-09-24; the fixture pinned
 *  in mobile-terminal-queued-messages.test.ts), holding the given rows. No
 *  2.1.282 screen was captured with this report. */
function claudeScreen(queued: readonly string[]): string[] {
  return [
    '● Running 1 shell command · 14s…',
    "  ⎿  $ python3 - <<'EOF'",
    '     (ctrl+b to run in background)',
    '',
    ...queued.map((row) => `❯ ${row}`),
    ...(queued.length ? ['  ctrl+x ctrl+s to send now'] : []),
    '',
    '✻ Incubating… (31m 27s · ↓ 67.8k tokens)',
    '  ⎿  Tip: Use /clear to start fresh when switching topics and free up context',
    '',
    '────────────────────────────────────────────────────────────────────────────────',
    `❯ ${queued.length ? 'Press up to edit queued messages' : ''}`,
    '────────────────────────────────────────────────────────────────────────────────'
  ]
}
const claudeBox = (queued: readonly string[]) => queuedMessagesFromScreen(claudeScreen(queued))

/** Codex's pending-input preview (openai/codex, bottom_pane/pending_input_preview.rs). */
const codexBox = (queued: readonly string[]) =>
  codexQueuedMessagesFromScreen([
    '• Queued follow-up inputs',
    ...queued.map((row) => `  ↳ ${row}`),
    '    alt + ↑ edit last queued message',
    '› '
  ])

/** Orca's hook copy of a submission, read off the tab status. */
function hookCopy(clock: string, body = TEXT): DesktopPrompt[] {
  let state = EMPTY_AGENT_STATUS_PROMPTS
  state = observeAgentStatusPrompt(state, SESSION, { prompt: '', updatedAt: at(clock) })
  state = observeAgentStatusPrompt(state, SESSION, { prompt: body, updatedAt: at(clock) })
  return [...state.prompts]
}

type Tick = {
  messages: NativeChatMessage[]
  working?: boolean
  prompts?: DesktopPrompt[]
  queued?: string[]
  agent?: 'claude' | 'codex'
  /** The transcript read has not settled: the chat was opened, or re-read,
   *  and the rows have not arrived yet. */
  loading?: boolean
}

type Drafts = ReturnType<typeof useMobileNativeChatDrafts>

describe('a message the phone sent while the agent worked, taken mid-turn', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: Drafts | null = null
  let current: Tick = { messages: beforeSend }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(at('17:04:10.000'))
  })
  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    drafts = null
    vi.useRealTimers()
    await clearNativeChatDraftStores()
  })

  /** The real draft store and its witness memory, feeding the real overlay. */
  function Route({ tick }: { tick: Tick }) {
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: SESSION,
      messages: tick.messages,
      transcriptLoading: tick.loading ?? false,
      transcriptSettled: !tick.loading
    })
    const controller = {
      showNativeChat: true,
      activeChatEligible: true,
      viewResolved: true,
      terminalPeekActive: false,
      nativeChatSession: {
        messages: tick.messages,
        status: tick.loading ? 'loading' : 'ready',
        transcriptLoading: tick.loading ?? false
      },
      nativeChatAgent: tick.agent ?? 'claude',
      nativeChatStructured: false,
      nativeChatAgentWorking: tick.working ?? true,
      nativeChatStreamLive: tick.working ?? true,
      nativeChatStreamScopeKey: `tab:${SESSION}`,
      nativeChatSpinner: null,
      chatPending: drafts.pending,
      rememberEcho: drafts.rememberEcho,
      takeOwnSends: drafts.takeSends,
      nativeChatDesktopPrompts: tick.prompts,
      nativeChatQueuedMessages: tick.queued,
      chatImagePreviewsByMessageId: {},
      chatComposerText: '',
      setChatComposerText: vi.fn()
    } as unknown as MobileNativeChatController
    return createElement(MobileNativeChatOverlay, {
      controller,
      hasTerminalUnderneath: true,
      hostAllowsRewind: true,
      images: {} as never,
      onMicPress: vi.fn(),
      micActive: false,
      dictationMode: 'toggle',
      onMicPressIn: vi.fn(),
      onMicPressOut: vi.fn(),
      inputLockReason: null,
      sendErrorMessage: null,
      onClearSendError: vi.fn(),
      sendSurfaceId: 'tab',
      getSendCompletionGeneration: () => 0,
      keyboardInset: 0,
      onOpenFile: vi.fn()
    })
  }

  async function clockTo(clock: string): Promise<void> {
    const delta = at(clock) - Date.now()
    if (delta > 0) {
      await act(async () => {
        vi.advanceTimersByTime(delta)
      })
    }
  }

  async function show(clock: string, tick: Tick): Promise<void> {
    await clockTo(clock)
    current = tick
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Route, { tick }))
      } else {
        renderer = create(createElement(Route, { tick }))
      }
    })
    // Let the store's effects, and stored echoes read back, settle.
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  /** The chat route goes away and comes back: a tab switch, or the app
   *  brought back after Android let it go. The stored echoes are all it keeps. */
  async function remount(clock: string, tick: Tick): Promise<void> {
    act(() => renderer?.unmount())
    renderer = null
    await show(clock, tick)
  }

  async function tap(clock: string, body = TEXT): Promise<MobileNativeChatSendOrigin> {
    await clockTo(clock)
    return drafts!.captureSendOrigin(body)!
  }

  async function ack(clock: string, origin: MobileNativeChatSendOrigin, body = TEXT): Promise<void> {
    await clockTo(clock)
    await act(async () => {
      drafts!.acceptSend(origin, body)
    })
    await show(clock, current)
  }

  /** The conversation as drawn, top to bottom: agent rows by id, the phone's
   *  own bubbles as `phone`, a transcript user row as `row`, the hook's copy
   *  as `hook`, anything else pending by its id. */
  function drawn(): string[] {
    const view = renderer!.root.findAll((node) => String(node.type) === 'ChatView')[0]!
    const props = view.props
    const ids = new Set((props.pending as { id: string }[]).map((item) => item.id))
    const { data } = buildMobileNativeChatTransientData({
      messages: props.messages,
      folded: props.folded,
      streaming: null,
      pending: props.pending
    })
    return data.map((message) => {
      if (!ids.has(message.id)) {
        return message.role === 'user' ? 'row' : message.id
      }
      if (message.id.startsWith('pending-')) {
        return 'phone'
      }
      return message.id.startsWith('desk-') ? 'hook' : message.id
    })
  }

  /** Claude takes the phone's message out of its queue box mid-turn, then
   *  works on and ends the turn, as in the report. */
  async function sendAndLetClaudeTakeIt(extra: Partial<Tick> = {}): Promise<void> {
    // `extra` from the tap on: the hook copy cannot exist before the Enter.
    await show('17:04:10.000', { messages: beforeSend })
    const origin = await tap('17:04:15.000')
    await ack('17:04:15.300', origin)
    await show('17:04:16.000', { messages: beforeSend, queued: claudeBox([TEXT]), ...extra })
    await show('17:04:47.000', { messages: afterTake, queued: claudeBox([]), ...extra })
    await show('17:06:30.000', { messages: turnGoesOn, queued: [], ...extra })
    await show('17:08:22.500', { messages: turnEnded, queued: [], working: false, ...extra })
  }

  it('keeps it where it was sent, above the rest of the turn, once Claude takes it and the turn ends', async () => {
    await sendAndLetClaudeTakeIt()
    expect(drawn()).toEqual(['fa161a56', 'phone', '19e57746', '398d2cdc', 'cf22b103'])
  })

  it('draws a message sent while the chat was still loading where it was sent, not under the reply that ended the turn', async () => {
    // The chat is open and its transcript read has not come back: over a
    // re-dialling relay that can take the rest of the turn.
    await show('17:04:10.000', { messages: [], loading: true })
    const origin = await tap('17:04:15.000')
    await ack('17:04:15.300', origin)
    await show('17:04:16.000', { messages: [], loading: true, queued: claudeBox([TEXT]) })
    await show('17:04:47.000', { messages: [], loading: true, queued: claudeBox([]) })
    // The read settles only after the turn ended.
    await show('17:08:40.000', { messages: turnEnded, queued: [], working: false })
    await show('17:08:41.000', { messages: turnEnded, queued: [], working: false })
    expect(drawn()).toEqual(['fa161a56', 'phone', '19e57746', '398d2cdc', 'cf22b103'])
  })

  it('stops waiting for a row only once the box lets the message go, never while it waits there or for a send made idle', async () => {
    await show('17:04:10.000', { messages: beforeSend })
    await ack('17:04:15.300', await tap('17:04:15.000'))
    await show('17:04:16.000', { messages: beforeSend, queued: claudeBox([TEXT]) })
    await show('17:04:30.000', { messages: beforeSend, queued: claudeBox([TEXT]) })
    expect(drafts!.pending.map(isTakenSend)).toEqual([false])
    await show('17:04:47.000', { messages: afterTake, queued: claudeBox([]) })
    expect(drafts!.pending.map(isTakenSend)).toEqual([true])
    await show('17:08:22.500', { messages: turnEnded, queued: [], working: false })
    await ack('17:09:00.300', await tap('17:09:00.000', 'something new'), 'something new')
    await show('17:09:00.500', { messages: turnEnded, queued: [] })
    expect(drafts!.pending.map(isTakenSend)).toEqual([true, false])
  })

  it('shows a second send of the same text once, and keeps the first where Claude took it', async () => {
    await sendAndLetClaudeTakeIt()
    // Sent again while Claude is idle: this one starts a turn and lands as a row.
    const again = await tap('17:09:00.000')
    await ack('17:09:00.300', again)
    const landed = [...turnEnded, user('b1c2d3e4', TEXT, '17:09:00.180')]
    await show('17:09:01.000', { messages: landed, queued: [] })
    await show('17:09:02.000', { messages: landed, queued: [] })
    expect(drawn()).toEqual(['fa161a56', 'phone', '19e57746', '398d2cdc', 'cf22b103', 'row'])
  })

  it('keeps two identical messages Claude took as two, and draws a third send of it once', async () => {
    await show('17:04:10.000', { messages: beforeSend })
    await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
    await ack('17:04:20.300', await tap('17:04:20.000', 'yes'), 'yes')
    await show('17:04:21.000', { messages: beforeSend, queued: claudeBox(['yes', 'yes']) })
    await show('17:04:47.000', { messages: afterTake, queued: claudeBox([]) })
    await show('17:08:22.500', { messages: turnEnded, queued: [], working: false })
    await ack('17:09:00.300', await tap('17:09:00.000', 'yes'), 'yes')
    const landed = [...turnEnded, user('b1c2d3e4', 'yes', '17:09:00.180')]
    await show('17:09:01.000', { messages: landed, queued: [] })
    expect(drawn()).toEqual(['fa161a56', 'phone', 'phone', '19e57746', '398d2cdc', 'cf22b103', 'row'])
  })

  // The 378 prompts that were still queued when a turn ended: Claude dequeues
  // them as a `user` row with `promptSource: "queued"`. The box can empty a
  // read before that row reaches the phone, or after.
  it.each([
    ['the box empties before the row arrives', true],
    ['the row arrives first', false]
  ])('still draws a message Claude wrote as a queued user row once, when %s', async (_label, boxFirst) => {
    await show('17:04:10.000', { messages: beforeSend })
    await ack('17:04:15.300', await tap('17:04:15.000'))
    await show('17:04:16.000', { messages: turnGoesOn, queued: claudeBox([TEXT]) })
    await show('17:08:21.900', { messages: turnEnded, queued: claudeBox([TEXT]) })
    const dequeued = [...turnEnded, user('0741e6f2', TEXT, '17:08:22.050')]
    if (boxFirst) {
      await show('17:08:22.300', { messages: turnEnded, queued: claudeBox([]) })
      await show('17:08:30.000', { messages: turnEnded, queued: [] })
    }
    await show('17:08:31.000', { messages: dequeued, queued: [] })
    await show('17:08:32.000', { messages: dequeued, queued: [] })
    // No bubble breaks the tool fold any more, so the calls fold back again.
    expect(drawn()).toEqual(['fa161a56', '398d2cdc', 'cf22b103', 'row'])
    expect(drafts!.pending).toEqual([])
  })

  it('draws it once, where it was sent, when the chat comes back after the turn and first sees the hook copy then', async () => {
    const atEnter = hookCopy('17:04:15.110')
    await sendAndLetClaudeTakeIt({ prompts: atEnter })
    expect(drawn()).toEqual(['fa161a56', 'phone', '19e57746', '398d2cdc', 'cf22b103'])
    // Back after the turn: the tab status is read afresh, and a prompt first
    // seen then is timed by the pane's current state, which began at the end.
    // The stored echoes come back a moment after the first render, and the
    // hook's copy was remembered in that moment as someone else's message.
    const firstSight = [
      ...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
        prompt: TEXT,
        updatedAt: at('17:08:21.900'),
        stateStartedAt: at('17:08:21.800')
      }).prompts
    ]
    await remount('17:10:00.000', { messages: turnEnded, queued: [], working: false, prompts: firstSight })
    await show('17:10:01.000', { messages: turnEnded, queued: [], working: false, prompts: firstSight })
    expect(drawn()).toEqual(['fa161a56', 'phone', '19e57746', '398d2cdc', 'cf22b103'])
  })

  // Codex writes a queued follow-up as a user row when it submits it, at the
  // end of the turn, so the bubble stands only until then; it stands where it
  // was sent all the same.
  it('draws a Codex follow-up sent while the chat was loading where it was sent, until its row lands', async () => {
    const codexTurn = [
      text('msg_0ddffecfe356', 'Running the deploy check.', '17:03:30.106'),
      call('ctc_0ddffecfe357', '17:03:33.195')
    ]
    const codexEnded = [
      ...codexTurn,
      result('ctco_01a07666289b', '17:04:46.455'),
      text('msg_0ddffecfe358', 'Deploy is green.', '17:08:21.651')
    ]
    await show('17:04:10.000', { messages: [], loading: true, agent: 'codex' })
    await ack('17:04:15.300', await tap('17:04:15.000'))
    await show('17:04:16.000', { messages: [], loading: true, agent: 'codex', queued: codexBox([TEXT]) })
    // Codex submits the follow-up as the turn ends; the read settles then.
    await show('17:08:22.000', { messages: codexEnded, agent: 'codex', queued: codexBox([]) })
    expect(drawn()).toEqual(['msg_0ddffecfe356', 'phone', 'msg_0ddffecfe358'])
    const landed = [...codexEnded, user('01a07666-28b6-77a3', TEXT, '17:08:22.100')]
    await show('17:08:23.000', { messages: landed, agent: 'codex', queued: [] })
    expect(drawn()).toEqual(['msg_0ddffecfe356', 'msg_0ddffecfe358', 'row'])
    expect(drafts!.pending).toEqual([])
  })

  it('keeps it where it was sent after the chat comes back, and still shows a later send of the same text once', async () => {
    await sendAndLetClaudeTakeIt()
    await remount('17:10:00.000', { messages: turnEnded, queued: [], working: false })
    await ack('17:10:30.300', await tap('17:10:30.000'))
    const landed = [...turnEnded, user('b1c2d3e4', TEXT, '17:10:30.180')]
    await show('17:10:31.000', { messages: landed, queued: [], working: false })
    expect(drawn()).toEqual(['fa161a56', 'phone', '19e57746', '398d2cdc', 'cf22b103', 'row'])
  })

  // Codex writes every input as a transcript record, a queued follow-up at the
  // end of the turn and a steer when it is injected (Codex CLI 0.153.4 rollouts
  // on this machine: `response_item` message role "user" and `event_msg`
  // item_completed UserMessage, which Orca's reader turns into a user row).
  // So its box letting a message go is followed by the row, never by nothing.
  describe('on Codex, whose inputs always land as rows', () => {
    const codexTurn = [
      text('msg_0ddffecfe356', 'Running the deploy check.', '17:03:30.106'),
      call('ctc_0ddffecfe357', '17:03:33.195')
    ]
    const codexEnded = [
      ...codexTurn,
      result('ctco_01a07666289b', '17:04:46.455'),
      text('msg_0ddffecfe358', 'Deploy is green.', '17:08:21.651')
    ]

    it('draws a follow-up once, as its row, after the queue box lets it go', async () => {
      await show('17:04:10.000', { messages: codexTurn, agent: 'codex' })
      await ack('17:04:15.300', await tap('17:04:15.000'))
      await show('17:04:16.000', { messages: codexTurn, agent: 'codex', queued: codexBox([TEXT]) })
      await show('17:08:22.000', { messages: codexEnded, agent: 'codex', queued: codexBox([]) })
      const landed = [...codexEnded, user('01a07666-28b6-77a3', TEXT, '17:08:22.100')]
      await show('17:08:23.000', { messages: landed, agent: 'codex', queued: [] })
      await show('17:08:24.000', { messages: landed, agent: 'codex', queued: [] })
      expect(drawn()).toEqual(['msg_0ddffecfe356', 'msg_0ddffecfe358', 'row'])
      expect(drafts!.pending).toEqual([])
    })

    it('draws two follow-ups of the same text once each as their rows land', async () => {
      await show('17:04:10.000', { messages: codexTurn, agent: 'codex' })
      await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
      await ack('17:04:20.300', await tap('17:04:20.000', 'yes'), 'yes')
      await show('17:04:21.000', { messages: codexTurn, agent: 'codex', queued: codexBox(['yes', 'yes']) })
      await show('17:08:22.000', { messages: codexEnded, agent: 'codex', queued: codexBox([]) })
      const first = [...codexEnded, user('01a07666-28b6-0001', 'yes', '17:08:22.100')]
      await show('17:08:23.000', { messages: first, agent: 'codex', queued: [] })
      const both = [...first, text('msg_0ddffecfe359', 'Done.', '17:08:40.000'), user('01a07666-28b6-0002', 'yes', '17:08:41.000')]
      await show('17:08:42.000', { messages: both, agent: 'codex', queued: [] })
      await show('17:08:43.000', { messages: both, agent: 'codex', queued: [] })
      expect(drawn()).toEqual(['msg_0ddffecfe356', 'msg_0ddffecfe358', 'row', 'msg_0ddffecfe359', 'row'])
      expect(drafts!.pending).toEqual([])
    })
  })

  // A second review (2026-09-25) drove these through the same harness. Each
  // drew a message twice, or not at all, on the first version of the take.
  describe('found in review', () => {
    it('draws two identical sends once each when a relay drop blanked the box before both rows landed', async () => {
      await show('17:04:10.000', { messages: beforeSend })
      await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
      await show('17:04:16.000', { messages: beforeSend, queued: claudeBox(['yes']) })
      // The relay is down: the controller hands the chat no queue at all.
      await show('17:04:20.000', { messages: beforeSend, queued: [] })
      await show('17:04:30.000', { messages: beforeSend, queued: claudeBox(['yes']) })
      await ack('17:05:00.300', await tap('17:05:00.000', 'yes'), 'yes')
      await show('17:05:01.000', { messages: afterTake, queued: claudeBox(['yes', 'yes']) })
      const dequeued = [...turnEnded, user('0741e6f2', 'yes', '17:08:22.050'), user('0741e6f3', 'yes', '17:08:22.060')]
      await show('17:08:22.300', { messages: dequeued, queued: claudeBox(['yes', 'yes']) })
      await show('17:08:23.000', { messages: dequeued, queued: claudeBox([]) })
      await show('17:08:24.000', { messages: dequeued, queued: [] })
      expect(drawn()).toEqual(['fa161a56', '398d2cdc', 'cf22b103', 'row', 'row'])
      expect(drafts!.pending).toEqual([])
    })

    it('draws a send Claude dequeued at the end of the turn once, when its text was sent again before its row arrived', async () => {
      await show('17:04:10.000', { messages: beforeSend })
      await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
      await show('17:04:16.000', { messages: turnGoesOn, queued: claudeBox(['yes']) })
      await show('17:08:22.300', { messages: turnEnded, queued: claudeBox([]) })
      await ack('17:08:23.300', await tap('17:08:23.000', 'yes'), 'yes')
      await show('17:08:24.000', { messages: turnEnded, queued: claudeBox(['yes']) })
      const firstRow = [...turnEnded, user('0741e6f2', 'yes', '17:08:22.050')]
      await show('17:08:25.000', { messages: firstRow, queued: claudeBox(['yes']) })
      const reply = [...firstRow, text('aa000001', 'ok', '17:08:30.000')]
      await show('17:08:40.500', { messages: reply, queued: claudeBox([]) })
      const secondRow = [...reply, user('0741e6f3', 'yes', '17:08:40.060')]
      await show('17:08:41.000', { messages: secondRow, queued: [] })
      await show('17:08:42.000', { messages: secondRow, queued: [] })
      expect(drawn()).toEqual(['fa161a56', '398d2cdc', 'cf22b103', 'row', 'aa000001', 'row'])
      expect(drafts!.pending).toEqual([])
    })

    it('still draws a message typed at the desk in a later turn that repeats a stored phone send, when the chat comes back', async () => {
      await sendAndLetClaudeTakeIt({ prompts: hookCopy('17:04:15.110') })
      act(() => renderer?.unmount())
      renderer = null
      // A later turn, started from the desk; then the same text typed there
      // mid-turn, taken with no row, and first seen when the chat comes back.
      const secondTurn = [
        ...turnEnded,
        user('d0000001', 'now run the tests', '17:11:00.000'),
        call('d0000002', '17:11:05.000'),
        result('d0000003', '17:12:30.000'),
        text('d0000004', 'All tests pass.', '17:13:00.000')
      ]
      const firstSight = [
        ...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
          prompt: TEXT,
          updatedAt: at('17:13:00.100'),
          stateStartedAt: at('17:13:00.050')
        }).prompts
      ]
      await show('17:14:00.000', { messages: secondTurn, queued: [], working: false, prompts: firstSight })
      await show('17:14:01.000', { messages: secondTurn, queued: [], working: false, prompts: firstSight })
      expect(drawn().filter((entry) => entry === 'phone' || entry === 'hook')).toEqual(['phone', 'hook'])
    })

    // Second round of the same review.
    it('draws a send Claude dequeued at the end of the turn once, and a resend of its text Claude then took mid-turn once too', async () => {
      await show('17:04:10.000', { messages: beforeSend })
      await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
      await show('17:04:16.000', { messages: turnGoesOn, queued: claudeBox(['yes']) })
      await show('17:08:22.300', { messages: turnEnded, queued: claudeBox([]) })
      await ack('17:08:23.300', await tap('17:08:23.000', 'yes'), 'yes')
      await show('17:08:24.000', { messages: turnEnded, queued: claudeBox(['yes']) })
      // The first one's queued row, stamped before the resend left the phone.
      const firstRow = [...turnEnded, user('0741e6f2', 'yes', '17:08:22.050'), call('0741e6f4', '17:08:23.500')]
      await show('17:08:25.000', { messages: firstRow, queued: claudeBox(['yes']) })
      // Claude takes the resend at the next tool result: no row, the box empties.
      const absorbed = [...firstRow, result('0741e6f5', '17:08:40.000'), text('0741e6f6', 'Done with both.', '17:09:00.000')]
      await show('17:08:41.000', { messages: absorbed.slice(0, -1), queued: claudeBox([]) })
      await show('17:09:01.000', { messages: absorbed, queued: [], working: false })
      await show('17:09:02.000', { messages: absorbed, queued: [], working: false })
      // The first as its row, the resend as its bubble where it was sent: after
      // the rows the phone held then, which did not yet include that row.
      expect(drawn()).toEqual(['fa161a56', '398d2cdc', 'cf22b103', 'phone', 'row', '0741e6f4', '0741e6f6'])
    })

    it('draws a message typed at the desk in a later turn once the rows that show that turn load, after the chat came back', async () => {
      await sendAndLetClaudeTakeIt({ prompts: hookCopy('17:04:15.110') })
      act(() => renderer?.unmount())
      renderer = null
      const secondTurn = [
        ...turnEnded,
        user('d0000011', 'now run the tests', '17:11:00.000'),
        call('d0000012', '17:11:05.000'),
        result('d0000013', '17:12:30.000'),
        text('d0000014', 'All tests pass.', '17:13:10.000')
      ]
      const firstSight = [
        ...observeAgentStatusPrompt(EMPTY_AGENT_STATUS_PROMPTS, SESSION, {
          prompt: TEXT,
          updatedAt: at('17:13:10.100'),
          stateStartedAt: at('17:13:10.050')
        }).prompts
      ]
      // Back while the read is still in flight, over the rows kept from before.
      await show('17:14:00.000', { messages: turnEnded, loading: true, queued: [], working: false, prompts: firstSight })
      await show('17:14:01.000', { messages: turnEnded, loading: true, queued: [], working: false, prompts: firstSight })
      await show('17:14:05.000', { messages: secondTurn, queued: [], working: false, prompts: firstSight })
      await show('17:14:06.000', { messages: secondTurn, queued: [], working: false, prompts: firstSight })
      expect(drawn().filter((entry) => entry === 'phone' || entry === 'hook')).toEqual(['phone', 'hook'])
    })

    // Third round of the same review.
    it('draws a dequeued send and a resend of its text once each even when the resend went out a moment after the row was stamped', async () => {
      await show('17:04:10.000', { messages: beforeSend })
      await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
      await show('17:04:16.000', { messages: turnGoesOn, queued: claudeBox(['yes']) })
      await show('17:08:22.300', { messages: turnEnded, queued: claudeBox([]) })
      await ack('17:08:23.300', await tap('17:08:23.000', 'yes'), 'yes')
      await show('17:08:24.000', { messages: turnEnded, queued: claudeBox(['yes']) })
      // Stamped 0.3 s before the resend left the phone.
      const firstRow = [...turnEnded, user('0741e6f2', 'yes', '17:08:22.700'), call('0741e6f4', '17:08:23.500')]
      await show('17:08:25.000', { messages: firstRow, queued: claudeBox(['yes']) })
      const absorbed = [...firstRow, result('0741e6f5', '17:08:40.000'), text('0741e6f6', 'Done with both.', '17:09:00.000')]
      await show('17:08:41.000', { messages: absorbed.slice(0, -1), queued: claudeBox([]) })
      await show('17:09:01.000', { messages: absorbed, queued: [], working: false })
      await show('17:09:02.000', { messages: absorbed, queued: [], working: false })
      expect(drawn()).toEqual(['fa161a56', '398d2cdc', 'cf22b103', 'phone', 'row', '0741e6f4', '0741e6f6'])
    })

    it('shows a second send of the same text once on a phone whose clock runs two seconds ahead', async () => {
      await sendAndLetClaudeTakeIt()
      // Sent at 17:09:02 by the phone's clock, 17:09:00 by the desktop's.
      await ack('17:09:02.300', await tap('17:09:02.000'))
      const landed = [...turnEnded, user('b1c2d3e4', TEXT, '17:09:00.500')]
      await show('17:09:03.000', { messages: landed, queued: [] })
      await show('17:09:04.000', { messages: landed, queued: [] })
      expect(drawn()).toEqual(['fa161a56', 'phone', '19e57746', '398d2cdc', 'cf22b103', 'row'])
    })

    it('still hides the hook copy of a send when another prompt started a turn while the send was on its way', async () => {
      await show('17:08:30.000', { messages: turnEnded, working: false })
      const origin = await tap('17:09:00.000')
      const deskTurn = [...turnEnded, user('x0000001', 'run the migration', '17:09:01.500'), call('x0000002', '17:09:02.000')]
      let state = EMPTY_AGENT_STATUS_PROMPTS
      state = observeAgentStatusPrompt(state, SESSION, { prompt: '', updatedAt: at('17:08:30.000') })
      state = observeAgentStatusPrompt(state, SESSION, { prompt: 'run the migration', updatedAt: at('17:09:01.500') })
      await show('17:09:02.000', { messages: deskTurn, prompts: [...state.prompts] })
      state = observeAgentStatusPrompt(state, SESSION, { prompt: TEXT, updatedAt: at('17:09:03.000') })
      await ack('17:09:03.200', origin)
      await show('17:09:03.500', { messages: deskTurn, queued: claudeBox([TEXT]), prompts: [...state.prompts] })
      const absorbed = [...deskTurn, result('x0000003', '17:09:30.000'), text('x0000004', 'Migrated.', '17:10:00.000')]
      await show('17:09:31.000', { messages: absorbed.slice(0, -1), queued: claudeBox([]), prompts: [...state.prompts] })
      await show('17:10:01.000', { messages: absorbed, working: false, queued: [], prompts: [...state.prompts] })
      expect(drawn().filter((entry) => entry === 'phone' || entry === 'hook')).toEqual(['phone'])
    })

    it('keeps a message typed at the desk when the chat went away before its stored echoes were read back', async () => {
      const read = AsyncStorage.getItem.bind(AsyncStorage)
      const slow = vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
        if (key.startsWith('orca:chatPendingEchoes:')) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
        return read(key)
      })
      const deskCopy = hookCopy('17:05:00.000', 'typed at the desk')
      await show('17:05:00.500', { messages: afterTake, queued: [], prompts: deskCopy })
      await show('17:05:02.000', { messages: afterTake, queued: [], prompts: deskCopy })
      act(() => renderer?.unmount())
      renderer = null
      await clockTo('17:05:10.000')
      slow.mockRestore()
      // Back after the status moved on: the stored echoes are all it has.
      await show('17:06:00.000', { messages: afterTake, queued: [], prompts: [] })
      await show('17:06:01.000', { messages: afterTake, queued: [], prompts: [] })
      expect(drawn()).toContain('hook')
    })

    // Fourth round of the same review.
    it('draws a dequeued send and a resend of its text once each after a relay drop had emptied the box earlier in the turn', async () => {
      await show('17:04:10.000', { messages: beforeSend })
      await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
      await show('17:04:16.000', { messages: turnGoesOn, queued: claudeBox(['yes']) })
      // The relay drops: the controller hands the chat no queue, then the box is back.
      await show('17:04:20.000', { messages: turnGoesOn, queued: [] })
      await show('17:04:30.000', { messages: turnGoesOn, queued: claudeBox(['yes']) })
      await show('17:08:21.900', { messages: turnEnded, queued: claudeBox(['yes']) })
      await show('17:08:22.300', { messages: turnEnded, queued: claudeBox([]) })
      await ack('17:08:23.300', await tap('17:08:23.000', 'yes'), 'yes')
      await show('17:08:24.000', { messages: turnEnded, queued: claudeBox(['yes']) })
      const firstRow = [...turnEnded, user('0741e6f2', 'yes', '17:08:22.050'), call('0741e6f4', '17:08:23.500')]
      await show('17:08:25.000', { messages: firstRow, queued: claudeBox(['yes']) })
      const absorbed = [...firstRow, result('0741e6f5', '17:08:40.000'), text('0741e6f6', 'Done with both.', '17:09:00.000')]
      await show('17:08:41.000', { messages: absorbed.slice(0, -1), queued: claudeBox([]) })
      await show('17:09:01.000', { messages: absorbed, queued: [], working: false })
      await show('17:09:02.000', { messages: absorbed, queued: [], working: false })
      expect(drawn()).toEqual(['fa161a56', '398d2cdc', 'cf22b103', 'phone', 'row', '0741e6f4', '0741e6f6'])
      expect(drafts!.pending.map((item) => item.sentAt)).toEqual([at('17:08:23.000')])
    })

    it('keeps a message Claude took mid-turn when the same text had landed as a row a few seconds before it was sent', async () => {
      await show('17:04:15.000', { messages: beforeSend, working: false })
      await ack('17:04:20.300', await tap('17:04:20.000', 'yes'), 'yes')
      const idleRow = [...beforeSend, user('e0000001', 'yes', '17:04:20.200')]
      await show('17:04:21.000', { messages: idleRow, working: true })
      await ack('17:04:23.300', await tap('17:04:23.000', 'yes'), 'yes')
      await show('17:04:24.000', { messages: idleRow, queued: claudeBox(['yes']) })
      // Taken 8 s after the first one's row was stamped, inside a 10 s window.
      const taken = [...idleRow, call('e0000002', '17:04:27.000')]
      await show('17:04:28.000', { messages: taken, queued: claudeBox([]) })
      const ended = [...taken, result('e0000003', '17:04:50.000'), text('e0000004', 'Both done.', '17:05:00.000')]
      await show('17:05:01.000', { messages: ended, queued: [], working: false })
      await ack('17:09:00.300', await tap('17:09:00.000', 'yes'), 'yes')
      const again = [...ended, user('e0000005', 'yes', '17:09:00.200')]
      await show('17:09:01.000', { messages: again, queued: [] })
      await show('17:09:02.000', { messages: again, queued: [] })
      expect(drafts!.pending.map((item) => item.sentAt)).toEqual([at('17:04:23.000')])
    })

    it('keeps a desk message seen while a slow store read was out when the chat comes straight back and sends again', async () => {
      const read = AsyncStorage.getItem.bind(AsyncStorage)
      const slow = vi.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key: string) => {
        const value = await read(key)
        if (key.startsWith('orca:chatPendingEchoes:')) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
        return value
      })
      const deskCopy = hookCopy('17:05:00.000', 'typed at the desk')
      await show('17:05:00.500', { messages: afterTake, queued: [], prompts: deskCopy })
      await show('17:05:02.000', { messages: afterTake, queued: [], prompts: deskCopy })
      act(() => renderer?.unmount())
      renderer = null
      // Straight back, with the first read still out; the status has moved on.
      await show('17:05:02.500', { messages: afterTake, queued: [], prompts: [] })
      await clockTo('17:05:12.000')
      await show('17:05:12.000', { messages: afterTake, queued: [], prompts: [] })
      expect(drawn()).toContain('hook')
      slow.mockRestore()
      await ack('17:05:20.300', await tap('17:05:20.000', 'another thing'), 'another thing')
      await show('17:05:21.000', { messages: afterTake, queued: [], working: false, prompts: [] })
      await remount('17:06:00.000', { messages: afterTake, queued: [], prompts: [] })
      expect(drawn()).toContain('hook')
    })

    describe('on Codex', () => {
      const codexTurn = [
        text('msg_0ddffecfe356', 'Running the deploy check.', '17:03:30.106'),
        call('ctc_0ddffecfe357', '17:03:33.195')
      ]
      const codexEnded = [
        ...codexTurn,
        result('ctco_01a07666289b', '17:04:46.455'),
        text('msg_0ddffecfe358', 'Deploy is green.', '17:08:21.651')
      ]
      async function queueTwoYes(): Promise<void> {
        await show('17:04:10.000', { messages: codexTurn, agent: 'codex' })
        await ack('17:04:15.300', await tap('17:04:15.000', 'yes'), 'yes')
        await ack('17:04:20.300', await tap('17:04:20.000', 'yes'), 'yes')
        await show('17:04:21.000', { messages: codexTurn, agent: 'codex', queued: codexBox(['yes', 'yes']) })
      }

      it('keeps the second of two identical follow-ups on screen until its own row lands', async () => {
        await queueTwoYes()
        await show('17:08:22.000', { messages: codexEnded, agent: 'codex', queued: codexBox([]) })
        const first = [...codexEnded, user('01a07666-28b6-0001', 'yes', '17:08:22.100')]
        await show('17:08:23.000', { messages: first, agent: 'codex', queued: [] })
        await show('17:08:24.000', { messages: first, agent: 'codex', queued: [] })
        expect(drawn().filter((entry) => entry === 'row' || entry === 'phone')).toHaveLength(2)
      })

      it('draws two identical follow-ups once each when Codex submits them a turn apart', async () => {
        await queueTwoYes()
        await show('17:08:22.000', { messages: codexEnded, agent: 'codex', queued: codexBox(['yes']) })
        const first = [...codexEnded, user('01a07666-28b6-0001', 'yes', '17:08:22.100')]
        await show('17:08:23.000', { messages: first, agent: 'codex', queued: codexBox(['yes']) })
        const done = [...first, text('msg_0ddffecfe359', 'Done.', '17:08:40.000')]
        await show('17:08:41.500', { messages: done, agent: 'codex', queued: codexBox([]) })
        const both = [...done, user('01a07666-28b6-0002', 'yes', '17:08:41.000')]
        await show('17:08:42.000', { messages: both, agent: 'codex', queued: [] })
        await show('17:08:43.000', { messages: both, agent: 'codex', queued: [] })
        expect(drawn()).toEqual(['msg_0ddffecfe356', 'msg_0ddffecfe358', 'row', 'msg_0ddffecfe359', 'row'])
        expect(drafts!.pending).toEqual([])
      })
    })
  })
})
