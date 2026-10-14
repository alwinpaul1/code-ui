// The chip that says how many comments are waiting, as the Claude app draws it (`o330.b` in
// com.anthropic.claude 1.261009.20): a 16 dp pill in the primary text colour at 10%, a 14 dp
// bubble and "N comments" in 13 sp, and "N queued comments, tap to view" for a screen reader.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mobileDiffPaletteForScheme } from '../source-control/mobile-diff-claude-palette'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileDiffQueuedChip } from './MobileDiffQueuedChip'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ MessageSquare: 'MessageSquare' }))
vi.mock('../ui/tap-target', () => ({ tapTargetHitSlop: () => undefined }))

function styleOf(node: { props: { style?: unknown } }, pressed = false): Record<string, unknown> {
  const raw =
    typeof node.props.style === 'function' ? node.props.style({ pressed }) : node.props.style
  const flat = (Array.isArray(raw) ? raw.flat(3) : [raw]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...flat)
}

describe('the queued comments chip', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(scheme: 'light' | 'dark', count: number, onPress = () => undefined) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileDiffQueuedChip count={count} onPress={onPress} />
        </ThemeProvider>
      )
    })
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('is a 16 dp pill in the %s primary-text tint with a 14 dp bubble', (scheme, colors) => {
    render(scheme, 3)
    const chip = renderer!.root.findByType('Pressable' as never)
    expect(styleOf(chip)).toMatchObject({
      backgroundColor: mobileDiffPaletteForScheme(scheme).chipBg,
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center'
    })
    const icon = renderer!.root.findByType('MessageSquare' as never)
    expect(icon.props).toMatchObject({ size: 14, color: colors.composerIcon })
    const label = renderer!.root.findByProps({ children: '3 comments' })
    expect(styleOf(label)).toMatchObject({ color: colors.composerIcon, fontSize: 13 })
  })

  it('reads "1 comment" for one, and "N comments" for the rest', () => {
    render('light', 1)
    expect(renderer!.root.findByProps({ children: '1 comment' })).toBeDefined()
    act(() => renderer?.unmount())
    render('light', 12)
    expect(renderer!.root.findByProps({ children: '12 comments' })).toBeDefined()
  })

  it('tells a screen reader how many are queued, in the app\'s own sentence', () => {
    render('light', 4)
    const chip = renderer!.root.findByType('Pressable' as never)
    expect(chip.props.accessibilityRole).toBe('button')
    expect(chip.props.accessibilityLabel).toBe('4 queued comments, tap to view')
  })

  it('opens on a tap', () => {
    const onPress = vi.fn()
    render('dark', 2, onPress)
    act(() => renderer!.root.findByType('Pressable' as never).props.onPress())
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('is not drawn for nothing queued', () => {
    render('light', 0)
    expect(renderer!.root.findAllByType('Pressable' as never)).toHaveLength(0)
  })
})
