import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { Pill } from './MobileNativeChatSessionOptionRows'
import { composerPlaceholder } from './use-mobile-native-chat-input-lock'

// Reported 2026-10-14: "we need all the things from claude decompiled to here in codeui the ui
// and spacing of input bar and all". Every figure below is the official Claude Android app's,
// 1.261009.20: decompiled (o530.b shell, p54.K/L/M border and fill, aj1 field, yg9.b/d/f/g
// buttons, md6.a model chip, ib8 placeholder) and measured on the user's screen recording of it
// (1080 px at 2.8125 px/dp, dark, keyboard up). The table is in docs/claude-app-parity-gaps.md,
// G37.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 384, height: 823 })
}))
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Code: 'Code',
  Hand: 'Hand',
  Image: 'Image',
  ImagePlus: 'ImagePlus',
  Mic: 'Mic',
  Paperclip: 'Paperclip',
  ScrollText: 'ScrollText',
  ShieldOff: 'ShieldOff',
  Zap: 'Zap',
  Plus: 'Plus',
  Square: 'Square',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown, pressed = false): Record<string, unknown> {
  if (typeof style === 'function') {
    return flat((style as (state: { pressed: boolean }) => unknown)({ pressed }), pressed)
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flat(entry, pressed)))
  }
  return (style ?? {}) as Record<string, unknown>
}

async function renderComposer(
  scheme: 'light' | 'dark',
  extra: { value?: string; canStop?: boolean } = {}
): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatComposer
          value={extra.value ?? ''}
          onChangeText={vi.fn()}
          onSend={vi.fn().mockResolvedValue(true)}
          sendSurfaceId="tab-a"
          getSendCompletionGeneration={() => 0}
          getComposerEditGeneration={() => 0}
          onAttachImage={vi.fn()}
          onMicPress={vi.fn()}
          onStop={vi.fn()}
          canStop={extra.canStop}
        />
      </ThemeProvider>
    )
  })
}

const byTestId = (id: string): ReactTestInstance =>
  renderer!.root.find((node) => (node.type as unknown) === 'View' && node.props.testID === id)
const pressable = (label: string): ReactTestInstance =>
  renderer!.root.find((node) => node.props.accessibilityLabel === label && node.props.style !== undefined)
const icon = (name: string): ReactTestInstance => renderer!.root.find((node) => (node.type as unknown) === name)
const input = (): ReactTestInstance => renderer!.root.find((node) => (node.type as unknown) === 'TextInput')

describe('the Claude app’s composer colours for its buttons', () => {
  it('pins Send, its glyph, the icon tone and the dark pill to the decompiled pl7 scheme', () => {
    // pl7.e = r59.b #C6613F light, r59.a #D97757 dark; pl7.H = r59.c white in both;
    // pl7.P = r59.s #383835 light, r59.j #C3C2B7 dark (c59.java, n5y.java, m5y.java).
    expect([lightColors.composerSend, darkColors.composerSend]).toEqual(['#C6613F', '#D97757'])
    expect([lightColors.composerSendGlyph, darkColors.composerSendGlyph]).toEqual(['#FFFFFF', '#FFFFFF'])
    // yg9.f: container and content each at 40% when disabled (hb10.n).
    expect([lightColors.composerSendDisabled, darkColors.composerSendDisabled]).toEqual([
      'rgba(198, 97, 63, 0.4)',
      'rgba(217, 119, 87, 0.4)'
    ])
    expect([lightColors.composerSendGlyphDisabled, darkColors.composerSendGlyphDisabled]).toEqual([
      'rgba(255, 255, 255, 0.4)',
      'rgba(255, 255, 255, 0.4)'
    ])
    expect([lightColors.composerIcon, darkColors.composerIcon]).toEqual(['#383835', '#C3C2B7'])
    // md6.a fills the chip with pl7.x0, the same tone as + and the mic; the recording shows the
    // pill and + at one grey (47 vs 47 on the 30 composer).
    expect(darkColors.composerPill).toBe(darkColors.composerControl)
    expect(lightColors.composerPill).toBe(lightColors.composerControl)
  })
})

