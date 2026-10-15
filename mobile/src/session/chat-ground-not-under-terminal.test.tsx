import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 2026-10-14, the S23 on 0.9.146 (screenshot, dark, "Why like this on some other tab"): one
// Claude Code tab, Working, "Queue a message…", drew its whole chat body in the terminal's
// Tokyonight navy (#1A1B26 as captured, terminalBg) instead of the chat's #151515, while every
// word, the user bubble and the composer drew normally on top. The other tabs were #151515.
//
// Navy exists only in the terminal pane: TerminalWebView's frame View (and its WebView) paint
// terminalBg. For it to show between the chat's ground and the chat's words, something of the
// terminal had to be drawn after the ground and before the words. On Android that is possible
// because none of them were in a native view of their own (android-fabric-native-parent.test-support.ts):
//
// - The chat's box (the overlay's absolute-fill View) and the chat's root (backgroundColor
//   chatBg, onLayout) form no stacking context, so Fabric made the root a childless view with a
//   background and mounted every view the chat draws, one by one, into the terminal frame.
// - The ACTIVE terminal pane forms no stacking context either (no opacity, no transform), so
//   its frame View and WebView were mounted into that same terminal frame. An inactive pane
//   (opacity 0) or a lifted one (translateY) does keep them, so every tab switch and every
//   keyboard lift moved the terminal's views between the pane and the frame — the frame that
//   also held the chat's ground and the chat's words as loose siblings, so a move landing at the
//   wrong index put navy between them (the same family of mount move as react-native#57800 and
//   the empty user bubble on 0.9.145, mobile-native-chat-user-bubble-native-parent.test.tsx).
//
// Which index the phone got wrong was not caught (no log came with it). What this pins is the
// shape that makes the screenshot impossible: the chat's ground and everything drawn on it live
// in one native view that holds nothing of the terminal, and the terminal's views stay in their
// own pane whatever the tab or the keyboard does.

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Animated: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
    AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: 'Pressable',
    StyleSheet: {
      absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
      create: (styles: unknown) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1
    },
    Text: 'Text',
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    useColorScheme: () => 'dark'
  }
})
vi.mock('expo-clipboard', () => ({
  hasImageAsync: vi.fn(async () => false),
  getImageAsync: vi.fn(async () => null),
  setStringAsync: vi.fn()
}))
vi.mock('lucide-react-native', () => ({ AlertTriangle: 'AlertTriangle', X: 'X' }))
// The real frame TerminalWebView draws: a View in the terminal's colour holding the WebView.
vi.mock('../terminal/TerminalWebView', async () => {
  const React = await import('react')
  const { TERMINAL_WEBVIEW_FRAME_STYLES } = await import('../terminal/terminal-webview-frame-styles')
  return {
    TerminalWebView: () =>
      React.createElement(
        'View',
        { style: [TERMINAL_WEBVIEW_FRAME_STYLES.container, { flex: 1 }] },
        React.createElement('RNCWebView', { style: TERMINAL_WEBVIEW_FRAME_STYLES.webview })
      )
  }
})
// The chat view's own root, with its real style, a row of words and the dock.
vi.mock('./MobileNativeChatView', async () => {
  const React = await import('react')
  const { useChatViewStyles } = await import('./mobile-native-chat-view-styles')
  return {
    MobileNativeChatView: () => {
      const styles = useChatViewStyles()
      return React.createElement(
        'View',
        { style: styles.root, onLayout: () => undefined },
        React.createElement('Text', null, 'Ship it'),
        React.createElement('View', { style: styles.dock, pointerEvents: 'box-none' },
          React.createElement('Text', null, 'Queue a message…'))
      )
    }
  }
})
vi.mock('./MobileSessionPillRow', () => ({ MobileSessionPillRow: () => null }))
vi.mock('./MobileNativeChatConnectionRow', () => ({
  MobileNativeChatConnectionRow: () => null,
  NativeChatConnectionNoticeProvider: ({ children }: { children: ReactNode }) => children
}))
vi.mock('./MobileNativeChatRateLimitBanner', () => ({ MobileNativeChatRateLimitBanner: () => null }))
vi.mock('./MobileSubagentTranscriptModal', () => ({ MobileSubagentTranscriptModal: () => null }))
vi.mock('./MobileSubagentActivityFeeds', () => ({ MobileSubagentActivityFeeds: () => null }))
vi.mock('../browser/MobileBrowserPane', () => ({ MobileBrowserPane: () => null }))
vi.mock('./MobileSessionFileReader', () => ({ FileReader: () => null }))
vi.mock('./MobileSessionMarkdownReader', () => ({ MarkdownReader: () => null }))
vi.mock('../transport/host-mobile-capabilities', () => ({ useHostMobileCapability: () => false }))
vi.mock('./use-native-chat-file-reader', () => ({ useNativeChatFileReaderFor: () => null }))
vi.mock('./use-mobile-native-chat-created-file-counts', () => ({
  useMobileNativeChatCreatedFileCounts: () => null
}))
vi.mock('../files/markdown-image-resolver', () => ({ createMarkdownImageResolver: () => undefined }))
vi.mock('../ui/Button', () => ({ Button: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { androidNativeParent } from '../test/android-fabric-native-parent.test-support'
import { MobileSessionActiveContent } from './MobileSessionActiveContent'
import type { MobileSessionController } from './use-mobile-session-controller'

const OTHER = 'pty-other'
const CLAUDE = 'pty-claude'

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign(
    {},
    ...list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
  )
}

function hostParent(node: ReactTestInstance): ReactTestInstance | null {
  let parent = node.parent
  while (parent && typeof parent.type !== 'string') {
    parent = parent.parent
  }
  return parent
}

function within(node: ReactTestInstance, root: ReactTestInstance): boolean {
  for (let up: ReactTestInstance | null = node; up; up = hostParent(up)) {
    if (up === root) {
      return true
    }
  }
  return false
}

function controllerFor(activeHandle: string, keyboardLift: number): MobileSessionController {
  const noop = () => undefined
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; every field the terminal branch and the overlay read is set here.
  return {
    hostId: 'host-1',
    worktreeId: 'wt-1',
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    connState: 'connected',
    client: null,
    terminals: [
      { handle: OTHER, title: 'Terminal 1' },
      { handle: CLAUDE, title: 'ADB device on …' }
    ],
    terminalTextScale: 1,
    activeHandle,
    revealedTerminalHandles: new Set([OTHER, CLAUDE]),
    markdownDocs: new Map(),
    fileDocs: new Map(),
    diffComments: [],
    toastMessage: '',
    toastAnimatedStyle: {},
    showLoadingState: false,
    showEmptyState: false,
    activeMarkdownTab: null,
    activeFileTab: null,
    activeBrowserTab: null,
    activePendingTerminalTab: null,
    activeSessionTab: { type: 'terminal', id: 'tab-claude' },
    activeTerminalKeyboardLift: keyboardLift,
    keyboardLift,
    terminalFrameHeightRef: { current: 0 },
    setTerminalFrameWidth: noop,
    notifyTerminalFrameHeight: noop,
    nativeChatScopeKey: 'tab-claude',
    getSendCompletionGeneration: () => 0,
    nativeChatController: {
      showNativeChat: true,
      chatViewSelected: true,
      activeChatEligible: true,
      viewResolved: true,
      terminalPeekActive: false,
      nativeChatSession: { messages: [], status: 'ready', transcriptLoading: false },
      nativeChatAgent: 'claude',
      nativeChatAgentWorking: true,
      nativeChatStreamLive: false,
      nativeChatStreamScopeKey: 'tab-claude',
      chatPending: [],
      nativeChatSessionIdentity: null,
      chatImagePreviewsByMessageId: {},
      chatComposerText: '',
      setChatComposerText: noop,
      composerFocusRequest: 0
    },
    nativeChatImages: { attachments: [], removeAttachment: noop, videoFrameExtraction: null },
    nativeChatSendError: { message: null, clear: noop, show: noop },
    dictation: { isRecording: false },
    composerCursorRef: { current: null },
    setTerminalWebViewRef: noop,
    handleTerminalWebReady: noop
  } as unknown as MobileSessionController
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(scheme: 'light' | 'dark', controller: MobileSessionController): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}><MobileSessionActiveContent controller={controller} /></ThemeProvider>
    )
  })
  return renderer!.root
}

