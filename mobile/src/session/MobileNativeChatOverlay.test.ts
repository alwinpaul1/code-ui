import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import {
  appendMobileNativeChatPending,
  captureSendBoundary,
  type MobileNativeChatPendingMessage
} from './mobile-native-chat-pending-echo'
import { noteLiveRowsArrived } from './mid-turn-written-before'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

const clipboard = { hasImage: false }
const appStateListeners: ((state: string) => void)[] = []
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => clipboard.hasImage),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListeners.push(listener)
      return { remove: () => undefined }
    },
    currentState: 'active'
  },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View'
}))

const chatMounts = vi.hoisted(() => ({ count: 0 }))
vi.mock('./MobileNativeChatView', async () => {
  const { useEffect, createElement: h } = await import('react')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) => {
      useEffect(() => {
        chatMounts.count += 1
      }, [])
      return h('ChatView', props)
    }
  }
})

function assistantTurn(id: string, text: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'hook' }
}

/** One render of the route: chat visible or not, the transcript it currently
 *  holds, and the agent-status stream behind it. */
type Tick = {
  show?: boolean
  messages?: NativeChatMessage[]
  streamingText?: string
  streamLive?: boolean
  identity?: string
  /** Tab still resolves to a chat (a deliberate terminal toggle keeps this true). */
  eligible?: boolean
  /** The view-mode store has been read for this scope. */
  viewResolved?: boolean
  /** The structured lane's command surface; absent on the PTY lane. */
  commandSurface?: MobileNativeChatController['nativeChatCommandSurface']
  /** The host's mobile gate lets a phone call agentSession.rewind (default: yes). */
  hostAllowsRewind?: boolean
  /** The phone's own sends still waiting for a transcript row. */
  pending?: MobileNativeChatPendingMessage[]
  /** Prompts Orca's UserPromptSubmit hook reported (`agentStatus.prompt`). */
  desktopPrompts?: DesktopPrompt[]
  /** The rows the agent's queue box shows right now. */
  queued?: string[]
}

function overlayElement(tick: Tick): ReturnType<typeof createElement> {
  const controller = {
    showNativeChat: tick.show ?? true,
    activeChatEligible: tick.eligible ?? true,
    viewResolved: tick.viewResolved ?? true,
    terminalPeekActive: false,
    nativeChatSession: { messages: tick.messages ?? [], status: 'ready' },
    nativeChatAgent: 'claude',
    nativeChatAgentWorking: tick.streamLive ?? false,
    nativeChatStreamingText: tick.streamingText,
    nativeChatStreamLive: tick.streamLive ?? false,
    nativeChatStreamScopeKey: tick.identity ?? 'tab-a',
    chatPending: tick.pending ?? [],
    nativeChatDesktopPrompts: tick.desktopPrompts,
    nativeChatQueuedMessages: tick.queued,
    chatImagePreviewsByMessageId: {},
    chatComposerText: '',
    setChatComposerText: vi.fn(),
    nativeChatCommandSurface: tick.commandSurface
  } as unknown as MobileNativeChatController
  return createElement(MobileNativeChatOverlay, {
    controller,
    // These cases model a terminal tab, which always has a pane underneath.
    hasTerminalUnderneath: true,
    hostAllowsRewind: tick.hostAllowsRewind ?? true,
    images: {} as never,
    onMicPress: vi.fn(),
    micActive: false,
    dictationMode: 'toggle',
    onMicPressIn: vi.fn(),
    onMicPressOut: vi.fn(),
    inputLockReason: null,
    sendErrorMessage: null,
    onClearSendError: vi.fn(),
    sendSurfaceId: tick.identity ?? 'tab-a',
    getSendCompletionGeneration: () => 0,
    keyboardInset: 0
  })
}

