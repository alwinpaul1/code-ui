import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
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
// to 2.1.282 alone, 65 and 16.
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
    await show('17:04:10.000', { messages: beforeSend, ...extra })
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
})