function update(scheme: 'light' | 'dark', controller: MobileSessionController): void {
  act(() => {
    renderer!.update(
      <ThemeProvider initialPreference={scheme}><MobileSessionActiveContent controller={controller} /></ThemeProvider>
    )
  })
}

const hosts = (root: ReactTestInstance) => root.findAll((node) => typeof node.type === 'string')

function chatGround(root: ReactTestInstance, palette: ThemeColors): ReactTestInstance {
  const grounds = hosts(root).filter(
    (node) => String(node.type) === 'View' && flat(node.props.style).backgroundColor === palette.chatBg && node.props.onLayout
  )
  expect(grounds).toHaveLength(1)
  return grounds[0]!
}

/** The terminal's navy frames, one per pane, with the pane each one belongs to. */
function terminalFrames(root: ReactTestInstance): ReactTestInstance[] {
  return hosts(root).filter(
    (node) => String(node.type) === 'View' && flat(node.props.style).backgroundColor === darkColors.terminalBg
  )
}

function paneOf(frame: ReactTestInstance): ReactTestInstance {
  // The pane is the absolute-fill View TerminalPaneView draws around the WebView.
  let up = hostParent(frame)
  while (up && flat(up.props.style).position !== 'absolute') {
    up = hostParent(up)
  }
  return up!
}

