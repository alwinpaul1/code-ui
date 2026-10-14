// The fold between two hunks, drawn as the Claude app's `jlc.e` draws it (com.anthropic.claude
// 1.261009.20): a gutter cell holding one 20 dp arrow, a label cell reading "+N lines", the two
// cells in their own blues, and the whole row one tap target, or none when the fold cannot open.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mobileDiffPaletteForScheme } from '../source-control/mobile-diff-claude-palette'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileDiffGapRow } from './MobileDiffGapRow'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  UnfoldVertical: 'UnfoldVertical'
}))

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat(3) : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the fold row of a diff', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(scheme: 'light' | 'dark', props: Parameters<typeof MobileDiffGapRow>[0]) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffGapRow {...props} />
        </ThemeProvider>
      )
    })
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints its gutter and label cells from the %s blues', (scheme, colors) => {
    const palette = mobileDiffPaletteForScheme(scheme)
    render(scheme, { hiddenLines: 47, action: 'all', gutterWidth: 37, onExpand: () => undefined })

    const views = renderer!.root.findAllByType('View' as never)
    const gutter = views.find((node) => styleOf(node).backgroundColor === palette.gapGutterBg)
    const label = views.find((node) => styleOf(node).backgroundColor === palette.gapBg)
    expect(gutter).toBeDefined()
    expect(label).toBeDefined()
    // The gutter cell is as wide as a line's gutter, so the two columns line up.
    expect(styleOf(gutter!).width).toBe(37)
    const text = renderer!.root.findByProps({ children: '+47 lines' })
    expect(styleOf(text).color).toBe(colors.composerPlaceholder)
    expect(renderer!.root.findByType('UnfoldVertical' as never).props.color).toBe(
      colors.composerPlaceholder
    )
    expect(renderer!.root.findByType('UnfoldVertical' as never).props.size).toBe(20)
  })

  it.each([
    ['all', 'UnfoldVertical', 'Expand all'],
    ['up', 'ChevronUp', 'Expand up'],
    ['down', 'ChevronDown', 'Expand down']
  ] as const)('draws the %s control with its own arrow and name', (action, icon, name) => {
    const onExpand = vi.fn()
    render('light', { hiddenLines: 9, action, gutterWidth: 37, onExpand })

    expect(renderer!.root.findAllByType(icon as never)).toHaveLength(1)
    const button = renderer!.root.findByType('Pressable' as never)
    expect(button.props.accessibilityRole).toBe('button')
    expect(button.props.accessibilityLabel).toBe(`${name}, +9 lines`)
    act(() => button.props.onPress())
    expect(onExpand).toHaveBeenCalledWith(action)
  })

  it('is plain text, with no tap target and an empty gutter, when the fold cannot open', () => {
    render('dark', { hiddenLines: 2_896, action: null, gutterWidth: 37 })

    expect(renderer!.root.findAllByType('Pressable' as never)).toHaveLength(0)
    expect(renderer!.root.findByProps({ children: '+2,896 lines' })).toBeDefined()
    // No arrow, as in `jlc.e` where the 20 dp spacer takes its place.
    for (const icon of ['UnfoldVertical', 'ChevronUp', 'ChevronDown']) {
      expect(renderer!.root.findAllByType(icon as never)).toHaveLength(0)
    }
  })

  it('reads "Expand" when it does not know how many lines are hidden', () => {
    render('light', { hiddenLines: 0, action: 'up', gutterWidth: 37, onExpand: () => undefined })
    expect(renderer!.root.findByProps({ children: 'Expand' })).toBeDefined()
  })

  it('says what an inert fold stands for to a screen reader, when it is given words', () => {
    render('light', {
      hiddenLines: 2_896,
      action: null,
      gutterWidth: 37,
      accessibilityLabel: '2,896 unchanged lines'
    })
    const row = renderer!.root.findAllByType('View' as never)[0]!
    expect(row.props.accessible).toBe(true)
    expect(row.props.accessibilityLabel).toBe('2,896 unchanged lines')
  })
})
