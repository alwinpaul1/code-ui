import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import type { ClaudeChatGate } from './use-claude-anthropic-transcript'
import type { MobileNativeChatController } from './use-mobile-native-chat-controller'

const frames = vi.hoisted(() => [] as Record<string, unknown>[])
const pushes = vi.hoisted(() => [] as string[])

vi.mock('expo-clipboard', () => ({ hasImageAsync: vi.fn(async () => false), getImageAsync: vi.fn(async () => null), setStringAsync: vi.fn() }))
vi.mock('expo-router', () => ({ router: { push: (route: string) => pushes.push(route) } }))
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}, flatten: (style: unknown) => style, hairlineWidth: 1 },
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  useColorScheme: () => 'light',
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default }
}))
vi.mock('./MobileNativeChatView', async () => {
  const { createElement: h } = await import('react')
  return {
    MobileNativeChatView: (props: Record<string, unknown>) => {
      frames.push(props)
      return h('ChatView', props)
    }
  }
})

import { MobileNativeChatOverlay } from './MobileNativeChatOverlay'
import { ThemeProvider } from '../theme/theme-context'
import { CLAUDE_SIGNED_OUT_LINE, CLAUDE_UNMATCHED_LINE } from './use-claude-anthropic-transcript'
import { ANTHROPIC_ACCOUNTS_ROUTE } from './open-anthropic-accounts'

const API_ROWS: NativeChatMessage[] = [
  { id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'from Anthropic' }], timestamp: 1, source: 'transcript' },
  { id: 'a1', role: 'assistant', blocks: [{ type: 'text', text: 'reply' }], timestamp: 2, source: 'transcript' }
]
/** A prompt the beacon carried from the desktop: Anthropic's copy already holds it as `u1`. */
const DESK_PROMPT: DesktopPrompt = { text: 'typed at the desk', at: 3, nonce: 'n1' } as DesktopPrompt

let renderer: ReactTestRenderer | null = null

function render(gate: ClaudeChatGate | undefined, agent: string, scheme: 'light' | 'dark' = 'light') {
  const controller = {
    showNativeChat: true,
    activeChatEligible: true,
    viewResolved: true,
    terminalPeekActive: false,
    nativeChatAnthropicGate: gate,
    nativeChatSession: { messages: API_ROWS, status: 'ready', transcriptLoading: false, hasMore: false, loadingEarlier: false, loadEarlier: () => undefined },
    nativeChatAgent: agent,
    nativeChatStructured: false,
    nativeChatAgentWorking: false,
    nativeChatStreamLive: false,
    nativeChatStreamScopeKey: 'tab:s',
    nativeChatSpinner: null,
    chatPending: [],
    chatWaitingPhotoSends: [],
    rememberEcho: vi.fn(),
    takeOwnSends: vi.fn(),
    nativeChatDesktopPrompts: [DESK_PROMPT],
    nativeChatQueuedMessages: [],
    nativeChatQueueReadable: true,
    nativeChatScreenSentPhotos: [],
    nativeChatAgentMessages: [],
    nativeChatScreenPeerNotices: [],
    nativeChatStatusAgentMessages: [],
    nativeChatPromptHook: true,
    chatImagePreviewsByMessageId: {},
    chatComposerText: '',
    setChatComposerText: vi.fn(),
    openNativeChatTerminal: vi.fn()
  } as unknown as MobileNativeChatController
  frames.length = 0
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider as never,
        { initialPreference: scheme },
        createElement(MobileNativeChatOverlay, {
          controller,
          hasTerminalUnderneath: true,
          ptyTab: true,
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
        } as never)
      )
    )
  })
  return controller
}

const lastFrame = () => frames[frames.length - 1]!
const texts = (tree: ReactTestRenderer) => tree.root.findAll((node: ReactTestInstance) => String(node.type) === 'Text').map((node) => node.props.children as string)
const drawnTexts = (props: Record<string, unknown>) =>
  [...(props.folded as NativeChatMessage[]), ...((props.pending as { text?: string }[]) ?? []).map((item) => ({ blocks: [{ type: 'text', text: item.text ?? '' }] }))].flatMap((row) =>
    (row.blocks as { type: string; text?: string }[]).filter((block) => block.type === 'text').map((block) => block.text)
  )

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  pushes.length = 0
})

describe('a Claude tab’s chat reads only Anthropic', () => {
  it('matched, it draws Anthropic’s rows and no desktop copy beside them', () => {
    render({ kind: 'matched', accountId: 'acct', sessionId: 'cse_x' }, 'claude')
    expect(drawnTexts(lastFrame())).toEqual(['from Anthropic', 'reply'])
  })

  it('a Codex tab is unchanged: the desktop’s prompt copy still draws', () => {
    render({ kind: 'off' }, 'codex')
    expect(drawnTexts(lastFrame())).toContain('typed at the desk')
  })

  it('signed out, the sign-in line and button stand in place of the chat, and the button opens the accounts screen', async () => {
    render({ kind: 'signed-out' }, 'claude')
    expect(frames).toHaveLength(0)
    expect(texts(renderer!)).toContain(CLAUDE_SIGNED_OUT_LINE)
    const button = renderer!.root.find((node: ReactTestInstance) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Sign in')
    await act(async () => {
      button.props.onPress()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(pushes).toEqual([ANTHROPIC_ACCOUNTS_ROUTE])
  })

  it('unmatched, it says the session is not on Anthropic and why, with the terminal one tap away', () => {
    const controller = render({ kind: 'unmatched', detail: 'none of 12 sessions holds this tab’s messages' }, 'claude')
    expect(frames).toHaveLength(0)
    expect(texts(renderer!)).toEqual(expect.arrayContaining([CLAUDE_UNMATCHED_LINE, 'none of 12 sessions holds this tab’s messages']))
    renderer!.root.find((node: ReactTestInstance) => node.props.accessibilityLabel === 'Open terminal').props.onPress()
    expect(controller.openNativeChatTerminal).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['light', '#F9F9F7'],
    ['dark', '#151515']
  ] as const)('the sign-in state follows the %s scheme, with no fixed colour', (scheme, chatBg) => {
    render({ kind: 'signed-out' }, 'claude', scheme)
    const gate = renderer!.root.find((node: ReactTestInstance) => node.props.testID === 'claude-anthropic-gate')
    expect(gate.props.style.backgroundColor).toBe(chatBg)
    const line = renderer!.root.find((node: ReactTestInstance) => String(node.type) === 'Text' && node.props.children === CLAUDE_SIGNED_OUT_LINE)
    expect(line.props.style.color).toBe(scheme === 'light' ? '#1E1C19' : '#F8F8F6')
  })
})
