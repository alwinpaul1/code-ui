import AsyncStorage from '@react-native-async-storage/async-storage'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The reading settings on the Chat UI screen, after the Claude Android app's "Appearance" and
// "Code appearance" sections (gd9.java:52-661, vpd.java:1113-1139, z8.java:276-297, ny20.java:77):
// Transcript text size (Small, Medium, Large), Transcript font, then Code font and the "Wrap long
// lines" switch. Each font option's label is drawn in its own typeface (gd9.java case 23 and `d`).

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock('lucide-react-native', () => ({ ChevronLeft: 'ChevronLeft' }))
vi.mock('./session/use-mobile-default-session-view-preference', () => ({
  useMobileDefaultSessionViewPreference: () => ({ defaultView: 'chat', setDefaultView: vi.fn() })
}))
vi.mock('./session/use-mobile-chat-focus-view', () => ({
  useMobileChatFocusViewPreference: () => ({ focusView: false, setFocusView: vi.fn() })
}))
vi.mock('./session/use-mobile-chat-expand-tools', () => ({
  useMobileChatExpandToolsPreference: () => ({ expandTools: false, setExpandTools: vi.fn() })
}))

import NativeChatSettingsScreen from '../app/native-chat-settings'
import {
  CHAT_READING_STORAGE_KEY,
  peekChatReadingSettings,
  resetChatReadingSettingsForTests,
  saveChatReadingSettings
} from './settings/chat-reading-settings'
import { ThemeProvider } from './theme/theme-context'
import { darkColors, fontFamily, lightColors } from './theme/tokens'

let renderer: ReactTestRenderer | null = null

beforeEach(async () => {
  resetChatReadingSettingsForTests()
  await AsyncStorage.removeItem(CHAT_READING_STORAGE_KEY)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetChatReadingSettingsForTests()
})

async function draw(scheme: 'light' | 'dark' = 'light'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>{createElement(NativeChatSettingsScreen)}</ThemeProvider>
    )
    await Promise.resolve()
    await Promise.resolve()
  })
  return renderer!
}

function stylesOf(style: unknown): Record<string, unknown>[] {
  if (Array.isArray(style)) {
    return style.flatMap(stylesOf)
  }
  if (typeof style === 'function') {
    return [...stylesOf(style({ pressed: false })), ...stylesOf(style({ pressed: true }))]
  }
  return typeof style === 'object' && style !== null ? [style as Record<string, unknown>] : []
}
const merged = (style: unknown): Record<string, unknown> => Object.assign({}, ...stylesOf(style))

