// The queued message of a Claude tab that sends through Anthropic, drawn as the Claude Android app
// 1.261009.20 draws it (hb20.e): 80% wide, 12 dp radius and padding, fill pl7.s, 15 sp italic in
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

import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatLocalQueue, QUEUED_MESSAGE_EDIT_LABEL } from './MobileNativeChatLocalQueue'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function draw(scheme: 'light' | 'dark', text: string | null, onEdit = vi.fn()): ReactTestRenderer {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatLocalQueue text={text} onEdit={onEdit} />
      </ThemeProvider>
    )
  })
  return renderer!
}
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.flat(4).filter(Boolean)) : ((style as Record<string, unknown>) ?? {}))

describe('the queued message', () => {
  for (const [scheme, colors] of [['light', lightColors], ['dark', darkColors]] as const) {
    it(`is drawn as the Claude app draws it, in ${scheme}`, () => {
      const tree = draw(scheme, 'add a test\n\nthen run it')
      const bubble = tree.root.findByProps({ testID: 'ccr-queued-message' })
      expect(flat(bubble.props.style)).toMatchObject({ width: '80%', alignSelf: 'flex-end', borderRadius: 12, padding: 12, marginTop: 20, backgroundColor: colors.codeBlockHeader })
      const words = tree.root.findAll((node) => (node.type as unknown) === 'Text' && node.props.children === 'add a test\n\nthen run it')[0]!
      expect(flat(words.props.style)).toMatchObject({ fontStyle: 'italic', fontSize: 15, color: colors.composerPlaceholder })
      expect(tree.root.findByType('X' as never).props).toMatchObject({ size: 14, color: colors.composerPlaceholder })
      expect(bubble.props.accessibilityLabel).toBe(QUEUED_MESSAGE_EDIT_LABEL)
    })
  }

  it('moves back to the composer on a tap anywhere', () => {
    const onEdit = vi.fn()
    const tree = draw('light', 'add a test', onEdit)
    act(() => tree.root.findByProps({ testID: 'ccr-queued-message' }).props.onPress())
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('draws nothing when the queue is empty', () => {
    expect(draw('dark', null).toJSON()).toBeNull()
    expect(draw('dark', '').toJSON()).toBeNull()
  })
})
