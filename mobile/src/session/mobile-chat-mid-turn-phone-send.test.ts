import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { MobileChatQueueEntry } from './mobile-terminal-queued-messages'
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

// Reported from the phone on 2026-09-25 against Claude Code 2.1.281, session
// 967668df. The transcript's own records of the send (lines 15579, 15586 and
// 15587, 1-based): enqueued at 08:24:19.029, removed at 08:24:49.347 with
// reason `absorbed_mid_turn`, and written only as a `queued_command`
// attachment (`origin.kind: "human"`), which Orca's transcript reader drops.
// So no transcript row ever claims the phone's bubble.
//
// Claude Code 2.1.281 runs UserPromptSubmit for a prompt queued mid-turn at
// ENTER ("prompt.submit at Enter", read out of the binary), so Orca's hook puts
// the text on `agentStatus.prompt` about when the queue box first paints it.
const SESSION = '967668df-a7d9-40e7-964b-7812815c010d'
const TEXT = 'Working W capital'
const at = (clock: string) => Date.parse(`2026-09-25T${clock}Z`)
const row = (id: string, text: string, clock: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text }],
  timestamp: at(clock),
  source: 'transcript'
})
// What the phone held when the send left it, then the turn going on.
const held = [row('15570', 'Reading the queue projection next.', '08:24:12.410')]
const waited = [...held, row('15583', 'The pairing claims the nearest copy.', '08:24:31.902')]
const afterTake = [...waited, row('15590', 'On the working capital point:', '08:24:52.118')]

/** Claude Code 2.1.281's queue block, above the spinner (the layout pinned in
 *  mobile-terminal-queued-messages.test.ts), holding the given rows. */
function claudeScreen(queued: readonly string[]): string[] {
  return [
    '● Running 1 shell command · 14s…',
    '',
    ...queued.map((text) => `❯ ${text}`),
    ...(queued.length ? ['  ctrl+enter to send now'] : []),
    '',
    '✻ Incubating… (31m 27s · ↓ 67.8k tokens)',
    '  ⎿  Tip: Use /clear to start fresh when switching topics and free up context',
    '',
    '────────────────────────────────────────────────────────────────────────────────',
    `❯ ${queued.length ? 'Press up to edit queued messages' : ''}`,
    '────────────────────────────────────────────────────────────────────────────────'
  ]
}

/** Orca's hook copies of submissions, as the tab status reports them. The
 *  status carries one text at a time, so a repeat of the same text is only a
 *  new prompt after the field was reset between them. */
function hookCopies(...submissions: [clock: string, text: string][]): DesktopPrompt[] {
  let state = EMPTY_AGENT_STATUS_PROMPTS
  for (const [clock, text] of submissions) {
    state = observeAgentStatusPrompt(state, SESSION, { prompt: '', updatedAt: at(clock) })
    state = observeAgentStatusPrompt(state, SESSION, { prompt: text, updatedAt: at(clock) })
  }
  return [...state.prompts]
}
const hookCopy = (clock: string, text = TEXT) => hookCopies([clock, text])

type Tick = {
  messages: NativeChatMessage[]
  working?: boolean
  prompts?: DesktopPrompt[]
  /** The rows the agent's screen reader took out of its queue box. */
  queued?: string[]
  agent?: 'claude' | 'codex' | 'grok'
  /** The structured (agent-session) lane, which reads no queue box. */
  structured?: boolean
  /** Which tab is on screen; `other` is a second working session. */
  tab?: 'this' | 'other'
  /** Claude's spinner as the last screen read parsed it. Its elapsed time
   *  moves every second while the agent works, so each read that completes
   *  hands the chat a new one. */
  spinner?: { verb: string; elapsed: string }
}

type Drafts = ReturnType<typeof useMobileNativeChatDrafts>

