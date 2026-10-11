import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

// Reported 2026-10-11 on 0.9.128 (screenshot: a pasted screenshot's chip still in the composer,
// with its X, under the sent bubble that carried it, Claude tab with two background tasks).
// The chip store was empty: the send took the chip (image-chip-after-send-terminal.test.ts pins
// that for every way the send ends). What drew it was the chat overlay's hold
// (use-native-chat-frame.ts): a transcript that reloads empty, or a tab list re-hydrating, holds
// the last frame for up to CHAT_FRAME_HOLD_MS, and until 7bbcbac1b it replayed the remembered
// ELEMENT, built before the send took the chip. React bails out of an element it committed
// already, so the composer kept drawing the old chips (and text) for the hold. A tab with tasks
// running reloads often, so the stale chip came back again and again. Since 7bbcbac1b the hold
// lays the composer's live input, chips included, over the held rows (native-chat-held-frame.ts).

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

const CHIP: PendingNativeChatImage = { id: 'img-57', path: '/var/folders/0y/T/orca-paste-1.png', previewUri: 'file:///cache/paste-1.png' }

function row(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

type Moment = {
  typed: string
  chips: PendingNativeChatImage[]
  messages: NativeChatMessage[]
  status: 'loading' | 'ready'
  show?: boolean
}

function overlay(moment: Moment): ReturnType<typeof createElement> {
  const controller = {
    showNativeChat: moment.show ?? true,
    activeChatEligible: moment.show ?? true,
    viewResolved: true,
    terminalPeekActive: false,
    nativeChatSession: { messages: moment.messages, status: moment.status, transcriptLoading: moment.status !== 'ready' },
    nativeChatAgent: 'claude',
    nativeChatAgentWorking: true,
    nativeChatStreamLive: false,
    nativeChatStreamScopeKey: 'tab-a',
    chatPending: [],
    nativeChatSessionIdentity: null,
    chatImagePreviewsByMessageId: {},
    chatComposerText: moment.typed,
    setChatComposerText: vi.fn(),
    composerFocusRequest: 0
  } as unknown as MobileNativeChatController
  return createElement(MobileNativeChatOverlay, {
    controller,
    hasTerminalUnderneath: true,
    onOpenFile: vi.fn(),
    hostAllowsRewind: true,
    images: { attachments: moment.chips, removeAttachment: vi.fn(), videoFrameExtraction: null } as never,
    onMicPress: vi.fn(),
    micActive: false,
    dictationMode: 'toggle',
    onMicPressIn: vi.fn(),
    onMicPressOut: vi.fn(),
    inputLockReason: null,
    sendErrorMessage: null,
    onClearSendError: vi.fn(),
    sendSurfaceId: 'tab-a',
    getSendCompletionGeneration: () => 0,
    keyboardInset: 0
  })
}

describe('a sent photo’s chip and the chat’s hold', () => {
  let root: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    vi.useRealTimers()
  })
  const chat = () => {
    const views = root!.root.findAll((node) => (node.type as unknown) === 'ChatView')
    expect(views).toHaveLength(1)
    return views[0]!.props as Record<string, unknown>
  }
  const before = [row('u-0', 'user', 'earlier'), row('a-0', 'assistant', 'ok')]

  it('is not drawn again when the transcript reloads empty right after the send took it', () => {
    vi.useFakeTimers()
    act(() => {
      root = create(overlay({ typed: 'Am using latest released version', chips: [CHIP], messages: before, status: 'ready' }))
    })
    expect(chat().attachments).toEqual([CHIP])
    // The send takes the words and the chip; the transcript re-reads and comes back empty.
    act(() => {
      root!.update(overlay({ typed: '', chips: [], messages: [], status: 'loading' }))
    })
    expect(chat().attachments).toEqual([])
    expect(chat().composerText).toBe('')
    // The held rows are still the ones the chat showed.
    expect(chat().messages).toEqual(before)
  })

  it('is not drawn again through a tab-list blink either', () => {
    act(() => {
      root = create(overlay({ typed: 'x', chips: [CHIP], messages: before, status: 'ready' }))
    })
    act(() => {
      root!.update(overlay({ typed: '', chips: [], messages: before, status: 'ready', show: false }))
    })
    expect(chat().attachments).toEqual([])
  })

  it('degenerate: a chip added during the hold is drawn, and one never sent stays drawn', () => {
    act(() => {
      root = create(overlay({ typed: '', chips: [CHIP], messages: before, status: 'ready' }))
    })
    const added: PendingNativeChatImage = { ...CHIP, id: 'img-58' }
    act(() => {
      root!.update(overlay({ typed: '', chips: [CHIP, added], messages: [], status: 'loading' }))
    })
    expect(chat().attachments).toEqual([CHIP, added])
  })
})
