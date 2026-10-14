import { createElement, type ComponentProps, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { INSTRUMENT_SANS_ASCII_ADVANCE } from '../components/instrument-sans-regular-advances'

// A tapped row opens the real detail sheet in a bare shell: the draggable one
// needs RN exports this mock leaves out, and what matters here is what the
// tap shows (the same stand-in MobileNativeChatToolDetailSheet.test.tsx uses).
vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, header, children) : null
  }
})
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown =>
    React.createElement('Text', props, children)
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
    // Android 14, the user's S23: a running row's shimmer asks (MobileNativeChatShimmerText).
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
// A pasteboard that takes the text; the refusals are in MobileNativeChatMessage.copy-failure.test.tsx.
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => true) }))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  SquareChevronRight: 'SquareChevronRight',
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

function userMessage(blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id: 'u1', role: 'user', blocks, timestamp: null, source: 'transcript' }
}

describe('MobileNativeChatMessage', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const textIn = (node: ReactTestInstance): string[] =>
    node.findAllByType('Text' as never).map((text) => String(text.children.join('')))

  // The Claude app (1.261009.20) draws a sent prompt's uploads as their own
  // row of 96 dp cards ABOVE the bubble, end-aligned (m330.java:7339-7344,
  // f0f.java f()), and the bubble holds only the words. Code UI drew the same
  // cards inside the bubble, tall and half empty, the name cut after three
  // lines (user's screenshot, 2026-10-14). Real text: this session's own
  // two-recording prompt (Claude Code, 2026-10-14).
  describe('uploads on a sent prompt', () => {
    const TWO_RECORDINGS =
      '@"/Users/alwinpaul/.claude-work/uploads/211c47c2-7a42-4c86-9a59-eaa0905d39e6/9fc7b823-Screen_Recording_20261014_133056_Code_UI.mp4" @"/Users/alwinpaul/.claude-work/uploads/211c47c2-7a42-4c86-9a59-eaa0905d39e6/44b1dd40-Screen_Recording_20261014_133136_Claude.mp4" See thr difference in codeui and claude mobile when I copy and scroll down it switches so see how decompiled claude does that and do that'
    const FIRST = 'Attached file Screen_Recording_20261014_133056_Code_UI'

    const themed = (message: NativeChatMessage, preference: 'light' | 'dark' = 'light', props = {}) => {
      act(() => {
        renderer = create(
          createElement(ThemeProvider, { initialPreference: preference } as ComponentProps<typeof ThemeProvider>, createElement(MobileNativeChatMessage, { message, ...props }))
        )
      })
      return renderer!
    }
    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      Object.assign({}, ...([] as unknown[]).concat(node.props.style).flat(Infinity).filter(Boolean))
    const inBubble = (node: ReactTestInstance): boolean => {
      for (let at: ReactTestInstance | null = node; at; at = at.parent) {
        if (at.props?.style && flat(at).backgroundColor === lightColors.userBubble) {
          return true
        }
      }
      return false
    }
    const bubbles = (tree: ReactTestRenderer) =>
      tree.root.findAll((node) => typeof node.type === 'string' && Boolean(node.props.style) && flat(node).backgroundColor === lightColors.userBubble)

    it('shows an uploaded recording as a card above the message, not as a path in the text', () => {
      const tree = themed(userMessage([{ type: 'text', text: TWO_RECORDINGS }]))
      const card = tree.root.findByProps({ accessibilityLabel: FIRST })
      expect(inBubble(card)).toBe(false)
      expect(tree.root.findAllByProps({ accessibilityLabel: 'Attached file Screen_Recording_20261014_133136_Claude' }).length).toBeGreaterThan(0)
      const serialized = JSON.stringify(tree.toJSON())
      expect(serialized).not.toContain('.claude-work/uploads')
      expect(serialized.indexOf('Screen_Recording_20261014_133056_Code_UI')).toBeLessThan(serialized.indexOf('See thr difference'))
      expect(bubbles(tree)).toHaveLength(1)
    })

    it('draws no empty bubble under a prompt that was only an upload', () => {
      const tree = themed(userMessage([{ type: 'text', text: '@"/tmp/uploads/abcdef01-clip.mp4"' }]))
      expect(tree.root.findAllByProps({ accessibilityLabel: 'Attached file clip' }).length).toBeGreaterThan(0)
      expect(bubbles(tree)).toHaveLength(0)
    })

    it("cards Orca's attachment note above the bubble instead of printing it", () => {
      const tree = themed(
        userMessage([
          {
            type: 'text',
            text: 'Attached file "Screen_Recording_20261014_030357_Code UI.mp4" is on this machine at /var/folders/0y/yflzxsjs0vv8_c7n0325kl3h0000gn/T/orca-paste-1791939852431-edb95dfe-e7cb-4c5e-a031-d9da2f84479e.png. The .png extension is only the upload container; move it to a path ending in ".mp4" before reading it.\n\nSince auth code isn\'t signed in this happened'
          }
        ])
      )
      const card = tree.root.findByProps({ accessibilityLabel: 'Attached file Screen_Recording_20261014_030357_Code UI' })
      expect(inBubble(card)).toBe(false)
      expect(JSON.stringify(tree.toJSON())).not.toContain('upload container')
    })

    it('keeps a malformed mention in the bubble as the text it is', () => {
      const tree = themed(userMessage([{ type: 'text', text: 'look @"/tmp/uploads/abcdef01-a"b.pdf" here' }]))
      expect(textIn(tree.root)).toContain('look @"/tmp/uploads/abcdef01-a"b.pdf" here')
      expect(tree.root.findAllByProps({ accessibilityLabel: /^Attached file/ })).toHaveLength(0)
    })

    it("draws the card at the Claude app's size: 96 tall, 16 radius, a 1 dp border, nothing empty under the name", () => {
      const tree = themed(userMessage([{ type: 'text', text: TWO_RECORDINGS }]))
      const style = flat(tree.root.findByProps({ accessibilityLabel: FIRST }))
      expect(style.height).toBe(96)
      expect(style.borderRadius).toBe(16)
      expect(style.borderWidth).toBe(1)
      expect(style.padding).toBe(8)
      expect(style.borderColor).toBe(lightColors.attachmentCardBorder)
    })

    it('fits a 40-character recording name in three lines without cutting it', () => {
      const tree = themed(userMessage([{ type: 'text', text: TWO_RECORDINGS }]))
      const card = tree.root.findByProps({ accessibilityLabel: FIRST })
      const name = card.findAll((node) => node.type === ('Text' as never) && node.props.numberOfLines === 3)[0]!
      const nameStyle = flat(name)
      expect(nameStyle.fontSize).toBe(13)
      const style = flat(card)
      const inner = (style.width as number) - 2 * (style.padding as number) - 2 * (style.borderWidth as number)
      expect(wrappedLines('Screen_Recording_20261014_133056_Code_UI', nameStyle.fontSize as number, inner)).toBeLessThanOrEqual(3)
    })

    it('badges the card with the upper-case extension at the badge size', () => {
      const tree = themed(userMessage([{ type: 'text', text: TWO_RECORDINGS }]))
      const card = tree.root.findByProps({ accessibilityLabel: FIRST })
      const badge = card.findAll((node) => node.type === ('Text' as never) && node.children.join('') === 'MP4')[0]!
      expect(flat(badge).fontSize).toBe(11)
    })

    it('opens an uploaded PDF on a tap through the chat file opener', () => {
      const onOpenFile = vi.fn()
      const tree = themed(userMessage([{ type: 'text', text: '@"/tmp/uploads/abcdef01-notes.pdf" read this' }]), 'light', { onOpenFile })
      act(() => tree.root.findByProps({ accessibilityLabel: 'Attached file notes' }).props.onPress())
      expect(onOpenFile).toHaveBeenCalledWith('/tmp/uploads/abcdef01-notes.pdf')
    })

    it('gives a recording no tap, since nothing on the phone plays a host video by path', () => {
      const onOpenFile = vi.fn()
      const tree = themed(userMessage([{ type: 'text', text: TWO_RECORDINGS }]), 'light', { onOpenFile })
      expect(tree.root.findByProps({ accessibilityLabel: FIRST }).props.onPress).toBeUndefined()
    })

    it.each([
      ['light', lightColors, darkColors],
      ['dark', darkColors, lightColors]
    ] as const)('draws the card and its badge from the %s theme', (preference, colors, other) => {
      const tree = themed(userMessage([{ type: 'text', text: TWO_RECORDINGS }]), preference)
      const card = tree.root.findByProps({ accessibilityLabel: FIRST })
      expect(flat(card).backgroundColor).toBe(colors.attachmentCardFill)
      expect(flat(card).backgroundColor).not.toBe(other.attachmentCardFill)
      const badge = card.findAll((node) => node.type === ('Text' as never) && node.children.join('') === 'MP4')[0]!
      expect(flat(badge).color).toBe(colors.attachmentCardText)
    })
  })
})

/** Lines a name with no spaces takes when Android breaks it by character,
 *  priced with Instrument Sans's own advances (kerning left out). */
function wrappedLines(text: string, fontSize: number, width: number): number {
  let lines = 1
  let used = 0
  for (const char of text) {
    const advance = ((INSTRUMENT_SANS_ASCII_ADVANCE[char.charCodeAt(0) - 32] ?? 600) * fontSize) / 1000
    if (used + advance > width) {
      lines += 1
      used = 0
    }
    used += advance
  }
  return lines
}
