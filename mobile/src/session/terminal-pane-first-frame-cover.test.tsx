import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 0.9.132 (2026-10-13, screen recording): opening Terminal 1 showed the empty
 * session body, then the WebView's blank Tokyonight background, then the
 * terminal's text. The pane is now covered with the session canvas until its
 * first kept frame (terminal-first-frame-reveal.ts), so the body goes from
 * the canvas straight to the frame. The cover is painted over the WebView by
 * source order, not hidden with opacity: a WebView that is not drawn can stop
 * running the frames its first init waits on.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: { View: 'AnimatedView', createAnimatedComponent: (component: unknown) => component },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark'
}))
vi.mock('lucide-react-native', () => ({ AlertTriangle: 'AlertTriangle', X: 'X' }))
vi.mock('../terminal/TerminalWebView', () => ({ TerminalWebView: 'TerminalWebView' }))

const paneProps: Array<Record<string, unknown>> = []
vi.mock('./TerminalPaneView', async (importOriginal) => {
  const actual = await importOriginal<{ TerminalPaneView: never }>()
  return {
    TerminalPaneView: (props: Record<string, unknown>) => {
      paneProps.push(props)
      return createElement(actual.TerminalPaneView, props)
    }
  }
})
vi.mock('./MobileNativeChatOverlay', () => ({ MobileNativeChatOverlay: () => null }))
vi.mock('./MobileSessionPillRow', () => ({ MobileSessionPillRow: () => null }))
vi.mock('./MobileSubagentTranscriptModal', () => ({ MobileSubagentTranscriptModal: () => null }))
vi.mock('./MobileSubagentActivityFeeds', () => ({ MobileSubagentActivityFeeds: () => null }))
vi.mock('../browser/MobileBrowserPane', () => ({ MobileBrowserPane: () => null }))
vi.mock('./MobileSessionFileReader', () => ({ FileReader: () => null }))
vi.mock('./MobileSessionMarkdownReader', () => ({ MarkdownReader: () => null }))
vi.mock('../transport/host-mobile-capabilities', () => ({ useHostMobileCapability: () => false }))
vi.mock('./use-native-chat-file-reader', () => ({ useNativeChatFileReaderFor: () => null }))
vi.mock('./use-mobile-native-chat-created-file-counts', () => ({
  useMobileNativeChatCreatedFileCounts: () => new Map()
}))
vi.mock('../files/markdown-image-resolver', () => ({ createMarkdownImageResolver: () => undefined }))
vi.mock('../ui/Button', () => ({ Button: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileSessionActiveContent } from './MobileSessionActiveContent'
import type { MobileSessionController } from './use-mobile-session-controller'

const ANTIGRAVITY = 'pty-antigravity'
const CLAUDE = 'pty-claude'

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign(
    {},
    ...list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
  )
}

function controllerFor(activeHandle: string, revealed: string[]): MobileSessionController {
  const noop = () => undefined
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; every field the terminal branch reads is set here.
  return {
    hostId: 'host-1',
    worktreeId: 'wt-1',
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    connState: 'connected',
    client: null,
    terminals: [
      { handle: ANTIGRAVITY, title: 'Terminal 1' },
      { handle: CLAUDE, title: 'codeui' }
    ],
    terminalTextScale: 1,
    activeHandle,
    revealedTerminalHandles: new Set(revealed),
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
    activeSessionTab: { type: 'terminal', id: 'tab-1' },
    activeTerminalKeyboardLift: 0,
    keyboardLift: 0,
    terminalFrameHeightRef: { current: 0 },
    setTerminalFrameWidth: noop,
    notifyTerminalFrameHeight: noop,
    nativeChatController: {},
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
  paneProps.length = 0
})

function render(scheme: 'light' | 'dark', controller: MobileSessionController): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileSessionActiveContent controller={controller} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

/** The pane wrapping the WebView for `handle`, and the cover over it if one is drawn. */
function pane(root: ReactTestInstance, handle: string) {
  const webViews = root.findAll((node) => String(node.type) === 'TerminalWebView')
  const index = paneProps.slice(-2).findIndex((props) => props.handle === handle)
  const webView = webViews[index]!
  const wrapper = webView.parent!
  const siblings = wrapper.children.filter((child): child is ReactTestInstance => typeof child !== 'string')
  const cover = siblings.slice(siblings.indexOf(webView) + 1).find((node) => String(node.type) === 'View') ?? null
  return { wrapper, cover }
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])('opening a terminal tab in a %s session', (scheme, palette) => {
  const mode = scheme as 'light' | 'dark'

  it('covers the Antigravity pane with the session canvas until its first frame is kept', () => {
    const root = render(mode, controllerFor(ANTIGRAVITY, []))
    const { cover } = pane(root, ANTIGRAVITY)
    expect(cover).not.toBeNull()
    expect(flat(cover!.props.style)).toMatchObject({ position: 'absolute', backgroundColor: palette.bg })
    // Taps still reach the terminal under it.
    expect(cover!.props.pointerEvents).toBe('none')
  })

  it('shows the Claude pane, with no cover, once its first frame is kept', () => {
    const root = render(mode, controllerFor(CLAUDE, [CLAUDE]))
    expect(pane(root, CLAUDE).cover).toBeNull()
    // The pane is drawn, not faded: the WebView keeps its frames running.
    expect(flat(pane(root, CLAUDE).wrapper.props.style).opacity).not.toBe(0)
    // The tab beside it that never showed a frame is still covered.
    expect(pane(root, ANTIGRAVITY).cover).not.toBeNull()
  })

  it('lifts the cover the moment the WebView reports an engine error, so its message and Reload show', () => {
    const revealed: Array<[string, string]> = []
    const controller = controllerFor(ANTIGRAVITY, [])
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the double gains the one callback this case reads.
    ;(controller as unknown as Record<string, unknown>).revealTerminalFirstFrame = (handle: string, reason: string) =>
      revealed.push([handle, reason])
    const root = render(mode, controller)
    const webView = root.findAll((node) => String(node.type) === 'TerminalWebView')[0]!
    act(() => {
      ;(webView.props.onEngineError as (message: string) => void)('Terminal WebView load failed')
    })
    expect(revealed).toEqual([[ANTIGRAVITY, 'engine-error']])
  })
})
