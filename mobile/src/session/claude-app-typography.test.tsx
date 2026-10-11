import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// 2026-10-11, the user: the chat text should match the official Claude
// Android app's sizes, weights and colours. The values below were read from
// com.anthropic.claude 1.261009.20 (docs/claude-app-typography.md in the main
// checkout): assistant body 17/400/1.5, headings 28/24/20 at 1.3, code 15 at
// 1.5, the Code session's user card 15/1.4 on #F0EFEC / #2C2C2A, tool rows and
// the status line 15/1.4. Instrument Sans has no 550, so headings take 600, as
// the app itself does when it draws with a font that lacks 550.
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): ReactNode =>
    React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
      Text,
      createAnimatedComponent: (component: unknown) => component,
      Value: class {
        setValue(): void {}
        interpolate(): number {
          return 0
        }
      },
      loop: () => ({ start: vi.fn(), stop: vi.fn() }),
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Easing: { inOut: () => 0, quad: 0 },
    Image: 'Image',
    PixelRatio: { get: () => 3 },
    Platform: { OS: 'android', Version: 34 },
    Pressable: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('Pressable', props, children),
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.33 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) }
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerMediumImpact: vi.fn()
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))

import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import { ThemeProvider, type Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { makeMarkdownStyles } from '../components/mobile-markdown-styles'
import {
  TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY,
  TRANSCRIPT_MARKDOWN_TYPOGRAPHY
} from '../components/mobile-markdown-prose-scale'
import { parseMobileMarkdown } from '../components/mobile-markdown-parser'
import { buildProseRuns, type ProseBlock } from '../components/mobile-markdown-prose-runs'
import { buildNativeProseModel, NATIVE_PROSE_LIST_INDENT, NATIVE_PROSE_LIST_ITEM_GAP } from '../components/native-prose-model'
import { nativeProseSpec } from '../components/native-prose-spec'
import { renderMarkdownCodeBlock } from '../components/MobileMarkdownCodeBlock'
import { contrastRatio } from '../test/contrast'
import { makeChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatStatusLine } from './MobileNativeChatStatusLine'
import { NativeChatTasksContext } from './native-chat-tasks-context'

const SCHEMES = ['light', 'dark'] as const
const paletteFor = (scheme: 'light' | 'dark') => (scheme === 'dark' ? darkColors : lightColors)

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: paletteFor(scheme),
    syntax: syntaxPaletteForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

type Style = Record<string, unknown>
function flat(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat)) as Style
  }
  return (style as Style | null | undefined) ?? {}
}

const CLAUDE = {
  light: {
    text: '#131313',
    bg: '#F9F9F7',
    surface: '#FFFFFF',
    secondary: '#383835',
    muted: '#7B7974',
    codeBody: '#F3F3F0',
    codeText: '#184F95',
    codeFill: 'rgba(11, 11, 11, 0.05)',
    hairline: 'rgba(30, 30, 29, 0.15)',
    userCard: '#F0EFEC',
    link: '#184F95'
  },
  dark: {
    text: '#F9F9F7',
    bg: '#151515',
    surface: '#20201F',
    secondary: '#C3C2B7',
    muted: '#97958D',
    codeBody: '#111111',
    codeText: '#6DA7EC',
    codeFill: 'rgba(255, 255, 255, 0.075)',
    hairline: 'rgba(225, 224, 217, 0.15)',
    userCard: '#2C2C2A',
    link: '#6DA7EC'
  }
} as const

describe('the Claude app’s chat colours', () => {
  it.each(SCHEMES)('are the theme tokens in %s', (scheme) => {
    const colors = paletteFor(scheme)
    const claude = CLAUDE[scheme]
    expect(colors.text).toBe(claude.text)
    expect(colors.bg).toBe(claude.bg)
    expect(colors.bgPanel).toBe(claude.surface)
    expect(colors.textSecondary).toBe(claude.secondary)
    expect(colors.chatMuted).toBe(claude.muted)
    expect(colors.codeBg).toBe(claude.codeBody)
    expect(colors.codeSpanText).toBe(claude.codeText)
    expect(colors.codeSpanBg).toBe(claude.codeFill)
    expect(colors.codeSpanBorder).toBe(claude.hairline)
    expect(colors.hairline).toBe(claude.hairline)
    expect(colors.userBubble).toBe(claude.userCard)
    expect(colors.userBubbleText).toBe(claude.text)
    expect(colors.chatLink).toBe(claude.link)
  })

  it('moves the dark surfaces onto the app’s own ladder around #151515', () => {
    // The app's surface (#20201F), user fill (#2C2C2A) and code body
    // (#111111) around its page, not the warm #1A1917 family they replaced.
    expect(darkColors.bgPanel).toBe('#20201F')
    expect(darkColors.bgRaised).toBe('#2C2C2A')
    expect(darkColors.bgSunken).toBe('#111111')
    expect(darkColors.bgDock).toBe('rgba(21, 21, 21, 0.72)')
    expect(darkColors.bgPanelGlass).toBe('rgba(32, 32, 31, 1)')
  })
})