describe('MobileNativeChatOverlay streaming gate', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function render(tick: Tick): Promise<void> {
    await act(async () => {
      renderer = create(overlayElement(tick))
    })
  }

  async function update(tick: Tick): Promise<void> {
    await act(async () => {
      renderer?.update(overlayElement(tick))
    })
  }

  /** The bubble text handed to the chat list, or `'hidden'` when chat is off. */
  function streaming(): string | null | 'hidden' {
    const views = renderer!.root.findAll((node) => node.type === 'ChatView')
    return views.length === 0 ? 'hidden' : (views[0].props.streaming as string | null)
  }

  it('hides a stream that is no more than the previous reply, and shows it once it grows past', async () => {
    // Device 2026-09-19, "Same response twice" (0.9.0 and 0.9.1): a host that
    // never went idle between two turns carried the last reply into the next
    // turn's status, and the bubble drew it again under the new prompt. A
    // stream that is a prefix of the last assistant row is that row; a
    // genuinely repeated reply shows once it diverges or its own row lands.
    const prior = [assistantTurn('a1', 'The tests pass.')]
    await render({ messages: prior })
    expect(streaming()).toBeNull()

    await update({ messages: prior, streamingText: 'The tests', streamLive: true })
    expect(streaming()).toBeNull()
    await update({ messages: prior, streamingText: 'The tests pass.', streamLive: true })
    expect(streaming()).toBeNull()
    await update({ messages: prior, streamingText: 'The tests pass. Lint too.', streamLive: true })
    expect(streaming()).toBe('The tests pass. Lint too.')
  })

  it('keeps live prose visible through a status gap until the transcript arrives', async () => {
    const prior = [assistantTurn('a1', 'Earlier reply')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'The new reply is growing', streamLive: true })
    await update({ messages: prior, streamLive: true })
    expect(streaming()).toBe('The new reply is growing')
    await update({
      messages: [...prior, assistantTurn('a2', 'The new reply is growing')],
      streamLive: true
    })
    expect(streaming()).toBeNull()
  })

  it('does not flash a second full bubble when the transcript trails the stream by a few words', async () => {
    const prior = [assistantTurn('a1', 'Earlier reply')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'The new reply', streamLive: true })
    const partial = [...prior, assistantTurn('a2', 'The new')]
    await update({ messages: partial, streamingText: 'The new reply is growing', streamLive: true })
    expect(streaming()).toBeNull()
    await update({
      messages: [...prior, assistantTurn('a2', 'The new reply is growing')],
      streamingText: 'The new reply is growing',
      streamLive: true
    })
    expect(streaming()).toBeNull()
  })

  it('drops the streaming bubble once the reply lands as its own turn', async () => {
    const prior = [assistantTurn('a1', 'Done.')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'Done again.', streamLive: true })
    expect(streaming()).toBe('Done again.')

    await update({
      messages: [...prior, assistantTurn('a2', 'Done again.')],
      streamingText: 'Done again.',
      streamLive: true
    })

    expect(streaming()).toBeNull()
  })

  it('does not revive a delivered preview when the next transcript message arrives', async () => {
    const prior = [assistantTurn('a1', 'Earlier reply')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'First part', streamLive: true })
    const landed = [...prior, assistantTurn('a2', 'First part')]
    await update({ messages: landed, streamingText: 'First part', streamLive: true })
    expect(streaming()).toBeNull()
    await update({
      messages: [...landed, assistantTurn('a3', 'Next part')],
      streamingText: 'First part',
      streamLive: true
    })
    expect(streaming()).toBeNull()
  })

  it('retires the preview when a transcript batch already includes a later reply', async () => {
    const prior = [assistantTurn('a1', 'Earlier reply')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'First part', streamLive: true })
    await update({
      messages: [...prior, assistantTurn('a2', 'First part'), assistantTurn('a3', 'Next part')],
      streamingText: 'First part',
      streamLive: true
    })
    expect(streaming()).toBeNull()
  })

  it('does not duplicate a new part whose transcript beats its status preview', async () => {
    const prior = [assistantTurn('a1', 'Earlier reply')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'First part', streamLive: true })
    const landed = [...prior, assistantTurn('a2', 'First part')]
    await update({ messages: landed, streamingText: 'First part', streamLive: true })
    const next = [...landed, assistantTurn('a3', 'Next part')]
    await update({ messages: next, streamingText: 'First part', streamLive: true })
    await update({ messages: next, streamingText: 'Next part', streamLive: true })
    expect(streaming()).toBeNull()
  })

  it('keeps the bubble across a peek at the terminal view', async () => {
    // Toggling to the terminal unmounts the chat list and unsubscribes its
    // transcript. The gate lives above that boundary, so the baseline survives
    // and the repeated-prefix reply keeps streaming on the way back.
    const prior = [assistantTurn('a1', 'Done.')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'Done again.', streamLive: true })
    expect(streaming()).toBe('Done again.')

    await update({ show: false, messages: [], streamLive: true })
    expect(streaming()).toBe('hidden')
    // Back on chat the session withholds its transcript until a fresh read
    // settles, so the throttled stream text returns a round trip ahead of it.
    await update({ messages: [], streamLive: true })
    await update({ messages: [], streamingText: 'Done again.', streamLive: true })
    await update({ messages: prior, streamingText: 'Done again.', streamLive: true })

    expect(streaming()).toBe('Done again.')
  })

  it('keeps the bubble across a peek at the terminal taken between turns', async () => {
    // Same toggle, but taken while idle: the transcript empties before the next
    // turn starts, so the gate has to reject that empty tail as a baseline.
    const prior = [assistantTurn('a1', 'Done.')]
    await render({ messages: prior })

    await update({ show: false, messages: [] })
    await update({ show: false, messages: [], streamLive: true })
    await update({ messages: [], streamLive: true })
    await update({ messages: [], streamingText: 'Done again.', streamLive: true })
    await update({ messages: prior, streamingText: 'Done again.', streamLive: true })

    expect(streaming()).toBe('Done again.')
  })

  it('hides a repeated part whose own turn landed during a mid-turn gap', async () => {
    // Between parts the status frame carries no assistant text (a tool call), so
    // the stream goes textless while the turn is still live and the part that
    // just finished lands in the transcript. Re-anchoring on that tick would
    // adopt it as history and render it a second time.
    const prior = [assistantTurn('a1', 'Done.')]
    await render({ messages: prior })
    await update({ messages: prior, streamingText: 'Done again.', streamLive: true })
    expect(streaming()).toBe('Done again.')

    const landed = [...prior, assistantTurn('a2', 'Done again.')]
    await update({ messages: landed, streamLive: true })
    await update({ messages: landed, streamingText: 'Done again.', streamLive: true })

    expect(streaming()).toBeNull()
  })

  it("does not carry one chat's baseline into another stream identity", async () => {
    const prior = [assistantTurn('a1', 'Shared answer text')]
    await render({ messages: prior, identity: 'tab-a' })

    await update({
      messages: prior,
      streamingText: 'Shared answer',
      streamLive: true,
      identity: 'tab-b'
    })

    expect(streaming()).toBeNull()
  })
})

