import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The whole file preview in light and in dark: the header (themed since the Save to phone commit)
// and everything under it. The page, the loading and error states, the source text, the image
// surface and the editor used to be the static dark palette, so in light mode the preview opened as
// a light header over a dark page.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Image: 'Image',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'Icon', Download: 'Icon', Save: 'Icon' }))
vi.mock('../navigation/route-handoff', () => ({
  useRouteHandoff: () => ({ back: () => {}, canGoBack: () => false })
}))
vi.mock('../components/ConfirmModal', () => ({ ConfirmModal: () => null }))
vi.mock('./MobileFileImageZoom', () => ({ MobileFileImageZoom: () => null }))
vi.mock('./MobileFileMarkdownPreview', () => ({ MobileFileMarkdownPreview: () => null }))
vi.mock('./MobileFilePdfPreview', () => ({ MobileFilePdfPreview: () => null }))
vi.mock('./mobile-pdf-cache', () => ({ resolveMobilePdfUri: vi.fn() }))
vi.mock('./mobile-file-save-device', () => ({
  isSaveToPhoneSupported: true,
  saveDesktopFileToPhoneOnDevice: vi.fn()
}))
vi.mock('../transport/client-context-connection-metrics', () => ({
  useLastConnectedAt: () => null
}))
const connection = vi.hoisted(() => ({
  current: {
    client: { sendRequest: () => new Promise(() => {}) } as unknown,
    state: 'connected',
    clientId: null
  }
}))
vi.mock('../transport/client-context', () => ({
  // A host that can be re-dialled, so a waiting load offers Retry.
  useForceReconnect: () => () => {},
  useHostClient: () => connection.current
}))

import { MobileSyntaxSegments } from '../components/MobileSyntaxSegments'
import type { MobileSyntaxTokenKind } from '../session/mobile-file-syntax'
import { colors as staticDarkPalette } from '../theme/mobile-theme'
import { ThemeProvider } from '../theme/theme-context'
import { colorsForScheme } from '../theme/tokens'
import { MobileFilePreviewBody } from './MobileFilePreviewBody'
import type { MobileFilePreviewResult } from './mobile-file-preview-request'
import { MobileFilePreviewScreen } from './MobileFilePreviewScreen'

type Scheme = 'light' | 'dark'
const SCHEMES: readonly Scheme[] = ['light', 'dark']

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  connection.current = {
    client: { sendRequest: () => new Promise(() => {}) },
    state: 'connected',
    clientId: null
  }
})

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style as unknown
  const list = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
  return Object.assign({}, ...list)
}

type Role = 'surface' | 'ink' | 'line'
/** Asked by role, because the palettes reuse values across roles: light's ink #1E1C19 is the
 *  static dark palette's editor surface, so "is it in the light palette" alone passes a dark page. */
const ROLES: Record<Role, readonly (keyof ReturnType<typeof colorsForScheme>)[]> = {
  surface: ['bg', 'bgPanel', 'bgRaised', 'bgSunken', 'codeBg'],
  ink: ['text', 'textSecondary', 'textMuted', 'danger'],
  line: ['border', 'borderStrong']
}

/** Which theme a colour comes from in that role; "neither" for a colour from no theme at all. */
function schemeOf(color: unknown, role: Role): string {
  for (const scheme of SCHEMES) {
    const palette = colorsForScheme(scheme)
    if (ROLES[role].some((key) => palette[key] === color)) {
      return scheme
    }
  }
  return `neither (${String(color)})`
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}

async function renderScreen(scheme: Scheme): Promise<ReactTestRenderer> {
  await act(async () => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileFilePreviewScreen
          route={{
            ok: true,
            params: { hostId: 'host-a', worktreeId: 'wt-1', relativePath: 'src/app.ts' }
          }}
        />
      </ThemeProvider>
    )
  })
  return tree!
}

function renderBody(
  scheme: Scheme,
  preview: MobileFilePreviewResult,
  editable = false
): ReactTestRenderer {
  act(() => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileFilePreviewBody
          preview={preview}
          relativePath="src/app.ts"
          title="app.ts"
          editable={editable}
          draftContent="const answer = 42"
          saveError={editable ? 'Waiting for desktop...' : ''}
          lineColumn={null}
          readingPositionKey={null}
          resolveImage={null}
          imageWidth={360}
          imageHeight={640}
          onDraftChange={() => {}}
          onImageError={() => {}}
          onRetry={() => {}}
        />
      </ThemeProvider>
    )
  })
  return tree!
}

function byType(rendered: ReactTestRenderer, type: string): ReactTestInstance[] {
  return rendered.root.findAll((node) => String(node.type) === type)
}

