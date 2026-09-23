import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_FRAME_HOLD_MS, useNativeChatFrame } from './use-native-chat-frame'

// The overlay's inputs at each moment, as MobileNativeChatOverlay derives them.
type Moment = {
  blank: boolean
  blink: boolean
  showNativeChat: boolean
  /** What a drawn chat would read, so a replayed frame is told apart from a fresh one. */
  chat: string
}

// A chat tab the reader is looking at.
const CHAT_ON: Moment = { blank: false, blink: false, showNativeChat: true, chat: 'old chat' }
// The reader switched this Claude tab to terminal mode: still chat-eligible, so not a blink.
const TERMINAL_CHOSEN: Moment = { blank: true, blink: false, showNativeChat: false, chat: '' }
// Ctrl+C twice ended Claude Code: the tab is no longer chat-eligible, which reads as a blink.
const AGENT_EXITED: Moment = { blank: true, blink: true, showNativeChat: false, chat: '' }
// Back to chat from the terminal: the transcript re-reads, empty until it lands.
const CHAT_RELOADING: Moment = { blank: true, blink: true, showNativeChat: true, chat: '' }
// A reconnect re-hydrates the tab list for a moment while chat is on screen.
const RECONNECT_BLIP: Moment = { blank: true, blink: true, showNativeChat: false, chat: '' }

function Overlay({ moment }: { moment: Moment }): React.JSX.Element | null {
  const { frame, held, remember } = useNativeChatFrame({
    blank: moment.blank,
    blink: moment.blink,
    showNativeChat: moment.showNativeChat,
    hasTerminalUnderneath: true,
    surfaceId: 'tab-1'
  })
  if (frame === 'hold') {
    return held
  }
  if (frame === 'terminal') {
    return null
  }
  const drawn = createElement('chat', null, moment.chat)
  remember(drawn)
  return drawn
}

function shown(root: ReactTestRenderer): string {
  const tree = root.toJSON()
  if (tree === null) {
    return 'terminal'
  }
  return Array.isArray(tree) ? 'many' : String(tree.children?.[0] ?? '')
}

describe('the chat overlay over a terminal tab', () => {
  let root: ReactTestRenderer
  const show = (moment: Moment) =>
    act(() => {
      root.update(createElement(Overlay, { moment }))
    })

  beforeEach(() => {
    vi.useFakeTimers()
    act(() => {
      root = create(createElement(Overlay, { moment: CHAT_ON }))
    })
  })
  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
  })

  it('keeps the terminal when Ctrl+C ends Claude Code in terminal mode, instead of flashing the old chat', () => {
    expect(shown(root)).toBe('old chat')
    show(TERMINAL_CHOSEN)
    expect(shown(root)).toBe('terminal')

    show(AGENT_EXITED)
    expect(shown(root)).toBe('terminal')
    act(() => vi.advanceTimersByTime(CHAT_FRAME_HOLD_MS))
    expect(shown(root)).toBe('terminal')
  })

  it('shows the chat it left, not a spinner, when going back to chat from the terminal', () => {
    show(TERMINAL_CHOSEN)
    expect(shown(root)).toBe('terminal')
    show(CHAT_RELOADING)
    expect(shown(root)).toBe('old chat')
    show({ ...CHAT_ON, chat: 'new chat' })
    expect(shown(root)).toBe('new chat')
  })

  it('keeps holding the chat through a reconnect blip during the reload after going back to chat', () => {
    show(TERMINAL_CHOSEN)
    show(CHAT_RELOADING)
    expect(shown(root)).toBe('old chat')
    show(RECONNECT_BLIP)
    expect(shown(root)).toBe('old chat')
    show({ ...CHAT_ON, chat: 'new chat' })
    expect(shown(root)).toBe('new chat')
  })

  it('still holds the chat across a reconnect blip while chat is on screen', () => {
    show(RECONNECT_BLIP)
    expect(shown(root)).toBe('old chat')
    show({ ...CHAT_ON, chat: 'new chat' })
    expect(shown(root)).toBe('new chat')
  })

  it('lets a blip that outlasts the hold go to the terminal, and never replays that chat after', () => {
    show(RECONNECT_BLIP)
    act(() => vi.advanceTimersByTime(CHAT_FRAME_HOLD_MS))
    expect(shown(root)).toBe('terminal')

    show(TERMINAL_CHOSEN)
    show(AGENT_EXITED)
    expect(shown(root)).toBe('terminal')
  })

  it('shows the terminal for a blink when no chat was ever drawn', () => {
    act(() => root.unmount())
    act(() => {
      root = create(createElement(Overlay, { moment: TERMINAL_CHOSEN }))
    })
    show(AGENT_EXITED)
    expect(shown(root)).toBe('terminal')
  })
})