for (const [scheme, colors] of SCHEMES) {
  describe(`the composer's layout and spacing match the Claude app's (${scheme})`, () => {
    it('sits 16 dp in from the screen edges and 16 dp above the keyboard', async () => {
      await renderComposer(scheme)
      const inset = flat(byTestId('native-chat-composer-inset').props.style)
      expect(inset).toMatchObject({ paddingHorizontal: 16, paddingBottom: 16 })
    })

    it('draws a 24 dp card with a 0.5 dp hairline and the app’s soft shadow', async () => {
      await renderComposer(scheme)
      const shell = flat(byTestId('native-chat-composer').props.style)
      expect(shell).toMatchObject({
        borderRadius: 24,
        borderWidth: 0.5,
        backgroundColor: colors.composerFill,
        borderColor: colors.composerBorder,
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.1)'
      })
    })

    it('sets the text 17 on a 24 line, 13 dp in, 16 dp under the top edge, 16 dp above the buttons', async () => {
      await renderComposer(scheme)
      const style = flat(input().props.style)
      expect(style).toMatchObject({ fontSize: 17, lineHeight: 24, paddingHorizontal: 13, paddingTop: 16 })
      const row = flat(byTestId('native-chat-composer-actions').props.style)
      expect(Number(style.paddingBottom) + Number(row.paddingTop)).toBe(16)
    })

    it('shows "Type / for commands" while idle and "Queue a message…" while the agent works', async () => {
      await renderComposer(scheme)
      expect(input().props.placeholder).toBe('Type / for commands')
      expect(input().props.placeholderTextColor).toBe(colors.composerPlaceholder)
      expect(composerPlaceholder(null, false)).toBe('Type / for commands')
      expect(composerPlaceholder(null, true)).toBe('Queue a message…')
    })

    it('lays the buttons 8 dp from the card’s sides and foot, 8 dp apart, 36 dp round', async () => {
      await renderComposer(scheme, { value: 'hi' })
      const row = flat(byTestId('native-chat-composer-actions').props.style)
      expect(row).toMatchObject({ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8, minHeight: 52, gap: 8 })
      for (const label of ['Attach image', 'Dictate', 'Send message']) {
        const style = flat(pressable(label).props.style)
        expect(style, label).toMatchObject({ width: 36, height: 36, borderRadius: 18 })
        expect(style.marginLeft ?? 0, label).toBe(0)
      }
    })

    it('lays the recording row on the action row’s buttons, with the same 8 dp all round', async () => {
      await act(async () => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <MobileNativeChatComposer
              value=""
              onChangeText={vi.fn()}
              onSend={vi.fn().mockResolvedValue(true)}
              sendSurfaceId="tab-a"
              getSendCompletionGeneration={() => 0}
              getComposerEditGeneration={() => 0}
              onMicPress={vi.fn()}
              micActive
              onCancelDictation={vi.fn()}
              onStopDictation={vi.fn()}
            />
          </ThemeProvider>
        )
      })
      const layer = flat(
        renderer!.root.find((node) => node.props.testID === 'native-chat-dictation-layer' && node.props.style).props.style
      )
      const row = flat(byTestId('native-chat-composer-actions').props.style)
      expect(layer).toMatchObject({ paddingHorizontal: 8, paddingVertical: 8 })
      expect([row.paddingTop, row.paddingBottom]).toEqual([8, 8])
      const send = flat(pressable('Send dictation').props.style)
      expect(send.backgroundColor).toBe(colors.composerSend)
    })

    it('draws the + 22, the mic 20 in the icon tone, and Send’s white arrow on the clay fill', async () => {
      await renderComposer(scheme, { value: 'hi' })
      expect(icon('Plus').props).toMatchObject({ size: 22, color: colors.composerIcon })
      expect(icon('Mic').props).toMatchObject({ size: 20, color: colors.composerIcon })
      const send = flat(pressable('Send message').props.style)
      expect(send.backgroundColor).toBe(colors.composerSend)
      expect(send.opacity ?? 1).toBe(1)
      expect(icon('ArrowUp').props).toMatchObject({ size: 18, color: colors.composerSendGlyph })
    })

    it('dims Send by taking fill and arrow each to 40%, not by fading the whole button', async () => {
      await renderComposer(scheme)
      const send = flat(pressable('Send message').props.style)
      expect(send.backgroundColor).toBe(colors.composerSendDisabled)
      expect(send.opacity ?? 1).toBe(1)
      expect(icon('ArrowUp').props.color).toBe(colors.composerSendGlyphDisabled)
    })

    it('draws Stop as an outline square in the text colour on the control fill', async () => {
      await renderComposer(scheme, { canStop: true })
      expect(flat(pressable('Stop the agent').props.style)).toMatchObject({
        width: 36,
        height: 36,
        backgroundColor: colors.composerControl
      })
      const square = icon('Square').props
      expect(square).toMatchObject({ size: 17, color: colors.text, strokeWidth: 2 })
      expect(square.fill ?? 'none').toBe('none')
    })

    it('draws the model pill 36 dp tall, 16 dp padded, at most 220 dp, with a 13 regular label and no chevron', () => {
      act(() => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <Pill label="Opus 5.5 High" accessibleName="Model, Opus 5.5 High" disabled={false} onPress={vi.fn()} />
          </ThemeProvider>
        )
      })
      const pill = flat(pressable('Model, Opus 5.5 High').props.style)
      expect(pill).toMatchObject({ height: 36, paddingHorizontal: 16, maxWidth: 220, backgroundColor: colors.composerPill })
      const label = flat(renderer!.root.find((node) => (node.type as unknown) === 'Text').props.style)
      expect(label).toMatchObject({ fontSize: 13, lineHeight: 18, color: colors.composerPillText })
      expect(renderer!.root.findAll((node) => (node.type as unknown) === 'ChevronDown')).toHaveLength(0)
    })
  })
}
