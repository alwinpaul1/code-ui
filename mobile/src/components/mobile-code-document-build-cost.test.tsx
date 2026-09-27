import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy', WrapText: 'WrapText', X: 'X' }))
// The code viewer's Copy button writes through this; expo-clipboard cannot load here.
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  return {
    useTheme: () => ({
      colors: tokens.colorsForScheme('dark'),
      syntax: palettes.syntaxPaletteForScheme('dark'),
      fonts: tokens.fontFamily,
      space: tokens.space,
      radius: { ...tokens.radius, xl: 24 },
      type: { ...tokens.type, label: { size: 13 } },
      isDark: true
    })
  }
})

/** Visible-line indexes computed, whichever component asks. */
const indexes = vi.hoisted(() => ({ count: 0 }))
vi.mock('./mobile-code-folding', async () => {
  const actual = await vi.importActual<typeof import('./mobile-code-folding')>('./mobile-code-folding')
  return {
    ...actual,
    visibleLineIndices: (...args: Parameters<typeof actual.visibleLineIndices>) => {
      indexes.count += 1
      return actual.visibleLineIndices(...args)
    }
  }
})

import { buildMobileCodeDocument } from './mobile-code-document'
import { MobileFilePreviewSourceText } from '../files/MobileFilePreviewSourceText'

// 10,000 lines of Python: blocks nested three deep, blank lines between.
const LINES = Array.from({ length: 10_000 }, (_, i) =>
  i % 8 === 0 ? `def f${i}(x):` : i % 8 === 7 ? '' : `${' '.repeat(4 * (1 + (i % 3)))}x = x + ${i}`
)
const SOURCE = LINES.join('\n')

/** Characters a single pass reads to find every line's indent: the leading
 *  whitespace and the first character after it. */
function onePass(lines: readonly string[]): number {
  return lines.reduce((sum, line) => {
    const indent = line.length - line.trimStart().length
    return sum + (indent === line.length ? line.length : indent + 1)
  }, 0)
}

describe('building a big document', () => {
  it('reads each line\'s indent once, for the guides, the indent step and the folds alike', () => {
    // It was three passes, each walking every line with a string iterator:
    // +170 ms on Hermes for a 3.9 MB file (review, 2026-09-27).
    let iterators = 0
    let charReads = 0
    const iterator = String.prototype[Symbol.iterator]
    const charCodeAt = String.prototype.charCodeAt
    String.prototype[Symbol.iterator] = function (this: string) {
      iterators += 1
      return iterator.call(this)
    }
    String.prototype.charCodeAt = function (this: string, index: number) {
      charReads += 1
      return charCodeAt.call(this, index)
    }
    let doc: ReturnType<typeof buildMobileCodeDocument>
    try {
      doc = buildMobileCodeDocument(SOURCE, 'python')
    } finally {
      String.prototype[Symbol.iterator] = iterator
      String.prototype.charCodeAt = charCodeAt
    }
    expect(doc!.folds.length).toBeGreaterThan(1_000)
    expect(iterators).toBeLessThan(LINES.length / 100)
    expect(charReads).toBeLessThanOrEqual(onePass(LINES) * 1.2)
  })
})

describe('a code view given its caller\'s folds', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    vi.useFakeTimers()
    indexes.count = 0
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  it('does not work out the visible lines a second time for itself', () => {
    act(() => {
      renderer = create(createElement(MobileFilePreviewSourceText, { relativePath: 'algo/lever_energy.py', content: SOURCE }))
    })
    act(() => {
      vi.runAllTimers()
    })
    // One document, nothing folded: one index of its visible lines.
    expect(indexes.count).toBe(1)
  })
})
