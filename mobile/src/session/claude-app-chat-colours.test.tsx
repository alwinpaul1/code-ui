import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { ThemeProvider, useTheme, type Theme } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { Pill } from './MobileNativeChatSessionOptionRows'
import { makeChatViewStyles } from './mobile-native-chat-view-styles'
import { mobileSessionFrameStyles } from './mobile-session-frame-styles'
import { mobileSessionReaderStyles } from './mobile-session-reader-styles'
import { mobileBrowserPaneStyles } from '../browser/mobile-browser-pane-styles'
import { richMarkdownEditorThemeVariables } from '../components/rich-markdown/document-style'

// Reported 2026-10-13 with a Claude app screenshot: "We need the exact same
// colours the Claude mobile app uses: the background is black, and the input
// box is different." Colours only; the sizes stay Code UI's own (reverted
// 2026-10-11). The values are the app's own tokens, decompiled from
// com.anthropic.claude 1.261009.20 (docs/claude-app-typography.md), except the
// dark model pill, which is sampled from that screenshot (tokens.ts says why).
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

type Rgba = { r: number; g: number; b: number; a: number }

function parse(value: string): Rgba {
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) }
  }
  const n = Number.parseInt(value.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
}

/** `top` painted over the opaque `under`, as the screen composites it. */
function over(top: string, under: string): string {
  const t = parse(top)
  const u = parse(under)
  const mix = (a: number, b: number): string =>
    Math.round(a * t.a + b * (1 - t.a))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(t.r, u.r)}${mix(t.g, u.g)}${mix(t.b, u.b)}`
}

function composerSurface(colors: ThemeColors): string {
  return over(colors.composerFill, colors.chatBg)
}

async function renderComposer(scheme: 'light' | 'dark', extra: { showStop?: boolean } = {}): Promise<void> {
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
          onAttachImage={vi.fn()}
          onMicPress={vi.fn()}
          onStop={vi.fn()}
          {...extra}
        />
      </ThemeProvider>
    )
  })
}

function byTestId(id: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === 'View' && node.props.testID === id)
}

function pressable(label: string): ReactTestInstance {
  return renderer!.root.find(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label
  )
}

function themeFor(scheme: 'light' | 'dark'): Theme {
  let theme: Theme | null = null
  function Grab(): null {
    theme = useTheme()
    return null
  }
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <Grab />
      </ThemeProvider>
    )
  })
  return theme!
}

describe('the Claude app’s chat and composer tokens', () => {
  it('pins the light values', () => {
    expect({
      chatBg: lightColors.chatBg,
      composerFill: lightColors.composerFill,
      composerBorder: lightColors.composerBorder,
      composerBorderFocused: lightColors.composerBorderFocused,
      composerPlaceholder: lightColors.composerPlaceholder,
      composerControl: lightColors.composerControl,
      composerControlPressed: lightColors.composerControlPressed,
      composerPill: lightColors.composerPill,
      composerPillText: lightColors.composerPillText
    }).toEqual({
      chatBg: '#F9F9F7',
      composerFill: 'rgba(255, 255, 255, 0.96)',
      composerBorder: 'rgba(30, 30, 29, 0.15)',
      composerBorderFocused: 'rgba(30, 30, 29, 0.3)',
      composerPlaceholder: '#7B7974',
      composerControl: '#F0EFEC',
      composerControlPressed: '#E7E6E1',
      composerPill: '#F0EFEC',
      composerPillText: '#1E1C19'
    })
  })

  it('pins the dark values', () => {
    expect({
      chatBg: darkColors.chatBg,
      composerFill: darkColors.composerFill,
      composerBorder: darkColors.composerBorder,
      composerBorderFocused: darkColors.composerBorderFocused,
      composerPlaceholder: darkColors.composerPlaceholder,
      composerControl: darkColors.composerControl,
      composerControlPressed: darkColors.composerControlPressed,
      composerPill: darkColors.composerPill,
      composerPillText: darkColors.composerPillText
    }).toEqual({
      chatBg: '#151515',
      composerFill: 'rgba(32, 32, 31, 0.96)',
      composerBorder: 'rgba(225, 224, 217, 0.15)',
      composerBorderFocused: 'rgba(225, 224, 217, 0.3)',
      composerPlaceholder: '#97958D',
      composerControl: 'rgba(255, 255, 255, 0.08)',
      composerControlPressed: '#454442',
      composerPill: '#545452',
      composerPillText: '#F8F8F6'
    })
  })

  it('lands on the colours sampled from the user’s dark screenshot', () => {
    // Background (21, 21, 21), composer (32, 32, 30), mic circle (51, 49, 52).
    expect(darkColors.chatBg).toBe('#151515')
    expect(composerSurface(darkColors)).toBe('#20201f')
    expect(over(darkColors.composerControl, composerSurface(darkColors))).toBe('#323231')
  })
})

describe('the chat screen draws Claude’s background', () => {
  for (const [scheme, colors] of SCHEMES) {
    it(`under the chat, the session frame and the file tabs, in ${scheme}`, () => {
      const theme = themeFor(scheme)
      expect(makeChatViewStyles(theme).root.backgroundColor).toBe(colors.chatBg)
      const frame = mobileSessionFrameStyles(theme)
      for (const key of ['container', 'markdownFrame', 'browserFrame', 'markdownEditor', 'markdownState'] as const) {
        expect(frame[key].backgroundColor, key).toBe(colors.chatBg)
      }
      expect(mobileSessionReaderStyles(theme).markdownTextInput.backgroundColor).toBe(colors.chatBg)
      const browser = mobileBrowserPaneStyles(theme)
      expect([browser.root.backgroundColor, browser.viewport.backgroundColor]).toEqual([colors.chatBg, colors.chatBg])
      const editor = new Map(richMarkdownEditorThemeVariables({ colors, scheme }))
      expect([editor.get('--background'), editor.get('--editor-surface')]).toEqual([colors.chatBg, colors.chatBg])
    })
  }

  it('paints the header on the same background, so no band shows above the chat', () => {
    const source = readFileSync(join(__dirname, 'MobileSessionHeader.tsx'), 'utf8')
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).toMatch(/<SafeAreaView\s+style=\{\{\s*backgroundColor:\s*colors\.chatBg\s*\}\}/)
  })
})

describe('the composer in Claude’s colours', () => {
  for (const [scheme, colors] of SCHEMES) {
    it(`fills the box, draws its hairline and its placeholder in ${scheme}`, async () => {
      await renderComposer(scheme)
      const shell = flat(byTestId('native-chat-composer').props.style)
      expect(shell.backgroundColor).toBe(colors.composerFill)
      expect(shell.borderColor).toBe(colors.composerBorder)
      const input = renderer!.root.find((node) => (node.type as unknown) === 'TextInput')
      expect(input.props.placeholderTextColor).toBe(colors.composerPlaceholder)
      act(() => input.props.onFocus())
      expect(flat(byTestId('native-chat-composer').props.style).borderColor).toBe(colors.composerBorderFocused)
    })

    it(`fills + and the mic with the app’s control tone in ${scheme}`, async () => {
      await renderComposer(scheme)
      for (const label of ['Attach image', 'Dictate']) {
        expect(flat(pressable(label).props.style).backgroundColor, label).toBe(colors.composerControl)
        expect(flat(pressable(label).props.style, true).backgroundColor, `${label} pressed`).toBe(
          colors.composerControlPressed
        )
      }
    })

    it(`fills the stop button with the same tone, as the app's Stop, in ${scheme}`, async () => {
      await renderComposer(scheme, { canStop: true })
      expect(flat(pressable('Stop the agent').props.style).backgroundColor).toBe(colors.composerControl)
      expect(flat(pressable('Stop the agent').props.style, true).backgroundColor).toBe(colors.composerControlPressed)
    })

    it(`draws the model pill and its label in ${scheme}`, () => {
      act(() => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <Pill label="Opus 4.8" accessibleName="Model, Opus 4.8" disabled={false} onPress={vi.fn()} />
          </ThemeProvider>
        )
      })
      const pill = pressable('Model, Opus 4.8')
      expect(flat(pill.props.style).backgroundColor).toBe(colors.composerPill)
      expect(flat(pill.props.style, true).backgroundColor).toBe(colors.composerControlPressed)
      const label = renderer!.root.find((node) => (node.type as unknown) === 'Text')
      expect(flat(label.props.style).color).toBe(colors.composerPillText)
      const chevron = renderer!.root.find((node) => (node.type as unknown) === 'ChevronDown')
      expect(chevron.props.color).toBe(colors.composerPillText)
    })

    it(`keeps everything in the composer readable in ${scheme}`, () => {
      const surface = composerSurface(colors)
      // The app's own placeholder value measures 4.35:1 on the light box.
      expect(contrastRatio(colors.composerPlaceholder, surface)).toBeGreaterThanOrEqual(4.3)
      expect(contrastRatio(colors.composerPillText, colors.composerPill)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.text, surface)).toBeGreaterThanOrEqual(4.5)
      // The + and mic glyphs on their circles, a UI-icon floor.
      expect(contrastRatio(colors.textSecondary, over(colors.composerControl, surface))).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(colors.text, colors.chatBg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(colors.textMuted, colors.chatBg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