describe('an assistant reply’s Markdown', () => {
  it.each(SCHEMES)('sets a body paragraph at 17 on 25.5 in the body colour, %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme), TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Record<string, Style>
    for (const name of ['paragraph', 'listText', 'quoteText']) {
      expect(styles[name], name).toMatchObject({
        fontFamily: fontFamily.regular,
        fontSize: 17,
        lineHeight: 25.5,
        color: CLAUDE[scheme].text
      })
    }
    // 8 between blocks.
    expect(styles.root!.gap).toBe(8)
  })

  it.each(SCHEMES)('sets headings at 28, 24 and 20 on 1.3, weight 600, %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme), TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Record<string, Style>
    expect(styles.heading).toMatchObject({ fontFamily: fontFamily.semibold, fontSize: 20, color: CLAUDE[scheme].text })
    expect(styles.heading!.lineHeight).toBeCloseTo(26, 6)
    expect(styles.headingLevel1!.fontSize).toBe(28)
    expect(styles.headingLevel1!.lineHeight).toBeCloseTo(36.4, 6)
    expect(styles.headingLevel2!.fontSize).toBe(24)
    expect(styles.headingLevel2!.lineHeight).toBeCloseTo(31.2, 6)
    expect(styles.headingLevel3!.fontSize).toBe(20)
    expect(styles.headingLevel3!.lineHeight).toBeCloseTo(26, 6)
  })

  it.each(SCHEMES)('draws inline code at 15 in the code face, blue on a 6.4-radius chip with a 0.5 border, %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme), TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Record<string, Style>
    expect(styles.inlineCodeChipText).toMatchObject({
      fontFamily: fontFamily.mono,
      fontSize: 15,
      color: CLAUDE[scheme].codeText
    })
    expect(styles.inlineCode).toMatchObject({ fontFamily: fontFamily.mono, fontSize: 15, color: CLAUDE[scheme].codeText })
    expect(styles.inlineCodeChip).toMatchObject({
      backgroundColor: CLAUDE[scheme].codeFill,
      borderColor: CLAUDE[scheme].hairline,
      borderWidth: 0.5,
      borderRadius: 6.4
    })
  })

  it.each(SCHEMES)('draws a code block at 15 on 22.5, radius 12, padding 16, on the app’s code body, %s', (scheme) => {
    const styles = makeMarkdownStyles(themeFor(scheme), TRANSCRIPT_MARKDOWN_TYPOGRAPHY) as unknown as Record<string, Style>
    expect(styles.codeBlock).toMatchObject({ borderRadius: 12, padding: 16, backgroundColor: CLAUDE[scheme].codeBody })
    expect(styles.codeText).toMatchObject({ fontFamily: fontFamily.mono, fontSize: 15, lineHeight: 22.5 })
    expect(styles.codeGutter).toMatchObject({ fontSize: 15, lineHeight: 22.5 })
  })

  it.each(SCHEMES)('hands the native prose view the 17 sp body, the chip’s 0.5 border and 6.4 radius, %s', (scheme) => {
    const run = buildProseRuns(parseMobileMarkdown('Para `code`.\n\n- one\n- two'), () => false)[0]!
    const model = buildNativeProseModel(run.prose as ProseBlock[], {
      typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
      opensFiles: false
    })!
    const spec = JSON.parse(
      nativeProseSpec(model, {
        typography: TRANSCRIPT_MARKDOWN_TYPOGRAPHY,
        scale: 1,
        colors: paletteFor(scheme),
        fonts: fontFamily,
        toColor: () => 0
      })
    ) as { fontSize: number; chip: Style; model: { paragraphs: Style[] } }
    expect(spec.fontSize).toBe(17)
    expect(spec.chip).toMatchObject({ fontSize: 15, borderWidth: 0.5, radius: 6.4 })
    const items = spec.model.paragraphs.filter((paragraph) => paragraph.kind === 'item')
    expect(items).toHaveLength(2)
    // Marker indent 8 and 4 between items, as the app's ListStyle.
    expect(items[0]).toMatchObject({ indent: NATIVE_PROSE_LIST_INDENT, spaceAfter: 4, lineHeight: 25.5 })
    expect(NATIVE_PROSE_LIST_INDENT).toBe(8)
    expect(NATIVE_PROSE_LIST_ITEM_GAP).toBe(4)
    const gap = spec.model.paragraphs.find((paragraph) => paragraph.kind === 'gap')
    expect(gap?.lineHeight).toBe(8)
  })
})

