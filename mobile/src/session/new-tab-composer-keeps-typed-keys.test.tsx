import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

// Reported from the phone (2026-10-11): "when i open a new tab in codeui and
// keyboard if i type anything doesn't appear on keyboard then i have to tap on
// input box area".
//
// A freshly opened agent tab has no transcript yet (Claude writes none before
// the first prompt), so its session sits at 'awaiting-transcript' and the
// overlay reads it as an empty reload: blank, and a blink. The overlay's hold
// (use-native-chat-frame.ts) then replayed the frame it had drawn a render
// earlier for up to CHAT_FRAME_HOLD_MS. It replayed the ELEMENT, so React
// bailed out of the whole chat subtree and the composer kept the `value` it
// was drawn with. A key typed then went through onChangeText into the draft,
// the replayed composer still said '', and React Native's TextInput writes its
// `value` prop back over the native text, so every key vanished with the
// keyboard still up. A tap on the field later "fixed" it only because the
// hold had run out by then. The same freeze hit any reconnect blink over a
// chat the user was typing into.
//
// The hold now replays what the chat SHOWED (rows, status, prompts) and draws
// the composer's input from the live render.

vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
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

type Moment = {
  /** What the composer holds in the draft store right now. */
  typed: string
  /** The draft setter of this render (a new one each render, as an inline arrow would be). */
  setter?: (text: string) => void
  focusRequest?: number
  messages?: NativeChatMessage[]
  /** 'awaiting-transcript' is a new agent tab before its first prompt. */
  status?: 'awaiting-transcript' | 'loading' | 'ready'
  show?: boolean
  eligible?: boolean
  surface?: string
  /** The keyboard's height as the screen reports it. */
  keyboard?: number
}

function overlay(moment: Moment): ReturnType<typeof createElement> {
  const status = moment.status ?? 'awaiting-transcript'
  const controller = {
    showNativeChat: moment.show ?? true,
    activeChatEligible: moment.eligible ?? true,
    viewResolved: true,
    terminalPeekActive: false,
    nativeChatSession: {
      messages: moment.messages ?? [],
      status,
      transcriptLoading: status !== 'ready'
    },
    nativeChatAgent: 'claude',
    nativeChatAgentWorking: false,
    nativeChatStreamLive: false,
    nativeChatStreamScopeKey: moment.surface ?? 'new-tab',
    chatPending: [],
    nativeChatSessionIdentity: null,
    chatImagePreviewsByMessageId: {},
    chatComposerText: moment.typed,
    setChatComposerText: moment.setter ?? vi.fn(),
    composerFocusRequest: moment.focusRequest ?? 0
  } as unknown as MobileNativeChatController
  return createElement(MobileNativeChatOverlay, {
    controller,
    hasTerminalUnderneath: true,
    ptyTab: true,
    onOpenFile: vi.fn(),
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
    sendSurfaceId: moment.surface ?? 'new-tab',
    getSendCompletionGeneration: () => 0,
    keyboardInset: moment.keyboard ?? 0
  })
}

describe('the composer of a freshly opened agent tab', () => {
  let root: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    vi.useRealTimers()
  })

  const open = (moment: Moment) =>
    act(() => {
      root = create(overlay(moment))
    })
  const show = (moment: Moment) =>
    act(() => {
      root!.update(overlay(moment))
    })
  const chat = () => {
    const views = root!.root.findAll((node) => (node.type as unknown) === 'ChatView')
    expect(views).toHaveLength(1)
    return views[0].props as Record<string, unknown>
  }

  it('shows each key typed straight after the tab opens, before the agent has a transcript', () => {
    vi.useFakeTimers()
    open({ typed: '' })
    expect(chat().composerText).toBe('')

    // Well inside the hold: the user taps the field and types at once.
    show({ typed: 'h' })
    expect(chat().composerText).toBe('h')
    show({ typed: 'hi' })
    expect(chat().composerText).toBe('hi')
  })

  it('writes each key through the draft setter of the current render, not a replayed one', () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const second = vi.fn()
    open({ typed: '', setter: first })
    show({ typed: '', setter: second })
    const write = chat().onComposerTextChange as (text: string) => void
    write('x')
    expect(second).toHaveBeenCalledWith('x')
    expect(first).not.toHaveBeenCalled()
  })

  it('still takes a focus request made while the tab is settling', () => {
    vi.useFakeTimers()
    open({ typed: '', focusRequest: 0 })
    show({ typed: '', focusRequest: 1 })
    expect(chat().composerFocusRequest).toBe(1)
  })

  it('lifts the composer above the keyboard a tap on the field raises while the tab settles', () => {
    vi.useFakeTimers()
    open({ typed: '', keyboard: 0 })
    show({ typed: '', keyboard: 320 })
    expect(chat().keyboardInset).toBe(320)
  })

  it('keeps the composer mounted while the tab settles, so the field keeps the keyboard', () => {
    vi.useFakeTimers()
    open({ typed: '' })
    const mounted = chatMounts.count
    show({ typed: 'a' })
    show({ typed: 'ab' })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    show({ typed: 'abc' })
    expect(chat().composerText).toBe('abc')
    expect(chatMounts.count).toBe(mounted)
  })

  it('degenerate: clearing the field back to empty during the hold shows it empty', () => {
    vi.useFakeTimers()
    open({ typed: 'draft' })
    show({ typed: '' })
    expect(chat().composerText).toBe('')
  })

  it('degenerate: a tab with no session and no surface id yet still draws what is typed', () => {
    vi.useFakeTimers()
    open({ typed: '', surface: '' })
    show({ typed: 'q', surface: '' })
    expect(chat().composerText).toBe('q')
  })
})

describe('typing through a reconnect blink over a chat', () => {
  let root: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
  })

  it('keeps drawing the old rows for the blink while the composer takes the new keys', () => {
    const prior = [assistantTurn('a1', 'Hello')]
    act(() => {
      root = create(overlay({ typed: 'wh', messages: prior, status: 'ready', surface: 'tab-a' }))
    })
    // The tab list re-hydrates: chat is neither shown nor eligible for a moment.
    act(() => {
      root!.update(overlay({ typed: 'wha', show: false, eligible: false, status: 'ready', surface: 'tab-a' }))
    })
    const views = root!.root.findAll((node) => (node.type as unknown) === 'ChatView')
    expect(views).toHaveLength(1)
    expect(views[0].props.messages).toEqual(prior)
    expect(views[0].props.composerText).toBe('wha')
  })
})
