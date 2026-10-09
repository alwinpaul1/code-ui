import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// 2026-10-09, the user, beside the Claude app's transcript: "we can't see most
// of the content ... we need the same for ours, transcript and code, others
// stay the same". Every row of the transcript that draws Markdown takes the
// transcript's type, the sent prompt's bubble takes the same size (14 on 21 then, 15 on 22 since the
// Claude app was measured again the same day), and
// the tool detail sheet, a sheet and not the transcript, keeps its own.
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): ReactNode =>
    React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
      Text,
      Value: class {
        setValue(): void {}
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Platform: { OS: 'android', Version: 34 },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
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
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))

import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatAgentMessageRow } from './MobileNativeChatAgentMessageRow'
import { Prose } from './MobileNativeChatProse'
import { makeChatMessageStyles } from './mobile-native-chat-message-styles'
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import { contrastRatio } from '../test/contrast'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import type { Theme } from '../theme/theme-context'

const reply: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'One finding changes what you’ll see.' }],
  timestamp: null,
  source: 'transcript'
}

type Style = Record<string, unknown>
function flat(style: unknown): Style {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat)) as Style
  }
  return (style as Style | null | undefined) ?? {}
}

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: scheme === 'dark' ? darkColors : lightColors,
    syntax: syntaxPaletteForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

describe('the chat transcript’s type', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function byType(kind: string): ReactTestInstance[] {
    return renderer!.root.findAll((node) => String(node.type) === kind)
  }

  function render(element: ReturnType<typeof createElement>): void {
    act(() => {
      renderer = create(element)
    })
  }

  it.each([
    ['a reply', reply],
    ['a thought', { ...reply, id: 'r1', role: 'reasoning', blocks: [{ type: 'text', text: 'Thinking it over.' }] }],
    [
      'a plan document',
      { ...reply, id: 's1', role: 'system', blocks: [{ type: 'text', text: '1. Do it', presentation: 'plan-document' }] }
    ],
    [
      'a reply around a tool call',
      {
        ...reply,
        blocks: [
          { type: 'text', text: 'Running the suite.' },
          { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, toolUseId: 't1' },
          { type: 'tool-result', toolUseId: 't1', content: 'ok' },
          { type: 'text', text: 'Green.' }
        ]
      }
    ]
  ] as [string, NativeChatMessage][])('draws %s at the Claude app’s Small size', (_label, message) => {
    render(createElement(MobileNativeChatMessage, { message }))
    const markdown = byType('MobileMarkdown')
    expect(markdown.length).toBeGreaterThan(0)
    for (const node of markdown) {
      expect(node.props.typography).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY)
    }
    // The tool's detail sheet is a sheet, not the transcript.
    for (const sheet of byType('MobileNativeChatToolDetailSheet')) {
      expect(sheet.props.typography).toBeUndefined()
    }
  })

  it('draws a subagent’s message, opened, at the same size', () => {
    const styles = makeChatMessageStyles(themeFor('light'))
    render(
      createElement(MobileNativeChatAgentMessageRow, {
        sender: '@general-purpose',
        body: 'Done: `pnpm test` is green.',
        fontScale: 1,
        styles
      })
    )
    const toggle = byType('Pressable').find((node) => node.props.accessibilityLabel === 'Message from @general-purpose')!
    act(() => toggle.props.onPress())
    const [markdown] = byType('MobileMarkdown')
    expect(markdown!.props.typography).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY)
  })

  // A lead's prompt in a subagent's transcript is Markdown in a bubble as wide
  // as its text (mobile-markdown-code-pill-bubble.test.ts). The bubble keeps
  // the size and the code face, and its blocks the whole blank line it drew.
  it('sets a lead’s Markdown prompt in its bubble at the same size, its prose one Text', () => {
    const styles = makeChatMessageStyles(themeFor('light'))
    render(
      createElement(Prose, {
        block: { type: 'text', text: '- `one`\n- `two`' },
        invert: true,
        markdownPrompt: true,
        fontScale: 1,
        styles
      })
    )
    const [markdown] = byType('MobileMarkdown')
    const typography = markdown!.props.typography as typeof TRANSCRIPT_MARKDOWN_TYPOGRAPHY
    expect(typography.prose).toEqual(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.prose)
    expect(typography.chip).toEqual(TRANSCRIPT_MARKDOWN_TYPOGRAPHY.chip)
    expect(typography.blockGap).toBeNull()
  })

  it('sets a sent prompt at 15 on 22, as the replies around it', () => {
    render(createElement(MobileNativeChatMessage, { message: { ...reply, id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'ship it' }] } }))
    const words = byType('Text').find((node) => node.children.includes('ship it'))!
    expect(flat(words.props.style)).toMatchObject({ fontSize: 15, lineHeight: 22 })
  })

  it.each(['light', 'dark'] as const)('keeps the sent prompt’s colours on the theme tokens in %s', (scheme) => {
    const styles = makeChatMessageStyles(themeFor(scheme))
    const colors = scheme === 'dark' ? darkColors : lightColors
    expect(styles.userText.color).toBe(colors.userBubbleText)
    expect(styles.userBubble.backgroundColor).toBe(colors.userBubble)
    expect(styles.userText).toMatchObject({ fontSize: 15, lineHeight: 22 })
  })

  // The Claude app's dark bubble is DARKER than its page (#0d0d0d on #151515,
  // same phone, 2026-10-09); ours was lighter (#2E2B26 on #1A1917). Light keeps
  // its bubble, which already reads like Claude's.
  it('draws the dark sent-prompt bubble darker than the page, and keeps its words readable', () => {
    const lum = (hex: string) => contrastRatio('#FFFFFF', hex)
    // A higher contrast against white means a darker surface.
    expect(lum(darkColors.userBubble)).toBeGreaterThan(lum(darkColors.bg))
    expect(lum(darkColors.userBubble)).toBeGreaterThan(lum(darkColors.bgSunken))
    expect(contrastRatio(darkColors.userBubbleText, darkColors.userBubble)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the light sent-prompt bubble as it was, with readable words', () => {
    expect(lightColors.userBubble).toBe('#E6E2D7')
    expect(contrastRatio(lightColors.userBubbleText, lightColors.userBubble)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['light', 'dark'] as const)('gives the sent-prompt bubble Claude’s taller, rounder shape in %s', (scheme) => {
    // 106 px tall for one line against our 91 at the same text: 3 dp more
    // above and below at 2.57 px per dp, and corners a little rounder.
    const bubble = makeChatMessageStyles(themeFor(scheme)).userBubble
    expect(bubble.paddingVertical).toBe(13)
    expect(bubble.borderRadius).toBe(20)
  })
})
