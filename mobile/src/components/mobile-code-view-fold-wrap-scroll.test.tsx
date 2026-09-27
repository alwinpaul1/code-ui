import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 })
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy', WrapText: 'WrapText' }))
// The code viewer's Copy button writes through this; expo-clipboard cannot load here.
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: vi.fn() }) }))
vi.mock('../theme/theme-context', async () => {
  const tokens = await vi.importActual<typeof import('../theme/tokens')>('../theme/tokens')
  const palettes = await vi.importActual<typeof import('../theme/syntax-palette')>('../theme/syntax-palette')
  return {
    useTheme: () => ({
      colors: tokens.colorsForScheme('dark'),
      syntax: palettes.syntaxPaletteForScheme('dark'),
      fonts: tokens.fontFamily,
      isDark: true
    })
  }
})

import { MobileCodeView } from './MobileCodeView'
import { buildMobileCodeDocument } from './mobile-code-document'

let renderers: ReactTestRenderer[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => renderers.forEach((r) => r.unmount()))
  renderers = []
  vi.useRealTimers()
})

// 100 lines: a block every 10 (def fN(): + 9 body lines).
const SOURCE = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? `def f${i}():` : `    x = ${i}`)).join('\n')

function list(r: ReactTestRenderer): ReactTestInstance {
  return r.root.findByType('FlatList' as never) as ReactTestInstance
}

function pressToggle(r: ReactTestRenderer, index: number, label: string): void {
  const element = list(r).props.renderItem({ item: list(r).props.data[index], index }) as ReactElement
  let drawn: ReactTestRenderer | null = null
  act(() => {
    drawn = create(element)
  })
  renderers.push(drawn!)
  const target = drawn!.root.find((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')
  act(() => {
    target.props.onPress()
  })
}

// Wrapped rows have no fixed height, so the list scrolls to a line after it
// mounts. That scroll was keyed on the line's row, which a fold above it
// changes, so folding scrolled the reader away (review, 2026-09-27).
describe('folding a block while lines are wrapped', () => {
  it('does not scroll the reader away from where they are when they fold a block above the line the file opened at', () => {
    const scrolls: number[] = []
    let r: ReactTestRenderer | null = null
    act(() => {
      r = create(
        createElement(MobileCodeView, {
          document: buildMobileCodeDocument(SOURCE, 'python'),
          accessibilityLabel: 'file preview',
          initialLine: 81
        }),
        { createNodeMock: () => ({ scrollToIndex: ({ index }: { index: number }) => scrolls.push(index), scrollToOffset: () => {} }) }
      )
    })
    renderers.push(r!)
    act(() => {
      vi.runAllTimers()
    })
    // Open unwrapped at line 81; the reader turns wrapping on there.
    act(() => list(r!).props.onViewableItemsChanged({ viewableItems: [{ index: 80 }, { index: 95 }] }))
    act(() => {
      r!.root.findByProps({ accessibilityLabel: 'Wrap lines' }).props.onPress()
    })
    expect(scrolls).toEqual([80])
    // The reader scrolls back up to the top of the file...
    act(() => list(r!).props.onViewableItemsChanged({ viewableItems: [{ index: 0 }, { index: 15 }] }))
    // ...and folds the first function, which they are looking at.
    pressToggle(r!, 0, 'Fold lines 1–10')
    expect(list(r!).props.data[1]).toBe(10)
    // Nothing should move the list off the top: the reader asked for a fold, not a jump.
    expect(scrolls).toEqual([80])
  })

  it('does not scroll away when a file with a long line opens wrapped at a linked line and the reader folds above it', () => {
    const scrolls: number[] = []
    const source = SOURCE + '\n' + 'x'.repeat(2_500)
    let r: ReactTestRenderer | null = null
    act(() => {
      r = create(
        createElement(MobileCodeView, { document: buildMobileCodeDocument(source, 'python'), accessibilityLabel: 'file preview', initialLine: 81 }),
        { createNodeMock: () => ({ scrollToIndex: ({ index }: { index: number }) => scrolls.push(index), scrollToOffset: () => {} }) }
      )
    })
    renderers.push(r!)
    act(() => {
      vi.runAllTimers()
    })
    expect(list(r!).props.initialScrollIndex).toBeUndefined() // wrapped: the effect scrolls
    expect(scrolls).toEqual([80])
    act(() => list(r!).props.onViewableItemsChanged({ viewableItems: [{ index: 0 }, { index: 15 }] }))
    pressToggle(r!, 0, 'Fold lines 1–10')
    expect(scrolls).toEqual([80])
  })
})