function expectChatDrawnInItsOwnView(root: ReactTestInstance, palette: ThemeColors, when: string): void {
  const ground = chatGround(root, palette)
  const groundParent = androidNativeParent(ground, hostParent)
  expect(groundParent !== null, `${when}: the chat's ground has no native parent`).toBe(true)
  // Nothing of the terminal is mounted into, or anywhere below, the native view that holds the
  // chat's ground, so nothing of it can be drawn between that ground and the words on it.
  for (const frame of terminalFrames(root)) {
    const frameParent = androidNativeParent(frame, hostParent)
    expect(within(frameParent!, groundParent!), `${when}: a terminal frame is mounted in the chat's view`).toBe(false)
  }
  for (const words of ['Ship it', 'Queue a message…']) {
    const text = root.find((node) => String(node.type) === 'Text' && node.props.children === words)
    const parent = androidNativeParent(text, hostParent)
    expect(parent && within(parent, groundParent!), `${when}: "${words}" is mounted outside the chat's view`).toBe(true)
  }
  // And that ground is the chat's own opaque colour, not the terminal's.
  expect(flat(ground.props.style).backgroundColor).toBe(palette.chatBg)
  expect(palette.chatBg).not.toBe(darkColors.terminalBg)
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])('a Claude Code chat tab over its terminal, %s', (scheme, palette) => {
  const mode = scheme as 'light' | 'dark'

  it('never shows the terminal navy through the chat body, on the tab or after switching to it', () => {
    const root = render(mode, controllerFor(CLAUDE, 0))
    expectChatDrawnInItsOwnView(root, palette, 'on the tab')
    update(mode, controllerFor(OTHER, 0))
    expectChatDrawnInItsOwnView(root, palette, 'after switching away')
    update(mode, controllerFor(CLAUDE, 0))
    expectChatDrawnInItsOwnView(root, palette, 'after switching back')
    update(mode, controllerFor(CLAUDE, 320))
    expectChatDrawnInItsOwnView(root, palette, 'with the keyboard up')
  })

  it('keeps each terminal frame in its own pane through tab switches and the keyboard', () => {
    const root = render(mode, controllerFor(CLAUDE, 0))
    const states: Array<[string, MobileSessionController]> = [
      ['active', controllerFor(CLAUDE, 0)],
      ['inactive', controllerFor(OTHER, 0)],
      ['active, keyboard up', controllerFor(CLAUDE, 320)],
      ['active, keyboard down', controllerFor(CLAUDE, 0)]
    ]
    for (const [when, controller] of states) {
      update(mode, controller)
      const frames = terminalFrames(root)
      expect(frames).toHaveLength(2)
      for (const frame of frames) {
        expect(androidNativeParent(frame, hostParent) === paneOf(frame), `${when}: a terminal frame left its pane`).toBe(true)
      }
    }
  })
})
