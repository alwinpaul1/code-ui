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
