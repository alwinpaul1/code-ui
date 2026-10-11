import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { readFileSync } from 'node:fs'
import { darkColors, lightColors } from '../theme/tokens'
import { paintSpokenAtCursor, type DictationPaint } from '../hooks/mobile-live-transcript'

// The composer's text and its button row, against the Claude app on the same phone (the user's
// screenshots, 2026-10-11):
//
// 1. Air. Claude leaves 11 dp between the typed text and the top of its buttons (+, model pill,
//    mic, send: 8 dp text padding + 3 dp in its 42 dp row, from the decompiled app 1.261009.20,
//    docs/claude-app-implementation-notes.md); Code UI left 6 (the input's 4 dp bottom padding and 2 dp above a 36 dp button
//    centred in the row), so a multi-line draft ran down onto the row and a caret drag could land
//    on a button.
// 2. The box. Claude shows 1 to 6 lines, then scrolls. The input capped at 150 dp: 12 dp top padding, 4 bottom, 22 dp lines, so the cap
//    fell 2 dp into a seventh line and a cut line showed at the bottom of a full box.
// 3. Dictating. While the phone recogniser spoke into the composer, the input's own text went
//    transparent and a second, absolutely positioned Text drew the words over it
//    (DictationComposerPaint). That layer had no height cap and no scroll: past the input's cap it
//    ran down over the button row and out of the composer, and once the input scrolled to its caret
//    the two copies sat a line apart, a double exposure (screenshot with an .mp4 chip above the
//    text, 2026-10-11). And each partial result rewrote `value` from JS, which Android applies
//    with the OLD selection kept, so the caret stayed where dictation began ("…and send| here it
//    should…") while the words landed after it.

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
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

import { MobileNativeChatComposer } from './MobileNativeChatComposer'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown): Record<string, unknown> {
  if (typeof style === 'function') {
    return flat((style as (state: { pressed: boolean }) => unknown)({ pressed: false }))
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flat(entry)))
  }
  return (style ?? {}) as Record<string, unknown>
}

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

type Extra = { micActive?: boolean; dictationPaint?: DictationPaint | null }

function composer(scheme: 'light' | 'dark', value: string, extra: Extra) {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileNativeChatComposer
        value={value}
        onChangeText={vi.fn()}
        onSend={vi.fn().mockResolvedValue(true)}
        sendSurfaceId="tab-a"
        getSendCompletionGeneration={() => 0}
        getComposerEditGeneration={() => 0}
        onAttachImage={vi.fn()}
        onMicPress={vi.fn()}
        {...extra}
      />
    </ThemeProvider>
  )
}

/** A fresh composer. */
async function render(scheme: 'light' | 'dark', value: string, extra: Extra = {}): Promise<void> {
  act(() => renderer?.unmount())
  await act(async () => {
    renderer = create(composer(scheme, value, extra))
  })
}

/** The same composer, re-rendered with new props, as the parent re-renders it. */
async function rerender(scheme: 'light' | 'dark', value: string, extra: Extra = {}): Promise<void> {
  await act(async () => {
    renderer!.update(composer(scheme, value, extra))
  })
}

const input = (): ReactTestInstance => renderer!.root.find((node) => (node.type as unknown) === 'TextInput')
const inputStyle = () => flat(input().props.style)
/** Claude's composer text: 17 sp at 1.4 (docs/claude-app-typography.md, "Composer text"). */
const LINE = 17 * 1.4
const MAX_LINES = 6

/** From the input's last line to the top of the row's buttons: the input's bottom padding, the
 *  row's top padding, and half of what the row's minimum height leaves around a button. */
function airAboveButtons(): number {
  const row = flat(renderer!.root.findByProps({ testID: 'native-chat-composer-actions' }).props.style)
  const send = renderer!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Send message'
  )
  const buttonHeight = num(flat(send.props.style).height)
  const rowTop = num(row.paddingTop)
  const rowContent = num(row.minHeight) - rowTop - num(row.paddingBottom)
  return num(inputStyle().paddingBottom) + rowTop + Math.max(0, (rowContent - buttonHeight) / 2)
}

const draft = (lines: number) => Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join('\n')