const texts = (tree: ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll((node) => (node.type as unknown) === 'Text')
const wordsOf = (node: ReactTestInstance): string =>
  node.children.filter((child) => typeof child === 'string').join('')
const textNamed = (tree: ReactTestRenderer, words: string, nth = 0): ReactTestInstance => {
  const found = texts(tree).filter((node) => wordsOf(node) === words)
  expect(found.length, `"${words}" is on the screen`).toBeGreaterThan(nth)
  return found[nth]!
}
/** The radio row that holds a label, inside the group that holds its title. */
const radio = (tree: ReactTestRenderer, group: string, label: string): ReactTestInstance => {
  const radios = tree.root
    .findAll((node) => (node.type as unknown) === 'View' && node.props.accessibilityRole === 'radiogroup')
    .find((node) => node.props.accessibilityLabel === group)
  expect(radios, `the "${group}" group`).toBeDefined()
  const row = radios!
    .findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio')
    .find((node) => String(node.props.accessibilityLabel) === label)
  expect(row, `"${label}" under "${group}"`).toBeDefined()
  return row!
}

describe('the reading settings on the Chat UI screen', () => {
  it('draws the Claude app’s four settings under its two section titles', async () => {
    const tree = await draw()
    for (const words of [
      'Appearance',
      'Transcript text size',
      'Small',
      'Medium',
      'Large',
      'Transcript font',
      'Instrument Sans',
      'Code appearance',
      'Code font',
      'JetBrains Mono',
      'Wrap long lines'
    ]) {
      expect(texts(tree).some((node) => wordsOf(node) === words), words).toBe(true)
    }
  })

  it('shows the defaults as chosen: Medium, Instrument Sans, JetBrains Mono, wrap off', async () => {
    const tree = await draw()
    expect(radio(tree, 'Transcript text size', 'Medium').props.accessibilityState).toMatchObject({ checked: true })
    expect(radio(tree, 'Transcript text size', 'Small').props.accessibilityState).toMatchObject({ checked: false })
    expect(radio(tree, 'Transcript font', 'Instrument Sans').props.accessibilityState).toMatchObject({ checked: true })
    expect(radio(tree, 'Code font', 'JetBrains Mono').props.accessibilityState).toMatchObject({ checked: true })
    const wrap = tree.root.find((node) => (node.type as unknown) === 'Switch' && node.props.accessibilityLabel === 'Wrap long lines')
    expect(wrap.props.value).toBe(false)
  })

  it.each([
    ['Small', 'small'],
    ['Large', 'large']
  ] as const)('saves %s when it is tapped', async (label, stored) => {
    const tree = await draw()
    await act(async () => {
      radio(tree, 'Transcript text size', label).props.onPress()
      await Promise.resolve()
    })
    expect(peekChatReadingSettings()?.textSize).toBe(stored)
    expect(radio(tree, 'Transcript text size', label).props.accessibilityState).toMatchObject({ checked: true })
  })

  it('saves the transcript font and the code font apart', async () => {
    const tree = await draw()
    await act(async () => {
      radio(tree, 'Transcript font', 'System').props.onPress()
      await Promise.resolve()
    })
    expect(peekChatReadingSettings()).toMatchObject({ transcriptFont: 'system', codeFont: 'jetbrains_mono' })
    await act(async () => {
      radio(tree, 'Code font', 'System').props.onPress()
      await Promise.resolve()
    })
    expect(peekChatReadingSettings()).toMatchObject({ transcriptFont: 'system', codeFont: 'system' })
  })

  it('turns Wrap long lines on and off', async () => {
    const tree = await draw()
    const wrap = () =>
      tree.root.find((node) => (node.type as unknown) === 'Switch' && node.props.accessibilityLabel === 'Wrap long lines')
    await act(async () => {
      wrap().props.onValueChange(true)
      await Promise.resolve()
    })
    expect(peekChatReadingSettings()?.wrapLongLines).toBe(true)
    expect(wrap().props.value).toBe(true)
    await act(async () => {
      wrap().props.onValueChange(false)
      await Promise.resolve()
    })
    expect(peekChatReadingSettings()?.wrapLongLines).toBe(false)
  })

  it('shows what is already stored', async () => {
    await saveChatReadingSettings({ textSize: 'large', transcriptFont: 'system', codeFont: 'system', wrapLongLines: true })
    const tree = await draw()
    expect(radio(tree, 'Transcript text size', 'Large').props.accessibilityState).toMatchObject({ checked: true })
    expect(radio(tree, 'Transcript font', 'System').props.accessibilityState).toMatchObject({ checked: true })
    expect(radio(tree, 'Code font', 'System').props.accessibilityState).toMatchObject({ checked: true })
    expect(
      tree.root.find((node) => (node.type as unknown) === 'Switch' && node.props.accessibilityLabel === 'Wrap long lines').props.value
    ).toBe(true)
  })
})

describe('each font option drawn in its own typeface', () => {
  it('draws Instrument Sans in Instrument Sans and System in the phone’s face, under Transcript font', async () => {
    const tree = await draw()
    const label = (words: string) => wordsOf(radio(tree, 'Transcript font', words).findAllByType('Text' as never)[0]!)
    expect(label('Instrument Sans')).toBe('Instrument Sans')
    const face = (words: string) =>
      merged(radio(tree, 'Transcript font', words).findAllByType('Text' as never)[0]!.props.style).fontFamily
    expect(face('Instrument Sans')).toBe(fontFamily.regular)
    expect(face('System')).toBe('sans-serif')
  })

  it('draws System in the platform monospace and JetBrains Mono in JetBrains Mono, under Code font', async () => {
    const tree = await draw()
    const face = (words: string) =>
      merged(radio(tree, 'Code font', words).findAllByType('Text' as never)[0]!.props.style).fontFamily
    expect(face('System')).toBe('monospace')
    expect(face('JetBrains Mono')).toBe(fontFamily.mono)
  })

  it('leaves the text sizes in the screen’s own face: only the fonts are shown as themselves', async () => {
    const tree = await draw()
    const face = merged(radio(tree, 'Transcript text size', 'Small').findAllByType('Text' as never)[0]!.props.style)
    expect(face.fontFamily).toBe(fontFamily.regular)
  })
})

describe('the reading settings in both themes', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paint the canvas, the labels and the chosen mark from the %s palette', async (scheme, palette) => {
    const tree = await draw(scheme)
    const canvas = tree.root.findAll((node) => (node.type as unknown) === 'View')[0]!
    expect(merged(canvas.props.style).backgroundColor).toBe(palette.bg)
    expect(merged(textNamed(tree, 'Transcript text size').props.style).color).toBe(palette.text)
    // The chosen option's mark is the accent, the others' ring is the quiet border: no literal.
    const marks = (words: string) =>
      radio(tree, 'Transcript text size', words).findAll(
        (node) => (node.type as unknown) === 'View' && node.props.testID === 'chat-reading-radio'
      )[0]!
    expect(merged(marks('Medium').props.style).borderColor).toBe(palette.accent)
    expect(merged(marks('Small').props.style).borderColor).toBe(palette.borderStrong)
  })
})
