import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The preview of a text file the desktop cut. For a 5 MB log Orca's `files.read` replies with the
// first 512 KiB, `truncated: true` and `byteLength: 524289`: readLocalMobileFile reads
// min(size, 512 KiB + 1) bytes and truncateMobileFilePreview reports the length of THAT, not of
// the file. The note said "File size: 512 KB" for every file over the cap. 8e5969a6 stopped the
// save from saying it and left the note (review of 6c19a3e0).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: 'GestureHandlerRootView'
}))
vi.mock('lucide-react-native', () => ({
  Check: 'Icon',
  Code: 'Icon',
  Copy: 'Icon',
  MessageSquare: 'Icon',
  Pencil: 'Icon',
  Send: 'Icon',
  WrapText: 'Icon',
  X: 'Icon'
}))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('./MobileFileImageZoom', () => ({ MobileFileImageZoom: () => null }))
vi.mock('./MobileFilePdfPreview', () => ({ MobileFilePdfPreview: () => null }))

import { contrastRatio } from '../test/contrast'
import { ThemeProvider } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { colorsForScheme } from '../theme/tokens'
import { MobileFilePreviewBody } from './MobileFilePreviewBody'
import type { MobileFilePreviewTextKind } from './mobile-file-preview-response'

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

/** Orca's reply for a 5 MB log (or a 5 MB README), through the preview the screen draws. */
function renderCutFile(scheme: 'light' | 'dark', kind: MobileFilePreviewTextKind, path: string) {
  act(() => {
    tree = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileFilePreviewBody
          preview={{
            status: 'ready',
            kind,
            content: 'x'.repeat(1000),
            truncated: true,
            byteLength: 512 * 1024 + 1
          }}
          relativePath={path}
          title={path}
          editable={false}
          draftContent=""
          saveError=""
          lineColumn={null}
          readingPositionKey={null}
          resolveImage={null}
          imageWidth={360}
          imageHeight={640}
          onDraftChange={() => {}}
          onImageError={() => {}}
          onRetry={null}
        />
      </ThemeProvider>
    )
  })
}

function textOf(node: ReactTestInstance): string {
  const children = node.props.children as unknown
  return (Array.isArray(children) ? children : [children])
    .filter((child) => typeof child === 'string' || typeof child === 'number')
    .join('')
}

function inkOf(node: ReactTestInstance): string {
  const style = node.props.style as unknown
  const list = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
  return (Object.assign({}, ...list) as { color: string }).color
}

/** The colour actually painted behind a node: the nearest ancestor that paints one. A text file's
 *  note sits on the code viewer's own surface (MobileCodeView), a Markdown file's on the page. */
function surfaceBehind(node: ReactTestInstance): string {
  for (let at = node.parent; at; at = at.parent) {
    const style = at.props.style as unknown
    const list = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
    const fill = (Object.assign({}, ...list) as { backgroundColor?: string }).backgroundColor
    if (fill) {
      return fill
    }
  }
  throw new Error('nothing paints behind the note')
}

function truncatedNote(): ReactTestInstance {
  const notes = tree!.root.findAll(
    (node) => String(node.type) === 'Text' && textOf(node).startsWith('Preview truncated')
  )
  expect(notes).toHaveLength(1)
  return notes[0]!
}

describe('the note over a preview the desktop cut', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const [kind, path] of [
      ['text', 'logs/run.log'],
      ['markdown', 'docs/README.md']
    ] as const) {
      it(`does not call a 5 MB ${kind} file 512 KB, and says what it shows (${scheme})`, () => {
        renderCutFile(scheme, kind, path)

        const note = truncatedNote()
        expect(textOf(note)).not.toMatch(/File size/)
        expect(textOf(note)).toBe('Preview truncated: showing the first 512 KB of the file.')
        const surface = surfaceBehind(note)
        // This scheme's page or its code surface, never the other scheme's.
        expect([colorsForScheme(scheme).bg, syntaxPaletteForScheme(scheme).surface]).toContain(surface)
        const ink = inkOf(note)
        expect(contrastRatio(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