describe('a sent prompt in a Code session', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const prompt: NativeChatMessage = {
    id: 'u1',
    role: 'user',
    blocks: [{ type: 'text', text: 'ship it' }],
    timestamp: null,
    source: 'transcript'
  }

  it.each(SCHEMES)('is a card: 15 on 21, radius 12, 12 by 14 padding, the app’s fill and hairline, %s', (scheme) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatMessage message={prompt} />
        </ThemeProvider>
      )
    })
    const words = renderer!.root.find(
      (node: ReactTestInstance) => String(node.type) === 'Text' && node.children.includes('ship it')
    )
    expect(flat(words.props.style)).toMatchObject({ fontSize: 15, lineHeight: 21, color: CLAUDE[scheme].text })
    const card = renderer!.root.find(
      (node: ReactTestInstance) =>
        String(node.type) === 'Pressable' && flat(node.props.style).backgroundColor === CLAUDE[scheme].userCard
    )
    const style = flat(card.props.style)
    expect(style).toMatchObject({
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderColor: CLAUDE[scheme].hairline,
      borderWidth: 0.33
    })
    // A card, not a bubble: no tail corner.
    expect(style.borderBottomRightRadius).toBeUndefined()
  })

  it('sets a lead’s Markdown prompt in the card at the card’s 15 on 21', () => {
    expect(TRANSCRIPT_BUBBLE_MARKDOWN_TYPOGRAPHY.prose).toEqual({ fontSize: 15, lineHeight: 21 })
  })
})

describe('a tool row', () => {
  it.each(SCHEMES)('labels at 15 on 21, weight 400, in the app’s muted colour, in a 12-radius 8 by 6 box, %s', (scheme) => {
    const styles = makeChatMessageStyles(themeFor(scheme))
    expect(styles.toolRunLabel).toMatchObject({
      fontFamily: fontFamily.regular,
      fontSize: 15,
      lineHeight: 21,
      color: CLAUDE[scheme].muted
    })
    expect(styles.toolRunToggle).toMatchObject({ borderRadius: 12, paddingHorizontal: 8, paddingVertical: 6 })
  })
})

describe('the status line', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each(SCHEMES)('sets 15 on 21 and draws "N running tasks" in the app’s link blue, %s', (scheme) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          {createElement(
            NativeChatTasksContext.Provider,
            { value: { runningCount: 3, openSheet: () => {} } },
            createElement(MobileNativeChatStatusLine, { working: true, spinner: null })
          )}
        </ThemeProvider>
      )
    })
    const count = renderer!.root.find(
      (node: ReactTestInstance) => String(node.type) === 'Text' && node.props.children === '3 running tasks'
    )
    expect(flat(count.props.style)).toMatchObject({ fontSize: 15, lineHeight: 21, color: CLAUDE[scheme].link })
  })
})

/** Every element under `node` that carries `prop`, without rendering it. */
function elementsWith(node: unknown, prop: string): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => elementsWith(child, prop))
  }
  if (!node || typeof node !== 'object' || !('props' in node)) {
    return []
  }
  const props = (node as { props: Record<string, unknown> }).props
  return [...(prop in props ? [props] : []), ...elementsWith(props.children, prop)]
}

// Review of the 2026-10-11 change: the fence's line numbers were priced at 9 dp
// a digit, JetBrains Mono's 0.6 em at 15 sp with nothing to spare, and Android
// rounds the type up to a whole pixel (TextAttributes.kt), so "10" ran past its
// box at 2.8125 px/dp (the user's S23) and broke over two rows.
describe('a code block’s line numbers at 15 sp', () => {
  it.each([2.625, 2.75, 2.8125, 3, 3.5])('fit two digits on one line at %s px per dp', (density) => {
    const styles = makeMarkdownStyles(themeFor('light'), TRANSCRIPT_MARKDOWN_TYPOGRAPHY)
    const code = Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n')
    const fence = '`'.repeat(3)
    const [block] = parseMobileMarkdown([fence, code, fence].join('\n'))
    expect(block?.type).toBe('code')
    const element = renderMarkdownCodeBlock({
      block: block as Extract<NonNullable<typeof block>, { type: 'code' }>,
      index: 0,
      styles,
      selectable: false,
      mermaidSourceOccurrences: new Map()
    })
    const [lines] = elementsWith(element, 'gutterWidth')
    const gutterPaddingRight = 10
    const digitDp = (0.6 * Math.ceil(15 * density)) / density
    expect(lines!.gutterWidth as number).toBeGreaterThanOrEqual(2 * digitDp + gutterPaddingRight)
  })
})

// Review of the 2026-10-11 change: the "Image" chip in a sent prompt filled
// with bgRaised, which became the card's own colour, and only a faint border
// was left of it.
describe('an image chip in a sent prompt’s card', () => {
  it.each(SCHEMES)('stands off the card in %s', (scheme) => {
    const styles = makeChatMessageStyles(themeFor(scheme))
    const chip = styles.imageChip.backgroundColor as string
    expect(chip).not.toBe(paletteFor(scheme).userBubble)
    expect(contrastRatio(chip, paletteFor(scheme).userBubble)).toBeGreaterThan(1.05)
  })
})