describe('a message the phone queues while the agent works', () => {
  let renderer: ReactTestRenderer | null = null
  let drafts: Drafts | null = null
  let current: Tick = { messages: held }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(at('08:24:18.500'))
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
    const tab = tick.tab === 'other' ? 'tab-2' : 'tab'
    const session = tick.tab === 'other' ? 'another-session' : SESSION
    drafts = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: tab,
      sessionId: session,
      messages: tick.messages,
      transcriptLoading: false,
      transcriptSettled: true
    })
    const controller = {
      showNativeChat: true,
      activeChatEligible: true,
      viewResolved: true,
      terminalPeekActive: false,
      nativeChatSession: { messages: tick.messages, status: 'ready' },
      nativeChatAgent: tick.agent ?? 'claude',
      nativeChatStructured: tick.structured ?? false,
      nativeChatAgentWorking: tick.working ?? true,
      nativeChatStreamLive: tick.working ?? true,
      nativeChatStreamScopeKey: `${tab}:${session}`,
      nativeChatSpinner: tick.spinner ?? null,
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
      sendSurfaceId: tab,
      getSendCompletionGeneration: () => 0,
      keyboardInset: 0,
      onOpenFile: vi.fn()
    })
  }

  /** Time passes on the phone, with every timer that falls due in it. */
  async function clockTo(clock: string): Promise<void> {
    const delta = at(clock) - Date.now()
    if (delta > 0) {
      await act(async () => {
        vi.advanceTimersByTime(delta)
      })
    }
  }

  /** One moment of the route, at a desktop clock time. */
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
    // Let the witness memory's effects, and a tab's stored echoes read back
    // from storage, settle into the store and back.
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
  }

  /** The tap: the send's origin is taken as it leaves the phone. */
  async function tap(clock: string, text = TEXT): Promise<MobileNativeChatSendOrigin> {
    await clockTo(clock)
    return drafts!.captureSendOrigin(text)!
  }

  /** The send's ack: a text send gets its bubble only now. */
  async function ack(clock: string, origin: MobileNativeChatSendOrigin, text = TEXT): Promise<void> {
    await clockTo(clock)
    await act(async () => {
      drafts!.acceptSend(origin, text)
    })
    await show(clock, current)
  }

  function view() {
    return renderer!.root.findAll((node) => String(node.type) === 'ChatView')[0]!
  }
  /** Each user bubble the chat draws: the phone's own as `phone`, the hook's
   *  copy as `hook`, the queue box's as `queue`, a remembered witness as `kept`. */
  function bubbles(): string[] {
    const props = view().props
    const ids = new Set((props.pending as { id: string }[]).map((item) => item.id))
    const { data } = buildMobileNativeChatTransientData({
      messages: props.messages,
      folded: props.folded,
      streaming: null,
      pending: props.pending
    })
    return data
      .filter((message) => ids.has(message.id))
      .map((message) =>
        message.id.startsWith('pending-')
          ? 'phone'
          : message.id.startsWith('desk-')
            ? 'hook'
            : message.id.startsWith('queued-')
              ? 'queue'
              : `kept:${message.id}`
      )
  }
  function queueBox(): string[] {
    return ((view().props.queuedMessages ?? []) as MobileChatQueueEntry[]).map((entry) =>
      typeof entry === 'string' ? entry : entry.text
    )
  }

  describe('drawn once after Claude takes it', () => {
    it('shows the message once when the hook copy reached the phone before the send was acknowledged', async () => {
      await show('08:24:18.500', { messages: held })
      const origin = await tap('08:24:19.000')
      // Enter is written, Claude queues it and runs the hook; the relay brings
      // the status push before the send's own ack.
      await show('08:24:19.320', { messages: held, prompts: hookCopy('08:24:19.090') })
      await ack('08:24:19.900', origin)
      await show('08:24:20.400', { messages: held, prompts: hookCopy('08:24:19.090'), queued: queuedMessagesFromScreen(claudeScreen([TEXT])) })
      await show('08:24:32.000', { messages: waited, prompts: hookCopy('08:24:19.090'), queued: queuedMessagesFromScreen(claudeScreen([TEXT])) })
      // 08:24:49.347 Claude takes it; the next poll finds the box empty.
      await show('08:24:49.800', { messages: waited, prompts: hookCopy('08:24:19.090'), queued: queuedMessagesFromScreen(claudeScreen([])) })
      await show('08:24:52.500', { messages: afterTake, prompts: hookCopy('08:24:19.090'), queued: [] })
      expect(bubbles()).toEqual(['phone'])
      expect(queueBox()).toEqual([])
    })

    it('shows it once when the ack came first, as it usually does', async () => {
      await show('08:24:18.500', { messages: held })
      const origin = await tap('08:24:19.000')
      await ack('08:24:19.300', origin)
      await show('08:24:19.400', { messages: held, prompts: hookCopy('08:24:19.090') })
      await show('08:24:20.400', { messages: held, prompts: hookCopy('08:24:19.090'), queued: queuedMessagesFromScreen(claudeScreen([TEXT])) })
      await show('08:24:49.800', { messages: waited, prompts: hookCopy('08:24:19.090'), queued: [] })
      await show('08:24:52.500', { messages: afterTake, prompts: hookCopy('08:24:19.090'), queued: [] })
      expect(bubbles()).toEqual(['phone'])
    })

    it('shows it once when the queue box listed and released it before the ack, with no hook', async () => {
      await show('08:24:18.500', { messages: held })
      const origin = await tap('08:24:19.000')
      await show('08:24:19.600', { messages: held, queued: queuedMessagesFromScreen(claudeScreen([TEXT])) })
      await show('08:24:20.600', { messages: waited, queued: queuedMessagesFromScreen(claudeScreen([])) })
      await ack('08:24:21.000', origin)
      await show('08:24:52.500', { messages: afterTake, queued: [] })
      expect(bubbles()).toEqual(['phone'])
    })

    it('keeps two identical messages the phone queued as two, however the copies arrived', async () => {
      await show('08:24:18.500', { messages: held })
      const first = await tap('08:24:19.000', 'yes')
      await show('08:24:19.320', { messages: held, prompts: hookCopy('08:24:19.090', 'yes') })
      await ack('08:24:19.900', first, 'yes')
      const second = await tap('08:24:24.000', 'yes')
      await ack('08:24:24.300', second, 'yes')
      await show('08:24:25.000', { messages: held, prompts: hookCopy('08:24:19.090', 'yes'), queued: ['yes', 'yes'] })
      await show('08:24:49.800', { messages: afterTake, prompts: hookCopy('08:24:19.090', 'yes'), queued: [] })
      expect(bubbles()).toEqual(['phone', 'phone'])
    })

    it('still keeps an earlier message typed at the desk beside a later phone send of the same text', async () => {
      const desk = hookCopy('08:24:13.000', 'yes')
      await show('08:24:13.400', { messages: held, prompts: desk })
      expect(bubbles()).toEqual(['hook'])
      const origin = await tap('08:24:19.000', 'yes')
      // The phone's own copy races its ack, as in the report.
      const both = hookCopies(['08:24:13.000', 'yes'], ['08:24:19.090', 'yes'])
      await show('08:24:19.320', { messages: held, prompts: both })
      await ack('08:24:19.900', origin, 'yes')
      await show('08:24:52.500', { messages: afterTake, prompts: both })
      expect(bubbles()).toEqual(['hook', 'phone'])
    })
  })

  describe('in the queue box from the send until Claude takes it', () => {
    it('lists a send made while Claude works in the queue box at once, not as a bubble first', async () => {
      await show('08:24:18.500', { messages: held })
      const origin = await tap('08:24:19.000')
      await ack('08:24:19.300', origin)
      expect(bubbles()).toEqual([])
      expect(queueBox()).toEqual([TEXT])
      await show('08:24:19.400', { messages: held, prompts: hookCopy('08:24:19.090') })
      expect(bubbles()).toEqual([])
      expect(queueBox()).toEqual([TEXT])
      await show('08:24:20.400', { messages: held, prompts: hookCopy('08:24:19.090'), queued: queuedMessagesFromScreen(claudeScreen([TEXT])) })
      expect(bubbles()).toEqual([])
      expect(queueBox()).toEqual([TEXT])
      await show('08:24:49.800', { messages: waited, prompts: hookCopy('08:24:19.090'), queued: [] })
      expect(bubbles()).toEqual(['phone'])
      expect(queueBox()).toEqual([])
    })

    // Second review, 2026-09-25: five shapes the first pass got wrong.
    it('keeps a send Claude already took out of the queue box after a trip to another working tab', async () => {
      await show('08:24:18.500', { messages: held })
      await ack('08:24:19.300', await tap('08:24:19.000'))
      await show('08:24:20.400', { messages: held, queued: [TEXT] })
      await show('08:24:49.800', { messages: afterTake, queued: [] })
      expect(bubbles()).toEqual(['phone'])
      await show('08:24:55.000', { messages: [], tab: 'other' })
      await show('08:25:05.000', { messages: afterTake })
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it('keeps a send that left the queue box unseen out of it after a trip to another working tab', async () => {
      await show('08:24:18.500', { messages: held })
      await ack('08:24:19.300', await tap('08:24:19.000'))
      await clockTo('08:24:34.400')
      expect(bubbles()).toEqual(['phone'])
      await show('08:24:40.000', { messages: [], tab: 'other' })
      await show('08:24:45.000', { messages: afterTake })
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it('draws a send the box listed and released before its ack as a bubble at the ack', async () => {
      await show('08:24:18.500', { messages: held })
      const origin = await tap('08:24:19.000')
      await show('08:24:19.600', { messages: held, queued: queuedMessagesFromScreen(claudeScreen([TEXT])) })
      await show('08:24:20.600', { messages: waited, queued: [] })
      await ack('08:24:21.000', origin)
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it.each([
      ['an agent whose queue box the phone does not read', { agent: 'grok' as const }],
      ['the structured lane, which reads no queue box', { structured: true }]
    ])('draws a mid-turn send as a bubble at once for %s', async (_label, lane) => {
      await show('08:24:18.500', { messages: held, ...lane })
      await ack('08:24:19.300', await tap('08:24:19.000'))
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it('keeps a send queued while the screen reads time out, until a read lists it', async () => {
      const spinner = (elapsed: string) => ({ verb: 'Incubating', elapsed })
      await show('08:24:18.500', { messages: held, spinner: spinner('31m 26s') })
      await ack('08:24:19.300', await tap('08:24:19.000'))
      expect(queueBox()).toEqual([TEXT])
      // Two reads time out at 2.5 s each over the relay; nothing new arrives.
      await show('08:24:24.400', { messages: held, spinner: spinner('31m 26s') })
      expect(bubbles()).toEqual([])
      expect(queueBox()).toEqual([TEXT])
      await show('08:24:24.600', { messages: held, spinner: spinner('31m 32s'), queued: [TEXT] })
      expect(queueBox()).toEqual([TEXT])
      await show('08:24:49.800', { messages: afterTake, spinner: spinner('31m 57s'), queued: [] })
      expect(bubbles()).toEqual(['phone'])
    })

    it('shows the message once when its ack landed while another tab was on screen', async () => {
      await show('08:24:18.500', { messages: held })
      const origin = await tap('08:24:19.000')
      await show('08:24:19.320', { messages: held, prompts: hookCopy('08:24:19.090') })
      expect(bubbles()).toEqual(['hook'])
      // The user leaves before the ack; the witness went to disk on the way out.
      await show('08:24:19.700', { messages: [], tab: 'other' })
      await ack('08:24:19.900', origin)
      await show('08:24:30.000', { messages: waited, prompts: hookCopy('08:24:19.090'), queued: [TEXT] })
      await show('08:24:52.500', { messages: afterTake, prompts: hookCopy('08:24:19.090'), queued: [] })
      expect(bubbles()).toEqual(['phone'])
    })

    it('lets a send out of the queue box when Claude took it before any poll saw the box', async () => {
      const spinner = (seconds: number) => ({ verb: 'Incubating', elapsed: `31m ${seconds}s` })
      await show('08:24:18.500', { messages: held, spinner: spinner(26) })
      const origin = await tap('08:24:19.000')
      await ack('08:24:19.300', origin)
      expect(queueBox()).toEqual([TEXT])
      // Every read after it finds the box empty: Claude took it at once.
      for (let second = 20; second <= 25; second += 1) {
        await show(`08:24:${second}.100`, { messages: held, spinner: spinner(second + 7) })
      }
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it('lets it out by the cap when no screen read completes at all', async () => {
      await show('08:24:18.500', { messages: held })
      await ack('08:24:19.300', await tap('08:24:19.000'))
      await show('08:24:29.000', { messages: held })
      expect(queueBox()).toEqual([TEXT])
      await clockTo('08:24:34.400')
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it('draws a send made while the agent is idle as a bubble at once', async () => {
      await show('08:24:18.500', { messages: held, working: false })
      const origin = await tap('08:24:19.000')
      await show('08:24:19.200', { messages: held, working: true })
      await ack('08:24:19.300', origin)
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it('lists two identical sends as two queued rows while the box has painted only one', async () => {
      await show('08:24:18.500', { messages: held })
      await ack('08:24:19.300', await tap('08:24:19.000', 'yes'), 'yes')
      await ack('08:24:20.300', await tap('08:24:20.000', 'yes'), 'yes')
      expect(queueBox()).toEqual(['yes', 'yes'])
      await show('08:24:20.500', { messages: held, queued: ['yes'] })
      expect(queueBox()).toEqual(['yes', 'yes'])
      expect(bubbles()).toEqual([])
      await show('08:24:21.500', { messages: held, queued: ['yes', 'yes'] })
      await show('08:24:49.800', { messages: afterTake, queued: [] })
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone', 'phone'])
    })

    // The box cuts a long entry short with `…` on a narrow terminal, and a
    // stub under 24 characters is too short to be sure it is this send
    // (queueRowIsPendingSend), so it stands as a row of its own. When it left,
    // the queue-box witness held it, and only the phone's own sends clear it.
    it('does not draw a send twice when the box listed it too short to match and it left unseen', async () => {
      const text = 'Check the build failure on CI'
      await show('08:24:18.500', { messages: held })
      await ack('08:24:19.300', await tap('08:24:19.000', text), text)
      await show('08:24:20.400', { messages: held, queued: ['Check the build…'] })
      await show('08:24:21.400', { messages: waited, queued: [] })
      // Still the phone's own queued send, never a second copy beside it.
      expect(bubbles()).toEqual([])
      await show('08:24:52.500', { messages: afterTake, queued: [] })
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })

    it('does the same for a Codex send, whose queue box reads differently', async () => {
      const codexScreen = (rows: string[]) => [
        '• Queued follow-up inputs',
        ...rows.map((text) => `  ↳ ${text}`),
        '    alt + ↑ edit last queued message',
        '› '
      ]
      await show('08:24:18.500', { messages: held, agent: 'codex' })
      await ack('08:24:19.300', await tap('08:24:19.000'))
      expect(queueBox()).toEqual([TEXT])
      expect(bubbles()).toEqual([])
      await show('08:24:20.400', { messages: held, agent: 'codex', queued: codexQueuedMessagesFromScreen(codexScreen([TEXT])) })
      expect(queueBox()).toEqual([TEXT])
      await show('08:24:49.800', { messages: afterTake, agent: 'codex', queued: codexQueuedMessagesFromScreen(codexScreen([])) })
      expect(queueBox()).toEqual([])
      expect(bubbles()).toEqual(['phone'])
    })
  })
})
