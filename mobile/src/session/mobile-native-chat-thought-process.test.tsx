import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: unknown }): unknown =>
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
    Pressable: 'Pressable',
    Text,
    View: ({ children, ...props }: { children?: unknown }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light'
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
// The sheet's frame: its content is drawn only while it is open.
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', null, header, children) : null
  }
})

import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from '../components/mobile-markdown-prose-scale'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

// The Claude app 1.261009.20 never draws thinking inline: a turn's thinking
// is one row like a finished tool run, its glyph and "Thought process"
// (`ccr_thinking_thought_process`) in the muted ink, and a tap opens a sheet
// of that title with the text as Markdown (d59, remote bottom sheet b). Ours
// drew the words in the transcript beside a rail, folded past 600 characters.
//
// Where a thought reaches the phone: a `reasoning` message, from the
// structured lane (Claude's thinking blocks) and from Codex and Grok terminal
// tabs when their rollout carries a summary. A terminal Claude tab gets none:
// Orca's transcript reader turns a thinking block into assistant text, which
// the phone cannot tell from the reply (docs/claude-app-parity-gaps.md §6).

/** A thinking block's text, Claude Code 2.1.296, a session on this machine
 *  (2026-10-1x). */
const THINKING_2_1_296 =
  "I found that Table VIII and the 0.965 abstract figure are based on an outdated 23 June results file—two later code fixes (bit-based reliability counting and per-boundary latency) change these to K=8 retention 0.959, and the current weight sweep shows the choice isn't stable (K=8 wins only 74% of weightings). I'll build the energy-sensitivity check using the current code before writing anything up.\n\n"

function thought(text: string): NativeChatMessage {
  return { id: 'r1', role: 'reasoning', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

describe("a thought in the chat", () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(message: NativeChatMessage, scheme: 'light' | 'dark' = 'light'): ReactTestInstance {
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        createElement(ThemeProvider, { initialPreference: scheme }, createElement(MobileNativeChatMessage, { message }))
      )
    })
    return renderer!.root
  }

  const texts = (node: ReactTestInstance): string[] =>
    node.findAll((entry) => (entry.type as unknown) === 'Text').map((entry) => [entry.props.children].flat().join(''))
  const markdown = (node: ReactTestInstance) => node.findAll((entry) => (entry.type as unknown) === 'MobileMarkdown')
  const drawer = (node: ReactTestInstance) => node.findAll((entry) => (entry.type as unknown) === 'BottomDrawer')
  const row = (node: ReactTestInstance) =>
    node.find((entry) => (entry.type as unknown) === 'Pressable' && entry.props.accessibilityLabel === 'Thought process')
  function colorOf(style: unknown): string | undefined {
    let found: string | undefined
    for (const entry of [style].flat(Infinity)) {
      if (entry && typeof entry === 'object' && typeof (entry as { color?: unknown }).color === 'string') {
        found = (entry as { color: string }).color
      }
    }
    return found
  }

  it('is one "Thought process" row, never the thinking itself inline', () => {
    const root = render(thought(THINKING_2_1_296))
    expect(texts(root)).toEqual(['Thought process'])
    expect(markdown(root)).toHaveLength(0)
    expect(row(root)).toBeDefined()
  })

  it('opens the whole thinking as Markdown in a "Thought process" sheet', () => {
    const long = `${THINKING_2_1_296}${'Then the sweep again. '.repeat(60)}`
    const root = render(thought(long))
    act(() => row(root).props.onPress())
    const [sheet] = drawer(root)
    expect(sheet).toBeDefined()
    expect(texts(sheet!)).toEqual(['Thought process'])
    const [body] = markdown(sheet!)
    // Whole: the sheet is where a long thought is read, so nothing is folded.
    expect(body!.props.content).toBe(long.trim())
    expect(body!.props.typography).toBe(TRANSCRIPT_MARKDOWN_TYPOGRAPHY)
    act(() => sheet!.findByProps({ accessibilityLabel: 'Close' }).props.onPress())
    expect(drawer(root)).toHaveLength(0)
  })

  it('carries no Copy and no line down its side', () => {
    const root = render(thought(THINKING_2_1_296))
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Copy message')).toHaveLength(0)
    const railed = root.findAll((node) => {
      const style = Object.assign({}, ...([] as unknown[]).concat(node.props.style).flat(Infinity).filter(Boolean)) as {
        borderLeftWidth?: number
      }
      return typeof node.type === 'string' && Number(style.borderLeftWidth ?? 0) > 0
    })
    expect(railed).toHaveLength(0)
  })

  // Codex 0.153.4 on this machine writes every reasoning item with
  // `summary: []` (rollout 2026-10-11), which Orca drops; a blank one that
  // does arrive is not a thought either.
  it('draws nothing for a thought with no words', () => {
    const root = render(thought('  \n '))
    expect(texts(root)).toEqual([])
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Thought process')).toHaveLength(0)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the row from the %s theme: words like a finished run, glyph and chevron muted', (scheme, palette) => {
    const root = render(thought(THINKING_2_1_296), scheme)
    const label = root.find((node) => (node.type as unknown) === 'Text' && [node.props.children].flat().join('') === 'Thought process')
    expect(colorOf(label.props.style)).toBe(palette.textSecondary)
    expect(label.props.numberOfLines).toBe(1)
    const glyphs = row(root).findAll((node) => typeof node.props.color === 'string' && node.props.size !== undefined)
    expect(glyphs.length).toBe(2)
    for (const glyph of glyphs) {
      expect(glyph.props.color).toBe(palette.textMuted)
    }
  })
})
