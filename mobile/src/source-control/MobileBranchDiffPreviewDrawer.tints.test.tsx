// The committed-diff drawer tints its added and removed rows with the same two colours as the
// Changes review (`l59` in com.anthropic.claude 1.261009.20, via mobile-diff-claude-palette.ts), in
// both schemes, so one diff does not read as two on the two screens that draw it.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { mobileDiffPaletteForScheme } from './mobile-diff-claude-palette'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('../components/BottomDrawer', async () => {
  const { createElement } = await import('react')
  return {
    BottomDrawer: ({ children }: { children?: unknown }) =>
      createElement('BottomDrawer', null, children as never)
  }
})
vi.mock('../components/MobileSyntaxSegments', () => ({ MobileSyntaxSegments: () => null }))

const { MobileBranchDiffPreviewDrawer } = await import('./MobileBranchDiffPreviewDrawer')

function flat(style: unknown): Record<string, unknown> {
  const list = (Array.isArray(style) ? style.flat(3) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

const LINES = [
  { kind: 'context', text: 'same', oldLineNumber: 1, newLineNumber: 1, segments: [], highlighted: false },
  { kind: 'delete', text: 'old', oldLineNumber: 2, segments: [], highlighted: false },
  { kind: 'add', text: 'new', newLineNumber: 2, segments: [], highlighted: false }
]

describe('the committed-diff drawer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(['light', 'dark'] as const)('tints added and removed rows from the app\'s %s colours', (scheme) => {
    const palette = mobileDiffPaletteForScheme(scheme)
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileBranchDiffPreviewDrawer
            branchDiffPreview={
              {
                kind: 'ready',
                entry: { path: 'a.ts', status: 'modified' },
                summary: { baseRef: 'main' },
                lines: LINES,
                truncated: false
              } as never
            }
            onClose={() => undefined}
          />
        </ThemeProvider>
      )
    })
    const tints = renderer!.root
      .findAllByType('View' as never)
      .map((node) => flat(node.props.style).backgroundColor)
      .filter((color) => color !== undefined)
    expect(tints).toEqual([palette.delBg, palette.addBg])
  })
})
