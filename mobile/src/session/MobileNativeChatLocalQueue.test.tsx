// The queued messages of a Claude tab that sends through Anthropic, one card each, drawn as the
// Claude Android app 1.261009.20 draws its queued card (hb20.e): 80% wide, 12 dp radius and padding, fill pl7.s, 15 sp italic in
// pl7.Q, a 14 dp "x" labelled "Edit queued message", and a tap anywhere that moves it back to the
// composer. Both schemes are checked: the colours come from the theme, never a literal.
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))

import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatLocalQueue, QUEUED_MESSAGE_EDIT_LABEL } from './MobileNativeChatLocalQueue'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function draw(scheme: 'light' | 'dark', entries: readonly string[], onEdit = vi.fn()): ReactTestRenderer {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatLocalQueue entries={entries} onEdit={onEdit} />
      </ThemeProvider>
    )
  })
  return renderer!
}
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.flat(4).filter(Boolean)) : ((style as Record<string, unknown>) ?? {}))

describe('the queued message', () => {
  for (const [scheme, colors] of [['light', lightColors], ['dark', darkColors]] as const) {
    it(`is drawn as the Claude app draws it, in ${scheme}`, () => {
      const tree = draw(scheme, ['add a test\n\nthen run it'])
      const bubble = tree.root.findByProps({ testID: 'ccr-queued-message' })
      expect(flat(bubble.props.style)).toMatchObject({ width: '80%', alignSelf: 'flex-end', borderRadius: 12, padding: 12, marginTop: 20, backgroundColor: colors.codeBlockHeader })
      const words = tree.root.findAll((node) => (node.type as unknown) === 'Text' && node.props.children === 'add a test\n\nthen run it')[0]!
      expect(flat(words.props.style)).toMatchObject({ fontStyle: 'italic', fontSize: 15, color: colors.composerPlaceholder })
      expect(tree.root.findByType('Path' as never).props.fill).toBe(colors.composerPlaceholder)
      expect(bubble.props.accessibilityLabel).toBe(QUEUED_MESSAGE_EDIT_LABEL)
    })
  }

  // 1.261013.20 ti30 (1.261009.20 hb20.e): the card is a Box padded 12 dp; the words carry a 22 dp
  // end padding, and the "x" is the icon font's U+E10F (cds_icon_symbols.ttf) in a 14 dp box
  // aligned TopEnd, so it sits 12 dp from the card's top and end edges whatever the words do.
  it.each(['light', 'dark'] as const)('puts the x where the Claude app does, in %s', (scheme) => {
    const tree = draw(scheme, ['a queued message long enough to wrap onto a second line of the card'])
    expect(tree.root.findAllByType('X' as never)).toHaveLength(0)
    const glyph = tree.root.findByProps({ testID: 'ccr-queued-message-x' })
    expect(flat(glyph.props.style)).toMatchObject({ position: 'absolute', top: 12, right: 12, width: 14, height: 14 })
    const svg = glyph.findByType('Svg' as never)
    expect(svg.props).toMatchObject({ width: 14, height: 14, viewBox: '0 0 1000 1000' })
    expect(glyph.findByType('Path' as never).props.d).toMatch(/^M705 745Q713 753 725 753/)
    const words = tree.root.findAll((node) => (node.type as unknown) === 'Text' && typeof node.props.children === 'string')[0]!
    expect(flat(words.props.style)).toMatchObject({ paddingRight: 22 })
    expect(flat(tree.root.findByProps({ testID: 'ccr-queued-message' }).props.style).flexDirection).toBeUndefined()
  })

  it('moves back to the composer on a tap anywhere', () => {
    const onEdit = vi.fn()
    const tree = draw('light', ['add a test'], onEdit)
    act(() => tree.root.findByProps({ testID: 'ccr-queued-message' }).props.onPress())
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(0)
  })

  it('draws nothing when the queue is empty', () => {
    expect(draw('dark', []).toJSON()).toBeNull()
  })

  // Reported 2026-10-16: two messages sent while Claude worked drew as one card holding both.
  for (const [scheme, colors] of [['light', lightColors], ['dark', darkColors]] as const) {
    it(`draws two queued messages as two cards, in order, each with its own x, in ${scheme}`, () => {
      const onEdit = vi.fn()
      const tree = draw(scheme, ['message one', 'message two'], onEdit)
      const cards = tree.root.findAll((node) => node.props.testID === 'ccr-queued-message' && (node.type as unknown) === 'Pressable')
      expect(cards).toHaveLength(2)
      const words = cards.map((card) => card.findAll((node) => (node.type as unknown) === 'Text' && typeof node.props.children === 'string')[0]!.props.children)
      expect(words).toEqual(['message one', 'message two'])
      expect(cards.map((card) => card.findAllByProps({ testID: 'ccr-queued-message-x' }).filter((node) => (node.type as unknown) === 'View'))).toEqual([[expect.anything()], [expect.anything()]])
      expect(flat(cards[0]!.props.style)).toMatchObject({ marginTop: 20, marginBottom: 8, backgroundColor: colors.codeBlockHeader })
      expect(flat(cards[1]!.props.style)).toMatchObject({ marginTop: 0, marginBottom: 8, backgroundColor: colors.codeBlockHeader })
      for (const card of cards) {
        expect(card.props.accessibilityLabel).toBe(QUEUED_MESSAGE_EDIT_LABEL)
      }
      act(() => cards[1]!.props.onPress())
      expect(onEdit).toHaveBeenCalledWith(1)
    })
  }
})
