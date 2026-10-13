import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

// Reported 2026-10-13 on 0.9.131 (screenshot: an Antigravity tab, "Terminal 1"): an empty chat with
// a "Waiting for terminal…" composer, and under it the terminal's own key row and "Type a command…"
// bar. The tab was not a chat (the terminal bar only shows then), but no pane was mounted under the
// overlay, and the overlay's "nothing to yield to" rule drew itself. That rule is for agent-session
// tabs, which never have a pane; a PTY tab's terminal frame is always there to yield to.

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

function overlay(args: { ptyTab: boolean; chat: boolean }): ReturnType<typeof createElement> {
  const controller = {
    showNativeChat: args.chat,
    chatViewSelected: args.chat,
    activeChatEligible: args.chat,
    viewResolved: true,
    terminalPeekActive: false,
    nativeChatSession: { messages: [], status: 'ready', transcriptLoading: false },
    nativeChatAgent: args.chat ? 'claude' : null,
    nativeChatAgentWorking: false,
    nativeChatStreamLive: false,
    nativeChatStreamScopeKey: 'tab-ag',
    chatPending: [],
    nativeChatSessionIdentity: null,
    chatImagePreviewsByMessageId: {},
    chatComposerText: '',
    setChatComposerText: vi.fn(),
    composerFocusRequest: 0
  } as unknown as MobileNativeChatController
  return createElement(MobileNativeChatOverlay, {
    controller,
    // The pane has not mounted for the active tab.
    hasTerminalUnderneath: false,
    ptyTab: args.ptyTab,
    onOpenFile: vi.fn(),
    hostAllowsRewind: true,
    images: { attachments: [], removeAttachment: vi.fn(), videoFrameExtraction: null } as never,
    onMicPress: vi.fn(),
    micActive: false,
    dictationMode: 'toggle',
    onMicPressIn: vi.fn(),
    onMicPressOut: vi.fn(),
    inputLockReason: 'waiting',
    sendErrorMessage: null,
    onClearSendError: vi.fn(),
    sendSurfaceId: 'tab-ag',
    getSendCompletionGeneration: () => 0,
    keyboardInset: 0
  })
}

describe('the chat overlay over a terminal tab whose pane has not mounted', () => {
  let root: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
  })
  const chatViews = () => root!.root.findAll((node) => (node.type as unknown) === 'ChatView')

  it('draws no chat composer over a terminal tab that is not a chat', async () => {
    await act(async () => {
      root = create(overlay({ ptyTab: true, chat: false }))
    })
    expect(chatViews()).toHaveLength(0)
  })

  it('still draws a chat tab with no pane under it', async () => {
    await act(async () => {
      root = create(overlay({ ptyTab: true, chat: true }))
    })
    expect(chatViews()).toHaveLength(1)
  })

  it('still draws an agent-session tab, which never has a pane', async () => {
    // 0.5.69 (2026-09-14): yielding on an agent-session tab left the screen black.
    await act(async () => {
      root = create(overlay({ ptyTab: false, chat: false }))
    })
    expect(chatViews()).toHaveLength(1)
  })
})
