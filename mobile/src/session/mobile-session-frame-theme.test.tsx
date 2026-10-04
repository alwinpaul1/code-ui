import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The session screen's own frame in both themes. Four session components read a LEGACY `styles`
 * export pinned to the dark palette (`legacyDarkTheme` in mobile-session-styles.ts): the screen's
 * canvas (MobileSessionSurface), the content row, the frame a file, Markdown or browser tab sits in
 * and its toast (MobileSessionActiveContent), and the code viewer's page (MobileSessionFileSource).
 * In a light session all of them drew the dark canvas around light content. The terminal inside
 * the frame stays Tokyonight in both schemes; this is the app chrome around it.
 */

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: { View: 'AnimatedView' },
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
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ AlertTriangle: 'AlertTriangle', X: 'X' }))

// The frame's neighbours and contents render nothing of their own here: the test is about the
// surfaces these four components paint, not what sits in them.
vi.mock('./MobileSessionHeader', () => ({ MobileSessionHeader: () => null }))
vi.mock('./MobileSessionSheets', () => ({ MobileSessionSheets: () => null }))
vi.mock('./MobileFileTapMatchPicker', () => ({ MobileFileTapMatchPicker: () => null }))
vi.mock('./MobileSessionCommandDock', () => ({ MobileSessionCommandDock: () => null }))
vi.mock('./SessionDockColumn', () => ({ SessionDockColumn: () => null }))
vi.mock('./MobileSessionFileReader', () => ({ FileReader: () => null }))
vi.mock('./MobileSessionMarkdownReader', () => ({ MarkdownReader: () => null }))
vi.mock('../browser/MobileBrowserPane', () => ({ MobileBrowserPane: () => null }))
vi.mock('./TerminalPaneView', () => ({ TerminalPaneView: () => null }))
vi.mock('./MobileNativeChatOverlay', () => ({ MobileNativeChatOverlay: () => null }))
vi.mock('./MobileSubagentTranscriptModal', () => ({ MobileSubagentTranscriptModal: () => null }))
vi.mock('../transport/host-mobile-capabilities', () => ({ useHostMobileCapability: () => false }))
vi.mock('./use-mobile-native-chat-created-file-counts', () => ({
  useMobileNativeChatCreatedFileCounts: () => new Map()
}))
vi.mock('../files/markdown-image-resolver', () => ({
  createMarkdownImageResolver: () => undefined
}))
vi.mock('../ui/Button', () => ({ Button: () => null }))
vi.mock('../ui/IconButton', () => ({ IconButton: () => null }))
// The code viewer and the hooks around it (MobileSessionFileSource).
vi.mock('../components/MobileCodeView', () => ({ MobileCodeView: () => null }))
vi.mock('../components/use-code-folding', () => ({
  useCodeFolding: () => ({ coverFolds: (range: unknown) => range, shownLine: () => true })
}))
vi.mock('../components/use-code-line-selection', () => ({
  useCodeLineSelection: () => ({ open: false, range: null, clear: () => undefined, lineProps: {} })
}))
vi.mock('../components/use-copy-to-clipboard', () => ({
  copyFailedNotice: () => 'Copy failed',
  useCopyToClipboard: () => ({ error: null, copy: async () => true })
}))
vi.mock('./use-mobile-syntax-language', () => ({ useMobileSyntaxLanguage: () => 'plaintext' }))
vi.mock('./MobileSessionFileReaderLineActionBar', () => ({
  MobileSessionFileReaderLineActionBar: () => null
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileSessionActiveContent } from './MobileSessionActiveContent'
import { MobileSessionFileSource } from './MobileSessionFileSource'
import { MobileSessionSurface } from './MobileSessionSurface'
import type { MobileSessionController } from './use-mobile-session-controller'

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

/** Just enough controller for the frame to render the branch a test asks for. */
function controllerFor(overrides: Partial<MobileSessionController>): MobileSessionController {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test double; every field the rendered branch reads is set below or in `overrides`.
  return {
    hostId: 'host-1',
    worktreeId: 'wt-1',
    worktreeName: 'orca',
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    connState: 'connected',
    client: null,
    terminals: [],
    markdownDocs: new Map(),
    fileDocs: new Map(),
    diffComments: [],
    activePanel: null,
    canDockPanel: false,
    createWarning: '',
    toastMessage: '',
    toastAnimatedStyle: {},
    showLoadingState: false,
    showEmptyState: false,
    activeMarkdownTab: null,
    activeFileTab: null,
    activeBrowserTab: null,
    activePendingTerminalTab: null,
    setMobileSessionRootRef: () => undefined,
    handleSessionContentRowLayout: () => undefined,
    fileTapMatchPicker: null,
    ...overrides
  } as unknown as MobileSessionController
}

const FILE_TAB = {
  type: 'file',
  id: 'file-1',
  title: 'notes.txt',
  relativePath: 'docs/notes.txt',
  language: 'plaintext'
}

const BROWSER_TAB = {
  type: 'browser',
  id: 'browser-1',
  browserPageId: 'page-1',
  url: 'https://example.com/'
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(
  scheme: 'light' | 'dark',
  element: ReturnType<typeof createElement>
): ReactTestInstance {
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{element}</ThemeProvider>)
  })
  return renderer!.root
}

const hosts = (root: ReactTestInstance, type: string) =>
  root.findAll((node) => String(node.type) === type)

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as [string, ThemeColors][])('the session frame in a %s session', (scheme, palette) => {
  const mode = scheme as 'light' | 'dark'

  it('paints the session screen canvas from the theme', () => {
    const root = render(
      mode,
      createElement(MobileSessionSurface, { controller: controllerFor({ showLoadingState: true }) })
    )
    expect(flat(hosts(root, 'View')[0]!.props.style).backgroundColor).toBe(palette.bg)
  })

  it('paints the frame an open file tab sits in, and the toast over it, from the theme', () => {
    const root = render(
      mode,
      createElement(MobileSessionActiveContent, {
        controller: controllerFor({
          activeFileTab: FILE_TAB as never,
          toastMessage: 'Copied 3 lines'
        })
      })
    )
    expect(flat(hosts(root, 'View')[0]!.props.style).backgroundColor).toBe(palette.bg)
    const toast = root.find(
      (node) => String(node.type) === 'Text' && node.props.children === 'Copied 3 lines'
    )
    expect(flat(toast.props.style)).toMatchObject({
      color: palette.text,
      backgroundColor: palette.bgRaised,
      borderColor: palette.border
    })
  })

  it('paints the frame an open browser tab sits in from the theme', () => {
    const root = render(
      mode,
      createElement(MobileSessionActiveContent, {
        controller: controllerFor({ activeBrowserTab: BROWSER_TAB as never })
      })
    )
    expect(flat(hosts(root, 'View')[0]!.props.style).backgroundColor).toBe(palette.bg)
  })

  it("paints the code viewer's page from the theme", () => {
    const root = render(
      mode,
      createElement(MobileSessionFileSource, {
        content: 'hello\n',
        language: 'plaintext',
        title: 'notes.txt',
        relativePath: 'docs/notes.txt'
      })
    )
    expect(flat(hosts(root, 'View')[0]!.props.style).backgroundColor).toBe(palette.bg)
  })
})