// 2026-09-13: reopening the app and reconnecting flashed the whole screen —
// the chat dropped to the terminal beneath for a frame while the tab list
// re-hydrated, then came back.
describe('MobileNativeChatOverlay across a reconnect blink', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('keeps the last chat on screen while chat blinks off, then lets it go', async () => {
    vi.useFakeTimers()
    const prior = [assistantTurn('a1', 'Hello')]
    await act(async () => {
      renderer = create(overlayElement({ messages: prior }))
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(1)

    // The tab list re-hydrates: no active tab resolves, so chat is neither
    // shown nor eligible for a moment.
    await act(async () => {
      renderer!.update(overlayElement({ messages: prior, show: false, eligible: false }))
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(1)

    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(0)
  })

  // 2026-09-13: the hold was decided in an effect, so the first blank frame
  // returned null — the terminal showed for a frame and the whole chat list
  // unmounted and mounted again, losing its scroll position and its state.
  it('keeps the same chat mounted across the blink, without a remount', async () => {
    const prior = [assistantTurn('a1', 'Hello')]
    await act(async () => {
      renderer = create(overlayElement({ messages: prior }))
    })
    const mounted = chatMounts.count
    await act(async () => {
      renderer!.update(overlayElement({ messages: prior, show: false, eligible: false }))
    })
    await act(async () => {
      renderer!.update(overlayElement({ messages: prior }))
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(1)
    expect(chatMounts.count).toBe(mounted)
  })

  it('shows nothing when chat was never on for this surface', async () => {
    await act(async () => {
      renderer = create(overlayElement({ show: false, eligible: false }))
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(0)
  })

  // 2026-09-13: returning to the app re-reads the view-mode store, which
  // answers "terminal" until it has loaded, and the chat dropped to the
  // terminal for a frame and came back.
  it('holds the chat while the view mode is still being read', async () => {
    vi.useFakeTimers()
    const prior = [assistantTurn('a1', 'Hello')]
    await act(async () => {
      renderer = create(overlayElement({ messages: prior }))
    })
    await act(async () => {
      renderer!.update(overlayElement({ messages: prior, show: false, viewResolved: false }))
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(1)
    await act(async () => {
      renderer!.update(overlayElement({ messages: prior }))
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(1)
  })

  it('does not hold a deliberate switch to the terminal', async () => {
    const prior = [assistantTurn('a1', 'Hello')]
    await act(async () => {
      renderer = create(overlayElement({ messages: prior }))
    })
    await act(async () => {
      renderer!.update(overlayElement({ messages: prior, show: false }))
    })
    expect(renderer!.root.findAllByType('ChatView' as never)).toHaveLength(0)
  })
})

it('offers the paste row only once the clipboard actually holds an image', async () => {
  // 2026-09-14 review: every clipboard mock hardcoded "no image", so the gate
  // that decides whether to show the row was never exercised on its true
  // branch — deleting it would have failed nothing.
  clipboard.hasImage = false
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(overlayElement({}))
  })
  const pasteProp = () =>
    renderer!.root.findAllByType('ChatView' as never)[0]?.props.onPasteImage
  await act(async () => {
    await Promise.resolve()
  })
  expect(pasteProp()).toBeUndefined()

  // Copy an image, then bring the app back to the foreground.
  clipboard.hasImage = true
  await act(async () => {
    for (const listener of appStateListeners) {
      listener('active')
    }
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(typeof pasteProp()).toBe('function')
  act(() => renderer!.unmount())
})

// The host decides per session whether it will rewind (`agentSession.options`
// reports it; a Codex session on legacy history says `history-not-paginated`,
// and a host that predates the backend says nothing). The affordance follows
// that answer exactly: the row is offered only when the host said yes.
describe('handing the chat list a way to rewind', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function rewindProp(
    commandSurface: MobileNativeChatController['nativeChatCommandSurface'],
    hostAllowsRewind?: boolean
  ): Promise<unknown> {
    await act(async () => {
      renderer = create(overlayElement({ commandSurface, hostAllowsRewind }))
    })
    return renderer!.root.findAllByType('ChatView' as never)[0]?.props.onRewindToMessage
  }

  const surface = (
    rewindSupport: NonNullable<MobileNativeChatController['nativeChatCommandSurface']>['rewindSupport']
  ) => ({
    sessionCommands: undefined,
    conversationCommands: [],
    rewindSupport,
    rewindToItem: vi.fn(async () => true)
  })

  it('offers it when the host said this session can rewind', async () => {
    const claude = surface({ supported: true })
    expect(await rewindProp(claude)).toBe(claude.rewindToItem)
  })

  it('offers nothing for a Codex session the host cannot page', async () => {
    expect(
      await rewindProp(surface({ supported: false, reason: 'history-not-paginated' }))
    ).toBeUndefined()
  })

  it('offers nothing while the host has not said, or never will', async () => {
    expect(await rewindProp(surface(null))).toBeUndefined()
  })

  it('offers nothing on the PTY lane, which keeps the typed /rewind', async () => {
    expect(await rewindProp(undefined)).toBeUndefined()
  })

  // 2026-09-18: Orca 1.4.205's mobile-scope dispatch gate refuses
  // agentSession.rewind from a phone outright, whatever the session says, so
  // "Rewind to here" was offered and every tap got "not available to mobile
  // clients". The session's own answer is necessary, not sufficient.
  it('offers nothing on a host whose mobile gate refuses agentSession.rewind, even for a session that can rewind', async () => {
    expect(await rewindProp(surface({ supported: true }), false)).toBeUndefined()
  })

  it('offers it, exactly as before, once the gate is known to let the call through', async () => {
    const claude = surface({ supported: true })
    expect(await rewindProp(claude, true)).toBe(claude.rewindToItem)
  })
})

// Session 967668df, 2026-09-23 (Claude Code 2.1.280): the reply "Red.
// Implementing the connecting state:" is stamped 22:15:15.441 but was written to
// the transcript only after the phone sent a message at 22:15:23.873, so the
// send's tail was the tool result above it. The Claude app drew the reply above
// the message; the phone drew it below.
describe('a message the phone sent mid-turn', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const at = (clock: string) => Date.parse(`2026-09-23T${clock}Z`)
  // The row that was last when the phone sent: the reply about the failing run.
  const toolResult = { ...assistantTurn('result', 'Tests  2 failed | 35 passed (37)'), timestamp: at('22:15:14.900') }
  const reply = { ...assistantTurn('red', 'Red. Implementing the connecting state:'), timestamp: at('22:15:15.441') }
  const nextCall = { ...assistantTurn('next', 'Waiting for the PC to connect.'), timestamp: at('22:15:25.228') }
  const send: MobileNativeChatPendingMessage = {
    id: 'send',
    text: 'See which message responses had that sideline',
    expectedOccurrence: 1,
    baselineTailMessageId: 'result',
    baselineResolved: true,
    sentAt: at('22:15:23.873')
  }

  function drawnOrder(): string[] {
    const view = renderer!.root.findAll((node) => node.type === 'ChatView')[0]!
    const { data } = buildMobileNativeChatTransientData({
      messages: view.props.messages,
      folded: view.props.folded,
      streaming: null,
      pending: view.props.pending
    })
    return data.map((message) => (message.role === 'user' ? 'SENT' : message.id))
  }

  it('draws a reply written before the send below it, not above, once that reply loads', async () => {
    await act(async () => {
      renderer = create(overlayElement({ messages: [toolResult], pending: [send] }))
    })
    await act(async () => {
      renderer?.update(overlayElement({ messages: [toolResult, reply, nextCall], pending: [send] }))
    })
    const order = drawnOrder()
    expect(order.indexOf('red')).toBeLessThan(order.indexOf('SENT'))
    expect(order.indexOf('SENT')).toBeLessThan(order.indexOf('next'))
  })

  it('keeps a call written a second after the send below it when the phone clock runs 3 s ahead', async () => {
    // Review, 2026-09-24: with a fixed 1 s margin that call moved above the
    // bubble. Each live row reached the phone 3.1 s after its stamp.
    const lead = 3_100
    const quickCall = { ...assistantTurn('quick', 'Running the gate.'), timestamp: at('22:15:21.900') }
    const rows = [toolResult, reply, quickCall]
    for (const row of rows) {
      noteLiveRowsArrived([row], (row.timestamp ?? 0) + lead)
    }
    // The phone's clock read 22:15:23.873 at the send; the desktop's, 22:15:20.773.
    await act(async () => {
      renderer = create(overlayElement({ messages: rows, pending: [send] }))
    })
    expect(drawnOrder()).toEqual(['result', 'red', 'SENT', 'quick'])
  })

  it('breaks the tool fold where the bubble is drawn, so a call after the send stays below it', async () => {
    const call: NativeChatMessage = {
      id: 'call',
      role: 'assistant',
      blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'npx vitest run' } }],
      timestamp: at('22:15:25.228'),
      source: 'transcript'
    }
    await act(async () => {
      renderer = create(overlayElement({ messages: [toolResult, reply, call], pending: [send] }))
    })
    const order = drawnOrder()
    expect(order.indexOf('red')).toBeLessThan(order.indexOf('SENT'))
    expect(order.at(-1)).not.toBe('red')
    expect(order.indexOf('SENT')).toBeLessThan(order.length - 1)
  })

  it('records when a send left the phone, and carries it onto the pending message', () => {
    const before = Date.now()
    const boundary = captureSendBoundary([toolResult], 'see which')
    expect(boundary.baselineTailMessageId).toBe('result')
    expect(boundary.sentAt).toBeGreaterThanOrEqual(before)
    const origin = {
      draftKey: 'd',
      draftEditGeneration: 0,
      pendingKey: 'key',
      normalizedText: 'see which',
      baselineResolved: true,
      ...boundary
    }
    const pending = appendMobileNativeChatPending({}, 'key', 'p1', origin, 'see which')
    expect(pending.key?.[0]?.sentAt).toBe(boundary.sentAt)
  })

  it('keeps a row written after the send below it, and a send with no time where it was sent', async () => {
    const justAfter = { ...assistantTurn('after', 'Starting.'), timestamp: at('22:15:24.100') }
    await act(async () => {
      renderer = create(overlayElement({ messages: [toolResult, justAfter], pending: [send] }))
    })
    expect(drawnOrder()).toEqual(['result', 'SENT', 'after'])
    await act(async () => {
      renderer?.update(overlayElement({ messages: [toolResult, reply], pending: [{ ...send, sentAt: undefined }] }))
    })
    expect(drawnOrder()).toEqual(['result', 'SENT', 'red'])
  })
})

// Session 967668df, 0-based lines 8605–8637 (Claude Code 2.1.281, 2026-09-23). The
// rows and their stamps are the transcript's. A message enqueued at
// 23:19:27.671 was followed by a thinking row and a call STAMPED 0.2 s before
// it but written after it, and absorbed at 23:19:28.688 as a `queued_command`
// Orca's reader drops. The mahdi message itself came from the Claude app (its
// enqueue has no `content` and its photos are in the Remote Control upload
// folder); these cases put a PHONE send in the same place. Orca's hook reports
// every prompt, the phone's too, as a timed `agentStatus.prompt`.
describe('a message the phone sent mid-turn, beside the hook and queue copies of it', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const at = (clock: string) => Date.parse(`2026-09-23T${clock}Z`)
  const row = (
    id: string,
    role: 'assistant' | 'user',
    block: NativeChatMessage['blocks'][number],
    clock: string
  ): NativeChatMessage => ({ id, role, blocks: [block], timestamp: at(clock), source: 'transcript' })
  const bash = (description: string) => ({ type: 'tool-call' as const, name: 'Bash', input: { description } })
  // Held when the send left the phone (8605, 8606, 8608).
  const held = [
    row('8605', 'assistant', { type: 'text', text: "I'll look at which hook events Orca installed for this profile." }, '23:19:13.464'),
    row('8606', 'assistant', bash('List hook events registered in each Claude profile'), '23:19:13.473'),
    row('8608', 'user', { type: 'tool-result', output: "== /Users/alwinpaul/.claude-work/settings.json\n['PermissionRequest', 'PostCompact']" }, '23:19:14.835')
  ]
  // Written after the send, the first two stamped before it (8614, 8615, 8617).
  const afterSend = [
    row('8614', 'assistant', { type: 'text', text: 'I confirmed Orca registers `StopFailure`, so the turn-end hook exists.' }, '23:19:27.450'),
    row('8615', 'assistant', bash('Read turn-boundary and monitoring logic'), '23:19:27.458'),
    row('8617', 'user', { type: 'tool-result', output: '    // Why: a new process owns the pane' }, '23:19:28.641')
  ]
  // The next reply, after the take (8637).
  const next = row('8637', 'assistant', { type: 'text', text: 'I found another rendering bug: multi-paragraph quotes render broken in Code UI.' }, '23:19:42.309')
  const text =
    'See this message to mahdi looked nicely formatted in claude mobile app where as it was broken in our code ui app fix that'
  const photos = ['e7c39725', '8645a424', '350711b8'].map(
    (name) => `file:///data/user/0/com.codeui/cache/ImagePicker/${name}.jpg`
  )
  const send: MobileNativeChatPendingMessage = {
    id: 'phone-send',
    text,
    expectedOccurrence: 1,
    baselineTailMessageId: '8608',
    baselineResolved: true,
    sentAt: at('23:19:27.671')
  }
  const hook = (clock: string, prompt = text): DesktopPrompt => ({
    nonce: `status:967668df-a7d9-40e7-964b-7812815c010d:${at(clock)}:0`,
    text: prompt,
    at: at(clock)
  })

  /** Each drawn row: a transcript row by id, a bubble as `bubble:<whose>`
   *  with its picture count. */
  function drawn(): string[] {
    const view = renderer!.root.findAll((node) => node.type === 'ChatView')[0]!
    const pendingIds = new Set((view.props.pending as { id: string }[]).map((item) => item.id))
    const { data } = buildMobileNativeChatTransientData({
      messages: view.props.messages,
      folded: view.props.folded,
      streaming: null,
      pending: view.props.pending
    })
    return data.map((message) => {
      if (!pendingIds.has(message.id)) {
        return message.id
      }
      const pictures = message.blocks.filter((block) => block.type === 'image-ref').length
      const whose = message.id.startsWith('desk-') ? 'hook' : message.id.startsWith('queued-') ? 'queue' : message.id
      return `bubble:${whose}${pictures ? `+${pictures}` : ''}`
    })
  }

  async function play(ticks: Tick[]): Promise<void> {
    for (const tick of ticks) {
      await act(async () => {
        if (renderer) {
          renderer.update(overlayElement(tick))
        } else {
          renderer = create(overlayElement(tick))
        }
      })
    }
  }

  const bubbles = () => drawn().filter((entry) => entry.startsWith('bubble:'))
  const before = (a: string, b: string) => drawn().indexOf(a) < drawn().indexOf(b)

  it.each([
    ['the hook timed at the submit', '23:19:27.700'],
    ['the hook timed at the take', '23:19:28.688']
  ])('draws a text send once, as the phone sent it, above the rows written after it, with %s', async (_label, clock) => {
    const pending = [send]
    await play([
      { messages: held, pending },
      { messages: held, pending, desktopPrompts: [hook(clock)] },
      { messages: [...held, ...afterSend], pending, desktopPrompts: [hook(clock)] },
      { messages: [...held, ...afterSend, next], pending, desktopPrompts: [hook(clock)] }
    ])
    expect(bubbles()).toEqual(['bubble:phone-send'])
    expect(before('8608', 'bubble:phone-send')).toBe(true)
    expect(before('bubble:phone-send', '8614')).toBe(true)
  })

  it('draws a photo send once, with its photos, above the rows written after it', async () => {
    const pending = [{ ...send, images: photos }]
    const prompts = [hook('23:19:27.700', `[Image #20] [Image #21] [Image #22] ${text}`)]
    await play([
      { messages: held, pending },
      { messages: held, pending, desktopPrompts: prompts },
      { messages: [...held, ...afterSend, next], pending, desktopPrompts: prompts }
    ])
    expect(bubbles()).toEqual(['bubble:phone-send+3'])
    expect(before('bubble:phone-send+3', '8614')).toBe(true)
  })

  it('shows a send in the queue box alone while it waits, then as the phone sent it once the agent takes it', async () => {
    const pending = [send]
    const prompts = [hook('23:19:27.700')]
    await play([
      { messages: held, pending },
      { messages: held, pending, desktopPrompts: prompts, queued: [text] },
      { messages: [...held, afterSend[0]!, afterSend[1]!], pending, desktopPrompts: prompts, queued: [text] }
    ])
    expect(bubbles()).toEqual([])
    await play([{ messages: [...held, ...afterSend, next], pending, desktopPrompts: prompts, queued: [] }])
    expect(bubbles()).toEqual(['bubble:phone-send'])
    expect(before('bubble:phone-send', '8614')).toBe(true)
  })

  it('still draws a message typed elsewhere, which has no phone copy, from the hook alone', async () => {
    await play([
      { messages: held },
      { messages: held, desktopPrompts: [hook('23:19:27.700')] },
      { messages: [...held, ...afterSend, next], desktopPrompts: [hook('23:19:27.700')] }
    ])
    expect(bubbles()).toEqual(['bubble:hook'])
  })

  // Review, 2026-09-24: two mid-turn messages with no row written between
  // them share an anchor, and draw in list order.
  it('draws a message typed at the desk before a phone send above it when both follow the same row', async () => {
    const desk = hook('23:19:20.000', 'first, from the desk')
    const own = hook('23:19:27.700')
    await play([
      { messages: held, desktopPrompts: [desk] },
      { messages: held, pending: [send], desktopPrompts: [desk, own] },
      { messages: [...held, ...afterSend, next], pending: [send], desktopPrompts: [desk, own] }
    ])
    expect(bubbles()).toEqual(['bubble:hook', 'bubble:phone-send'])
  })

  // Review, 2026-09-24: the phone's send hid every hook prompt with its text,
  // not just its own copy.
  it('draws a later message typed elsewhere that repeats the text of a pending phone send', async () => {
    const yes = { ...send, text: 'yes' }
    const prompts = [hook('23:19:27.700', 'yes'), hook('23:19:35.000', 'now look at the logs'), hook('23:19:40.000', 'yes')]
    await play([
      { messages: held, pending: [yes], desktopPrompts: prompts.slice(0, 1) },
      { messages: [...held, ...afterSend, next], pending: [yes], desktopPrompts: prompts }
    ])
    expect(bubbles()).toEqual(['bubble:phone-send', 'bubble:hook', 'bubble:hook'])
  })

  it('keeps an earlier message typed elsewhere beside a later phone send of the same text', async () => {
    const earlier = hook('23:19:10.000', 'yes')
    // Remembered from the hook before the phone sent its own "yes".
    const remembered: MobileNativeChatPendingMessage = {
      id: `desk-${earlier.nonce}`,
      text: 'yes',
      expectedOccurrence: 1,
      baselineTailMessageId: '8606',
      baselineResolved: true
    }
    const yes = { ...send, text: 'yes' }
    await play([
      { messages: held, pending: [remembered], desktopPrompts: [earlier] },
      { messages: [...held, ...afterSend], pending: [remembered, yes], desktopPrompts: [earlier, hook('23:19:27.700', 'yes')] }
    ])
    expect(bubbles()).toEqual(['bubble:hook', 'bubble:phone-send'])
  })

  // The hook reports a photo send with its markers first, so a leading skill
  // token was not where the short-token rule looks, and the send drew twice.
  it('draws a photo send that starts with a plugin skill once', async () => {
    const skill = { ...send, text: '/codeui:review the placement', images: photos.slice(0, 1) }
    const prompts = [hook('23:19:27.700', '[Image #20] /codeui:review the placement')]
    await play([
      { messages: held, pending: [skill], desktopPrompts: prompts },
      { messages: [...held, ...afterSend], pending: [skill], desktopPrompts: prompts }
    ])
    expect(bubbles()).toEqual(['bubble:phone-send+1'])
  })

  it('still draws a message typed elsewhere from the queue box when no hook reports it', async () => {
    await play([
      { messages: held },
      { messages: held, queued: [text] },
      { messages: [...held, ...afterSend], queued: [] },
      { messages: [...held, ...afterSend, next], queued: [] }
    ])
    expect(bubbles()).toEqual(['bubble:queue'])
  })
})
