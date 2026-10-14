import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

// "Wrap long lines" (`code_line_wrap_enabled`, a41.java:171, default off; its row is
// gd9.java z8.java:293), after the Claude Android app 1.261009.20. Off, a code block's lines scroll
// sideways (code-block-spec.ts, w330.java:182-190). On, a line that is wider than the card
// continues on the next row inside it, the 16 dp padding unchanged. The card and the Expand sheet
// both follow it.

const mocks = vi.hoisted(() => ({ sheets: [] as Record<string, unknown>[] }))

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
vi.mock('./BottomDrawer', () => ({
  BottomDrawer: (props: { visible: boolean; header?: unknown; children?: unknown }) => {
    const { header, children, ...rest } = props
    mocks.sheets.push(rest)
    return props.visible ? createElement('BottomDrawer', rest, header as never, children as never) : null
  }
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => true }))

import { MobileMarkdown } from './MobileMarkdown'
import {
  resetChatReadingSettingsForTests,
  saveChatReadingSettings
} from '../settings/chat-reading-settings'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

const LONG_LINE =
  'pnpm exec vitest run --config vitest.config.ts --reporter verbose --testTimeout 60000 src/components/some/deep/path.test.ts'
const FENCE = ['```sh', LONG_LINE, 'echo done', '```'].join('\n')

let renderer: ReactTestRenderer | null = null

beforeEach(async () => {
  resetChatReadingSettingsForTests()
  await saveChatReadingSettings({ wrapLongLines: false })
  mocks.sheets.length = 0
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetChatReadingSettingsForTests()
})

async function render(scheme: 'light' | 'dark' = 'dark'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={FENCE} />
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
const byType = (node: ReactTestRenderer | ReactTestInstance, type: string): ReactTestInstance[] =>
  ('root' in node ? node.root : node).findAll((found) => (found.type as unknown) === type)
const byId = (node: ReactTestRenderer | ReactTestInstance, testID: string): ReactTestInstance[] =>
  ('root' in node ? node.root : node).findAll((found) => typeof found.type === 'string' && found.props.testID === testID)
const sidewaysScrollers = (node: ReactTestInstance): ReactTestInstance[] =>
  byType(node, 'ScrollView').filter((scroll) => scroll.props.horizontal === true)
const linesOf = (node: ReactTestInstance): ReactTestInstance[] =>
  byType(node, 'Text').filter((text) => text.children.some((child) => typeof child !== 'string'))
const wordsIn = (node: ReactTestInstance): string =>
  byType(node, 'Text')
    .map((text) => text.children.filter((child) => typeof child === 'string').join(''))
    .join('')

async function expand(tree: ReactTestRenderer): Promise<ReactTestInstance> {
  const button = byType(tree, 'Pressable').find((node) => node.props.accessibilityLabel === 'Expand code')!
  await act(async () => {
    await button.props.onPress()
  })
  return byType(tree, 'BottomDrawer')[0]!
}

describe('a code block with Wrap long lines off', () => {
  it('scrolls its lines sideways, as it always has', async () => {
    const tree = await render()
    const body = byId(tree, 'markdown-code-body')[0]!
    expect(sidewaysScrollers(body)).toHaveLength(1)
    expect(wordsIn(sidewaysScrollers(body)[0]!)).toContain(LONG_LINE)
  })

  it('scrolls the Expand sheet sideways too', async () => {
    const tree = await render()
    const sheet = await expand(tree)
    expect(sidewaysScrollers(sheet)).toHaveLength(1)
  })
})

describe('a code block with Wrap long lines on', () => {
  beforeEach(async () => {
    await saveChatReadingSettings({ wrapLongLines: true })
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('keeps a long line in the card, with no sideways scroller, in %s', async (scheme, palette) => {
    const tree = await render(scheme)
    const body = byId(tree, 'markdown-code-body')[0]!
    expect(sidewaysScrollers(body)).toHaveLength(0)
    // Every word is still there, drawn as text that may break, not cut to one line.
    expect(wordsIn(body)).toContain(LONG_LINE)
    for (const line of linesOf(body)) {
      expect(line.props.numberOfLines).toBeUndefined()
    }
    // The card keeps its own look and its 16 dp of padding around the code.
    expect(flatStyle(body.props.style).backgroundColor).toBe(palette.codeBlockBody)
    const padded = byType(body, 'View').find((view) => flatStyle(view.props.style).padding === 16)
    expect(padded, 'the code sits in its 16 dp padding').toBeDefined()
  })

  it('wraps the Expand sheet too', async () => {
    const tree = await render()
    const sheet = await expand(tree)
    expect(sidewaysScrollers(sheet)).toHaveLength(0)
    expect(wordsIn(sheet)).toContain(LONG_LINE)
  })

  it('follows the switch while the block stays on screen', async () => {
    await saveChatReadingSettings({ wrapLongLines: false })
    const tree = await render()
    expect(sidewaysScrollers(byId(tree, 'markdown-code-body')[0]!)).toHaveLength(1)
    await act(async () => {
      await saveChatReadingSettings({ wrapLongLines: true })
    })
    expect(sidewaysScrollers(byId(tree, 'markdown-code-body')[0]!)).toHaveLength(0)
    await act(async () => {
      await saveChatReadingSettings({ wrapLongLines: false })
    })
    expect(sidewaysScrollers(byId(tree, 'markdown-code-body')[0]!)).toHaveLength(1)
  })
})
