import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBrowserPaneView } from './MobileBrowserPaneView'
import type { MobileBrowserTab } from './MobileBrowserPane'

// The in-app browser's own chrome (toolbar, address field, key row) imported the LEGACY static
// (dark-only) palette from mobile-theme. The web PAGE inside stays the site's own content, but the
// chrome around it follows the theme like any other screen.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: {
    absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    create: (styles: unknown) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Monitor: 'Monitor',
  RefreshCw: 'RefreshCw',
  Smartphone: 'Smartphone'
}))

const TAB: MobileBrowserTab = {
  type: 'browser',
  id: 'tab-1',
  title: 'Example',
  browserWorkspaceId: 'bw-1',
  browserPageId: 'page-1',
  url: 'https://example.com/',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  isActive: true
}

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

function paneProps(overrides: Record<string, unknown>) {
  return {
    addressFocused: false,
    addressValue: 'https://example.com',
    bottomInset: 0,
    browserLayerRef: () => () => undefined,
    browserViewMode: 'web',
    busy: false,
    controlsDisabled: false,
    dialog: null,
    error: null,
    frameGeometry: null,
    frameLayerErrorHandler: () => () => undefined,
    frameLayerLoadHandler: () => () => undefined,
    frameLayerRef: () => () => undefined,
    frameLayerStyle: () => ({}),
    goBack: () => undefined,
    goForward: () => undefined,
    keyboardLift: 0,
    keyboardValue: '',
    layoutRef: { current: null },
    navigateToAddress: async () => undefined,
    panResponder: { panHandlers: {} } as never,
    pointerModifiers: [],
    reloadPage: () => undefined,
    renderedFrameSource: null,
    selectBrowserViewMode: () => undefined,
    sendDialogCommand: async () => undefined,
    sendKeyboardText: async () => undefined,
    sendKeypress: async () => undefined,
    setAddressFocused: () => undefined,
    setAddressValue: () => undefined,
    setKeyboardValue: () => undefined,
    setLayout: () => undefined,
    setRootViewRef: () => undefined,
    tab: TAB,
    togglePointerModifier: () => undefined,
    zoom: { scale: 1, offsetX: 0, offsetY: 0 },
    ...overrides
  }
}

describe('the in-app browser toolbar', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(scheme: 'light' | 'dark', overrides: Record<string, unknown> = {}) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(MobileBrowserPaneView, paneProps(overrides) as never)}
        </ThemeProvider>
      )
    })
    return renderer!.root
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the toolbar and address field from the %s theme', (scheme, palette) => {
    render(scheme)
    const toolbar = renderer!.root.findByProps({ testID: 'mobile-browser-toolbar' })
    expect(styleOf(toolbar).backgroundColor).toBe(palette.bgPanel)
    const addressInput = renderer!.root
      .findAllByType('TextInput' as never)
      .find((node) => node.props.placeholder === 'URL')
    expect(addressInput).toBeDefined()
    expect(styleOf(addressInput!).color).toBe(palette.text)
    expect(styleOf(addressInput!).backgroundColor).toBe(palette.bgRaised)
  })

  // The busy/error scrim is drawn over the website's own pixels, which the app does not theme, so
  // it is one fixed tint in both schemes, like the terminal's content. `colors.shadow` was tried
  // and made the same page read heavier in dark (50% black) than in light (18% ink).
  it.each(['light', 'dark'] as const)(
    'tints a loading page with the same scrim and a fixed light spinner in %s',
    (scheme) => {
      const root = render(scheme, {
        busy: true,
        renderedFrameSource: { uri: 'data:image/jpeg;base64,AAAA' },
        frameGeometry: null
      })
      const spinner = root.findByType('ActivityIndicator' as never)
      // The scrim is the spinner's own container, drawn over the whole viewport.
      expect(styleOf(spinner.parent!).backgroundColor).toBe('rgba(13, 15, 24, 0.2)')
      expect(spinner.props.color).toBe('#B8B4AB')
    }
  )

  // Before the first frame there is no page under the scrim, only the viewport's own themed
  // canvas: a fixed light spinner there read 1.18:1 on the light canvas, so it follows the theme.
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'shows a readable spinner on the %s canvas before the first frame',
    (scheme, palette) => {
      const root = render(scheme, { renderedFrameSource: null })
      const spinner = root.findByType('ActivityIndicator' as never)
      expect(styleOf(spinner.parent!).backgroundColor).toBe('rgba(13, 15, 24, 0.2)')
      expect(spinner.props.color).toBe(palette.textSecondary)
    }
  )
})