for (const scheme of ['light', 'dark'] as const) {
  const palette = scheme === 'dark' ? darkColors : lightColors

  describe(`the composer box is the Claude app's, from its decompiled code (${scheme})`, () => {
    // Claude 1.261009.20 (docs/claude-app-implementation-notes.md, "The composer";
    // docs/claude-app-typography.md, "Composer shell/text/buttons").
    it('draws the shell with a 24 dp radius, the surface at 96%, a 0.5 dp hairline and 8 dp inside top and bottom', async () => {
      await render(scheme, '')
      const shell = flat(renderer!.root.findByProps({ testID: 'native-chat-composer' }).props.style)
      expect(shell.borderRadius).toBe(24)
      expect(shell.borderWidth).toBe(0.5)
      expect(shell.backgroundColor).toBe(palette.composerFill)
      expect(shell.borderColor).toBe(palette.composerBorder)
      expect(shell.paddingTop).toBe(8)
      expect(shell.paddingBottom).toBe(8)
      expect(shell.boxShadow).toBe('0px 2px 8px rgba(0, 0, 0, 0.1)')
    })

    it("sets the text at 17 sp, 1.4 line height, 13 x 8 padding, with Claude's muted placeholder", async () => {
      await render(scheme, '')
      const style = inputStyle()
      expect(style.fontSize).toBe(17)
      expect(style.lineHeight).toBe(LINE)
      expect(style.paddingHorizontal).toBe(13)
      expect(style.paddingTop).toBe(8)
      expect(style.paddingBottom).toBe(8)
      expect(input().props.placeholderTextColor).toBe(palette.composerPlaceholder)
    })

    it('lays the buttons in a 42 dp row 8 dp in from each side, 36 dp buttons with 20 dp icons', async () => {
      await render(scheme, 'x')
      const row = flat(renderer!.root.findByProps({ testID: 'native-chat-composer-actions' }).props.style)
      expect(row.minHeight).toBe(42)
      expect(row.paddingHorizontal).toBe(8)
      for (const label of ['Attach image', 'Dictate', 'Send message']) {
        const button = renderer!.root.find(
          (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label
        )
        expect(flat(button.props.style)).toMatchObject({ width: 36, height: 36 })
      }
      for (const glyph of ['Plus', 'Mic', 'ArrowUp']) {
        const icon = renderer!.root.find((node) => (node.type as unknown) === glyph)
        expect(icon.props.size, glyph).toBe(20)
      }
    })
  })

  describe(`the composer's text keeps clear of its buttons, as the Claude app's does (${scheme})`, () => {
    it("leaves Claude's 11 dp between the last line of text and the top of the buttons", async () => {
      await render(scheme, 'Please check this and send')
      expect(airAboveButtons()).toBe(11)
    })

    it('fits one line exactly when empty, and caps at exactly six whole lines with no cut seventh', async () => {
      // The degenerate sizes: empty, exactly the cap, one line past it. The box is the same for
      // all three: the input scrolls inside it rather than growing or showing a cut line.
      for (const value of ['', draft(MAX_LINES), draft(MAX_LINES + 1)]) {
        await render(scheme, value)
        const style = inputStyle()
        const pads = num(style.paddingTop) + num(style.paddingBottom)
        expect(style.lineHeight).toBe(LINE)
        expect(style.minHeight).toBe(pads + LINE)
        expect(style.maxHeight).toBe(pads + MAX_LINES * LINE)
        expect(input().props.scrollEnabled).not.toBe(false)
        act(() => renderer?.unmount())
        renderer = null
      }
    })
  })

  describe(`dictating into the composer draws one text layer, with the caret after the words (${scheme})`, () => {
    // The user's words: dictation started after "and send", with " here it should work" after it.
    const prefix = 'Please check this and send'
    const suffix = ' here it should work'
    const painted = paintSpokenAtCursor(prefix, suffix, 'the video too', 'the video too')

    it('draws the dictated words in the input itself, in the text ink, with no layer over it', async () => {
      await render(scheme, painted.text, { micActive: true, dictationPaint: painted })
      expect(inputStyle().color).toBe(palette.text)
      // No other text node may carry the draft: a second copy is the double exposure.
      const copies = renderer!.root.findAll(
        (node) =>
          (node.type as unknown) === 'Text' &&
          JSON.stringify(node.props.children ?? '').includes('the video too')
      )
      expect(copies).toHaveLength(0)
      const absolute = renderer!.root.findAll((node) => flat(node.props.style).position === 'absolute')
      expect(absolute).toHaveLength(0)
    })

    it('puts the caret at the end of the dictated words with each result, not where dictation began', async () => {
      await render(scheme, painted.text, { micActive: true, dictationPaint: painted })
      const caret = `${prefix} the video too`.length
      expect(painted.text.slice(0, caret)).toBe(`${prefix} the video too`)
      expect(input().props.selection).toEqual({ start: caret, end: caret })
      // The next partial result moves it on with the words.
      const next = paintSpokenAtCursor(prefix, suffix, 'the video too please', 'please')
      await rerender(scheme, next.text, { micActive: true, dictationPaint: next })
      const nextCaret = `${prefix} the video too please`.length
      expect(input().props.selection).toEqual({ start: nextCaret, end: nextCaret })
    })

    it('places the final result too, which lands after the mic has stopped', async () => {
      // Review, 2026-10-11: stop() sets 'processing' and the recogniser's last result and its
      // 'end' transcript arrive after, with micActive false; a caret tied to micActive missed them.
      const partial = paintSpokenAtCursor(prefix, suffix, 'the video too', 'the video too')
      await render(scheme, partial.text, { micActive: true, dictationPaint: partial })
      const final = paintSpokenAtCursor(prefix, suffix, 'the video too, please.', '')
      await rerender(scheme, final.text, { micActive: false, dictationPaint: final })
      const caret = `${prefix} the video too, please.`.length
      expect(input().props.selection).toEqual({ start: caret, end: caret })
    })

    it('places the caret once per result, so a tap mid-dictation is not snapped back', async () => {
      await render(scheme, painted.text, { micActive: true, dictationPaint: painted })
      expect(input().props.selection).toBeDefined()
      // Any later render with the same paint (a level tick, a tap's selection event) leaves it alone.
      await act(async () => input().props.onSelectionChange({ nativeEvent: { selection: { start: 3, end: 3 } } }))
      await rerender(scheme, painted.text, { micActive: true, dictationPaint: painted })
      expect(input().props.selection).toBeUndefined()
    })

    it('places nothing from a paint for another draft: empty, typed over, or left from an earlier dictation', async () => {
      await render(scheme, '', { micActive: true, dictationPaint: painted })
      expect(input().props.selection).toBeUndefined()
      await render(scheme, prefix, { micActive: true, dictationPaint: painted })
      expect(input().props.selection).toBeUndefined()
      await render(scheme, `${painted.text}!`, { micActive: false, dictationPaint: painted })
      expect(input().props.selection).toBeUndefined()
    })

    it('leaves the caret to the keyboard with no dictation paint (typing, or the IME composing)', async () => {
      await render(scheme, 'typed by hand', { micActive: false, dictationPaint: null })
      expect(input().props.selection).toBeUndefined()
      await rerender(scheme, 'typed by hand, more', { micActive: false, dictationPaint: null })
      expect(input().props.selection).toBeUndefined()
      await render(scheme, '', { micActive: true, dictationPaint: null })
      expect(input().props.selection).toBeUndefined()
    })
  })
}

// Claude's row: a leading group (attach, mode chip), a flexible middle, then a trailing group of the
// model chip, the mic and Send. Code UI drew the model pill in the leading group. A structural
// fact with no behavioural handle in this harness (the pill needs a live session-option
// controller), so it is read off the JSX, code only.
describe("the composer's button order is Claude's", () => {
  it('puts the model pill after the flexible middle, before the mic and Send', () => {
    const source = readFileSync(new URL('./MobileNativeChatComposer.tsx', import.meta.url), 'utf8')
    const at = (needle: string) => {
      const index = source.indexOf(needle)
      expect(index, needle).toBeGreaterThan(-1)
      return index
    }
    const attach = at('<MobileNativeChatAttachButton')
    const middle = at('<View style={{ flex: 1, minWidth: 0 }} />')
    const pill = at('<MobileNativeChatSessionOptionPickers')
    const mic = at("accessibilityLabel={micActive ? 'Stop dictation' : 'Dictate'}")
    const send = at('accessibilityLabel="Send message"')
    expect(attach).toBeLessThan(middle)
    expect(middle).toBeLessThan(pill)
    expect(pill).toBeLessThan(mic)
    expect(mic).toBeLessThan(send)
  })
})