describe('the file preview follows the appearance setting, header and page alike', () => {
  for (const scheme of SCHEMES) {
    it(`paints its header and the page under it from the ${scheme} theme`, async () => {
      const rendered = await renderScreen(scheme)
      const page = byType(rendered, 'View')[0]!
      const header = byType(rendered, 'SafeAreaView')[0]!

      expect({
        header: schemeOf(styleOf(header).backgroundColor, 'surface'),
        page: schemeOf(styleOf(page).backgroundColor, 'surface')
      }).toEqual({ header: scheme, page: scheme })
    })

    it(`shows its loading state in ${scheme} colours`, async () => {
      const rendered = await renderScreen(scheme)
      const spinner = byType(rendered, 'ActivityIndicator')[0]!
      const label = rendered.root.findAll(
        (node) => String(node.type) === 'Text' && node.props.children === 'Loading preview...'
      )[0]!

      expect(schemeOf(spinner.props.color, 'ink')).toBe(scheme)
      expect(schemeOf(styleOf(label).color, 'ink')).toBe(scheme)
    })

    it(`shows a load that is waiting for the desktop in ${scheme} colours`, async () => {
      connection.current = { client: null, state: 'reconnecting', clientId: null }
      const rendered = await renderScreen(scheme)
      const message = rendered.root.findAll(
        (node) => String(node.type) === 'Text' && node.props.children === 'Waiting for desktop...'
      )[0]!
      const retry = byType(rendered, 'Pressable').find(
        (node) => styleOf(node).borderColor !== undefined
      )!

      expect(schemeOf(styleOf(message).color, 'ink')).toBe(scheme)
      expect(schemeOf(styleOf(retry).borderColor, 'line')).toBe(scheme)
    })

    it(`draws a source file on the ${scheme} page, every token readable on it`, () => {
      const rendered = renderBody(scheme, {
        status: 'ready',
        kind: 'text',
        content: '// the answer\nexport const answer: number = 42\nconst name = "orca"\n',
        truncated: false,
        byteLength: 64
      })
      const scroller = byType(rendered, 'ScrollView')[0]!
      const surface = styleOf(scroller).backgroundColor as string
      const tokenColors = [
        ...new Set(
          scroller
            .findAll((node) => String(node.type) === 'Text')
            .map((node) => styleOf(node).color)
            .filter((color): color is string => typeof color === 'string')
        )
      ]

      expect(schemeOf(surface, 'surface')).toBe(scheme)
      expect(tokenColors.length).toBeGreaterThan(2)
      for (const color of tokenColors) {
        expect(contrast(color, surface), `${color} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`edits an artifact on a ${scheme} surface in ${scheme} text`, () => {
      const rendered = renderBody(
        scheme,
        { status: 'ready', kind: 'text', content: 'x', truncated: false, byteLength: 1 },
        true
      )
      const input = byType(rendered, 'TextInput')[0]!
      const surface = input.parent!
      const error = rendered.root.findAll(
        (node) => String(node.type) === 'Text' && node.props.children === 'Waiting for desktop...'
      )[0]!

      expect(schemeOf(styleOf(surface).backgroundColor, 'surface')).toBe(scheme)
      expect(schemeOf(styleOf(input).color, 'ink')).toBe(scheme)
      expect(schemeOf(styleOf(error).color, 'ink')).toBe(scheme)
    })

    it(`shows an image on a ${scheme} surface`, () => {
      const rendered = renderBody(scheme, {
        status: 'ready',
        kind: 'image',
        dataUri: 'data:image/png;base64,iVBORw0KGgo='
      })

      expect(schemeOf(styleOf(byType(rendered, 'View')[0]!).backgroundColor, 'surface')).toBe(
        scheme
      )
    })
  }
})

describe('the syntax colours under the source text', () => {
  const KINDS: readonly MobileSyntaxTokenKind[] = [
    'plain',
    'comment',
    'keyword',
    'string',
    'number',
    'type',
    'function',
    'variable',
    'meta'
  ]

  function tokenColors(scheme?: Scheme): string[] {
    act(() => {
      tree = create(
        <MobileSyntaxSegments
          segments={KINDS.map((kind) => ({ kind, text: kind }))}
          {...(scheme ? { scheme } : {})}
        />
      )
    })
    return byType(tree!, 'Text').map((node) => styleOf(node).color as string)
  }

  it('reads at 4.5:1 or better on every light surface a light page uses', () => {
    const light = colorsForScheme('light')
    for (const color of tokenColors('light')) {
      for (const surface of [light.bg, light.codeBg, light.bgPanel]) {
        expect(contrast(color, surface), `${color} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('stays the dark editor palette where no scheme is asked for, as the dark-surface readers need', () => {
    // The session file reader, diffs and fenced blocks draw on the static dark editor surface in
    // both themes; the light palette there would be dark ink on a dark page.
    expect(tokenColors()).toEqual([
      staticDarkPalette.textPrimary,
      staticDarkPalette.syntaxComment,
      staticDarkPalette.syntaxKeyword,
      staticDarkPalette.syntaxString,
      staticDarkPalette.syntaxNumber,
      staticDarkPalette.syntaxType,
      staticDarkPalette.syntaxFunction,
      staticDarkPalette.syntaxVariable,
      staticDarkPalette.syntaxMeta
    ])
    expect(tokenColors('dark')).toEqual(tokenColors())
  })
})
