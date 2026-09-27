// A single diff line, in both themes. Before the theme-review fix this file kept its own
// module-level StyleSheet.create built from the static dark palette (`../theme/mobile-theme`),
// so the added/deleted row tints and the active-hunk accent stayed dark-palette colours on a
// light session — the exact shape the brief calls out ("Diff line colours use
// diffAddBg/diffDelBg/diffAddText/diffDelText").

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import type { MobileDiffLine } from '../session/mobile-diff-lines'
import type { MobileHighlightedDiffLine } from '../session/mobile-file-syntax'
import { MobileDiffReviewLine } from './MobileDiffReviewLine'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ MessageSquare: 'MessageSquare' }))
vi.mock('../ui/tap-target', () => ({ tapTargetHitSlop: () => undefined }))
vi.mock('./MobileSyntaxSegments', () => ({ MobileSyntaxSegments: () => null }))

function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const raw = node.props.style
  const flat = (Array.isArray(raw) ? raw.flat() : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

function line(kind: MobileDiffLine['kind']): MobileHighlightedDiffLine<MobileDiffLine> {
  return {
    kind,
    text: 'const x = 1',
    newLineNumber: kind === 'delete' ? undefined : 7,
    oldLineNumber: kind === 'add' ? undefined : 7,
    segments: [],
    highlighted: false
  }
}

describe('a diff review line', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints an added row from the %s theme diffAddBg', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffReviewLine
            line={line('add')}
            comments={[]}
            staleCommentIds={new Set()}
            active={false}
            onAddNote={() => undefined}
            onEditNote={() => undefined}
          />
        </ThemeProvider>
      )
    })
    const row = renderer!.root.findByType('View' as never)
    expect(styleOf(row).backgroundColor).toBe(palette.diffAddBg)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints a deleted row from the %s theme diffDelBg', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffReviewLine
            line={line('delete')}
            comments={[]}
            staleCommentIds={new Set()}
            active={false}
            onAddNote={() => undefined}
            onEditNote={() => undefined}
          />
        </ThemeProvider>
      )
    })
    const row = renderer!.root.findByType('View' as never)
    expect(styleOf(row).backgroundColor).toBe(palette.diffDelBg)
  })
})
