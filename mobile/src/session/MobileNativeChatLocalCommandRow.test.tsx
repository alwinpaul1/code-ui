import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown => React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
      Text,
      Value: class {
        constructor(private value: number) {}
        setValue(next: number): void {
          this.value = next
        }
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 360, height: 780, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Undo2: 'Undo2',
  X: 'X'
}))
// The document as a leaf that reports the ink it would draw in: its text colour is the theme's
// `text` (mobile-markdown-styles.ts), so that is what the row has to set.
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  const { useTheme } = await import('../theme/theme-context')
  return {
    MobileMarkdown: ({ content }: { content: string }) => React.createElement('MobileMarkdown', { content, ink: useTheme().colors.text })
  }
})

import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { parseCcrEvent } from './ccr-session-api'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { FORKED_SKILL_DRAWN_TEXT, forkedSkillTwinEvent } from './fixtures/ccr-local-command-forked-skill-2026-10-15'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// "/code-review 1384 and 12 medium --fix" on a Claude tab drawn from Anthropic's events (Claude
// Code 2.1.300, 2026-10-15). The Claude app 1.261009.20 draws what the command printed with a
// 2 dp rule down its left side, 8 dp before the words, in the dimmed ink, with the reply's
// actions under it (mw20.java:181-193, vb20.j vb20.java:1733-1736). Ours drew it as Claude's own
// reply in the full ink, with no rule, its `<forked-skill-launch>` tags printed. The rule and ink
// are Code UI's own tokens (`border`, `textSecondary`): copy the behaviour, keep the palette.

const launch = (): NativeChatMessage => decodeCcrEvents([parseCcrEvent(forkedSkillTwinEvent())!], new WeakMap())[0]!
const reply: NativeChatMessage = {
  id: 'reply-1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Done.' }],
  timestamp: 1,
  source: 'transcript'
}

function flatStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}

/** The nearest view around the document that draws a line down its left side, if any. */
function ruleAround(node: ReactTestInstance): Record<string, unknown> | null {
  for (let at = node.parent; at; at = at.parent) {
    const style = flatStyle(at.props.style)
    if (typeof style.borderLeftWidth === 'number' && style.borderLeftWidth > 0) {
      return style
    }
  }
  return null
}

describe('a slash command’s output in the chat', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const render = (message: NativeChatMessage, scheme: 'light' | 'dark') => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>{createElement(MobileNativeChatMessage, { message })}</ThemeProvider>
      )
    })
    return renderer!.root
  }

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the background skill launch with a rule and the dimmed ink, in %s', (scheme, colors: ThemeColors) => {
    const root = render(launch(), scheme)
    const document = root.findByType('MobileMarkdown' as never)
    expect(document.props.content).toBe(FORKED_SKILL_DRAWN_TEXT)
    expect(document.props.ink).toBe(colors.textSecondary)
    expect(ruleAround(document)).toMatchObject({ borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 8 })
    // It keeps the reply's actions: its Copy is under it.
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Copy message' && typeof node.type === 'string')).toHaveLength(1)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('leaves Claude’s own reply in the full ink with no rule, in %s', (scheme, colors: ThemeColors) => {
    const document = render(reply, scheme).findByType('MobileMarkdown' as never)
    expect(document.props.ink).toBe(colors.text)
    expect(ruleAround(document)).toBeNull()
  })
})
