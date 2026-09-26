import { useEffect, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A PDF that react-native-pdf cannot open, in a session file tab and in the file preview. The
// session draws its file tabs in `styles.markdownFrame` (MobileSessionActiveContent.tsx), which is
// on the static dark palette in both schemes, like the rest of the legacy session styles. The PDF
// viewer's error state had no surface of its own, so its live-theme red sat on that dark frame:
// #C0392B on #1A1917 in light mode, 3.2:1 (review of 6c19a3e0).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Share: { share: async () => {} },
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
    absoluteFillObject: {},
    flatten: (s: unknown) => s
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Icon',
  Copy: 'Icon',
  Download: 'Icon',
  MessageSquare: 'Icon',
  Send: 'Icon'
}))
vi.mock('../components/MobileHtmlPreview', () => ({ MobileHtmlPreview: 'MobileHtmlPreview' }))
vi.mock('./MobileSessionDiffLineRow', () => ({ DiffLineRow: 'DiffLineRow' }))
vi.mock('../files/MobileFileMarkdownPreview', () => ({ MobileFileMarkdownPreview: () => null }))
vi.mock('./MobileSessionFileReaderLineActionBar', () => ({
  MobileSessionFileReaderLineActionBar: () => null
}))
vi.mock('../files/mobile-pdf-download-device', () => ({ savePreviewedPdf: vi.fn() }))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }))
vi.mock('expo-file-system/legacy', () => ({}))
// The native view reports the document unreadable as soon as it mounts.
vi.mock('react-native-pdf', () => ({
  default: function UnreadablePdf(props: { onError?: () => void }) {
    useEffect(() => {
      props.onError?.()
    }, [props])
    return null
  }
}))

import { View } from 'react-native'
import { contrastRatio } from '../test/contrast'
import { ThemeProvider, useThemedStyles } from '../theme/theme-context'
import { colorsForScheme, type ThemeScheme } from '../theme/tokens'
import { MobileFilePdfPreview } from '../files/MobileFilePdfPreview'
import { filePreviewStyles } from '../files/mobile-file-preview-styles'
import { styles as sessionStyles } from './mobile-session-styles'
import { FileReader } from './MobileSessionFileReader'

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style as unknown
  const list = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
  return Object.assign({}, ...list)
}

async function renderIn(scheme: ThemeScheme, content: ReactNode): Promise<void> {
  await act(async () => {
    tree = create(<ThemeProvider initialPreference={scheme}>{content}</ThemeProvider>)
  })
  // The native view's onError lands in an effect after the first commit.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The message, its colour, and the surface it is drawn on: the nearest ancestor that paints one. */
function errorOnSurface(): { ink: string; surface: string } {
  const message = tree!.root.findAll(
    (node) => node.type === 'Text' && node.props.children === "Couldn't open this PDF"
  )[0]!
  let surface: string | null = null
  for (let node = message.parent; node && !surface; node = node.parent) {
    const background = typeof node.type === 'string' ? styleOf(node).backgroundColor : undefined
    if (typeof background === 'string') {
      surface = background
    }
  }
  return { ink: styleOf(message).color as string, surface: surface! }
}

/** The file preview screen's own page (MobileFilePreviewScreen draws its body in `container`). */
function PreviewPage({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(filePreviewStyles)
  return <View style={styles.container}>{children}</View>
}

describe('a PDF that will not open', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`says so readably inside a session file tab (${scheme})`, async () => {
      await renderIn(
        scheme,
        <View style={sessionStyles.markdownFrame}>
          <FileReader
            doc={{ status: 'ready', kind: 'pdf', uri: 'file:///cache/orca-pdf-1.pdf' }}
            title="paper.pdf"
            relativePath="docs/paper.pdf"
            language="plaintext"
            readingPositionKey={null}
          />
        </View>
      )

      const { ink, surface } = errorOnSurface()
      expect(contrastRatio(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      // The viewer's own page, as its loading state and the open document already have, not the
      // session frame showing through.
      expect(surface).toBe(colorsForScheme(scheme).bg)
    })

    it(`says so readably on the file preview's page (${scheme})`, async () => {
      await renderIn(
        scheme,
        <PreviewPage>
          <MobileFilePdfPreview uri="file:///cache/orca-pdf-1.pdf" fileName="docs/paper.pdf" />
        </PreviewPage>
      )

      const { ink, surface } = errorOnSurface()
      expect(contrastRatio(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(surface).toBe(colorsForScheme(scheme).bg)
    })
  }
})
