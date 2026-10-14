import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

// The reader's "Code font" (`code_mono_font`, a41.java:184: system | jetbrains_mono). Every
// coloured span of a code block names its own face, because a nested Text that names none is
// given the UI face (instrument-sans-text.ts): so the card's line style alone cannot move it.

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(false)
  },
  Linking: { openURL: () => Promise.resolve() },
  PixelRatio: { get: () => 3, getFontScale: () => 1 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy', Maximize2: 'Maximize2', X: 'X' }))
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => true }))

import { MobileMarkdown } from './MobileMarkdown'
import { DEFAULT_MARKDOWN_TYPOGRAPHY, TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'
import {
  resetChatReadingSettingsForTests,
  saveChatReadingSettings
} from '../settings/chat-reading-settings'
import { ThemeProvider } from '../theme/theme-context'
import { fontFamily } from '../theme/tokens'

const FENCE = ['```ts', 'const answer: number = 42', '```'].join('\n')

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  resetChatReadingSettingsForTests()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetChatReadingSettingsForTests()
})

async function render(
  typography: typeof TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
  scheme: 'light' | 'dark' = 'dark'
): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={FENCE} typography={typography} />
      </ThemeProvider>
    )
    await Promise.resolve()
  })
  return renderer!
}

function flatStyle(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(3) : [style]
  return Object.assign({}, ...list.filter((item) => item && typeof item === 'object'))
}

/** The face every Text of the block's code and its header label is drawn in. */
function codeFaces(tree: ReactTestRenderer): { code: unknown[]; label: unknown[] } {
  const find = (id: string): ReactTestInstance =>
    tree.root.findAll((node) => typeof node.type === 'string' && node.props.testID === id)[0]!
  const faces = (node: ReactTestInstance) =>
    node
      .findAll((found) => (found.type as unknown) === 'Text')
      .map((text) => flatStyle(text.props.style).fontFamily)
  return { code: faces(find('markdown-code-body')), label: faces(find('markdown-code-header')) }
}

describe('a code block’s face in the transcript', () => {
  it.each(['light', 'dark'] as const)('is JetBrains Mono until a code font is chosen, in %s', async (scheme) => {
    const { code, label } = codeFaces(await render(TRANSCRIPT_MARKDOWN_TYPOGRAPHY, scheme))
    expect(new Set(code)).toEqual(new Set([fontFamily.mono]))
    expect(new Set(label)).toEqual(new Set([fontFamily.mono]))
  })

  it.each(['light', 'dark'] as const)('is the platform monospace when the code font says System, in %s', async (scheme) => {
    await saveChatReadingSettings({ codeFont: 'system' })
    const { code, label } = codeFaces(await render(TRANSCRIPT_MARKDOWN_TYPOGRAPHY, scheme))
    // Every line, and every coloured span inside it: none keeps the bundled face.
    expect(code.length).toBeGreaterThan(1)
    expect(new Set(code)).toEqual(new Set(['monospace']))
    expect(new Set(label)).toEqual(new Set(['monospace']))
  })

  it('leaves a code block outside the transcript in JetBrains Mono', async () => {
    await saveChatReadingSettings({ codeFont: 'system' })
    const { code } = codeFaces(await render(DEFAULT_MARKDOWN_TYPOGRAPHY))
    expect(new Set(code)).toEqual(new Set([fontFamily.mono]))
  })
})
