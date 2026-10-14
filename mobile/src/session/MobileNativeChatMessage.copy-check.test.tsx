import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

// The Claude app's action row (1.261009.20, l330.a over fa20.a): Copy is a
// glyph in the muted tone `pl7.Q`; once the text is copied it becomes a check
// tinted `ad5.K()` over 300 ms, and goes back after 2000 ms. The row is Code
// UI's own size (a 14 icon in a padding of 4: the user asked for it back on
// 2026-10-11, MobileNativeChatMessage.actions-above-running-work.test.tsx), but
// the button's touch target reaches the app's 40 dp. Before this the glyph never
// changed and the whole reply bubble flashed green for 700 ms.

const system = vi.hoisted(() => ({ fontScale: 1 }))

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, children) : null
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
    PixelRatio: { getFontScale: () => system.fontScale },
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
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

import * as Clipboard from 'expo-clipboard'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const reply: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Done.' }],
  timestamp: null,
  source: 'transcript'
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null

function render(scheme: 'light' | 'dark'): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatMessage message={reply} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const copyButton = (root: ReactTestInstance): ReactTestInstance =>
  root.find(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Copy message'
  )

/** The glyphs inside the Copy button: the resting one and the tint laid over it. */
const glyphs = (root: ReactTestInstance): { type: string; color: unknown; size: unknown }[] =>
  copyButton(root)
    .findAll((node) => ['Copy', 'Check'].includes(String(node.type)))
    .map((node) => ({ type: String(node.type), color: node.props.color, size: node.props.size }))

beforeEach(() => {
  system.fontScale = 1
  vi.useFakeTimers()
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('a reply’s Copy in a %s session', (scheme, palette) => {
  it('rests as a copy glyph in the muted tone pl7.Q, not the old text-muted brown', () => {
    const [resting] = glyphs(render(scheme))
    expect(resting).toMatchObject({ type: 'Copy', color: palette.composerPlaceholder, size: 14 })
    expect(palette.composerPlaceholder).not.toBe(palette.textMuted)
  })

  it('becomes a check tinted ad5.K() once the text is on the clipboard', async () => {
    const root = render(scheme)
    await act(async () => copyButton(root).props.onPress())
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Done.')
    const [resting, tint] = glyphs(root)
    expect(resting).toMatchObject({ type: 'Check', color: palette.composerPlaceholder })
    expect(tint).toMatchObject({ type: 'Check', color: palette.codeBlockCopied })
    expect(palette.codeBlockCopied).not.toBe(palette.composerPlaceholder)
  })

  it('keeps the check for 2000 ms and then draws the copy glyph again', async () => {
    const root = render(scheme)
    await act(async () => copyButton(root).props.onPress())
    await act(async () => {
      vi.advanceTimersByTime(1_999)
    })
    expect(glyphs(root).map((glyph) => glyph.type)).toEqual(['Check', 'Check'])
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(glyphs(root).map((glyph) => glyph.type)).toEqual(['Copy', 'Copy'])
  })

  it('does not tint the whole reply when Copy lands: the check is the answer', async () => {
    const root = render(scheme)
    await act(async () => copyButton(root).props.onPress())
    const bubbles = root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        flat(node.props.style).backgroundColor === palette.successSoft &&
        node.props.accessibilityLabel === undefined
    )
    expect(bubbles).toEqual([])
  })

  it('shows no check, and a notice, when the clipboard refuses the text', async () => {
    vi.mocked(Clipboard.setStringAsync).mockResolvedValue(false)
    const root = render(scheme)
    await act(async () => copyButton(root).props.onPress())
    expect(glyphs(root).map((glyph) => glyph.type)).toEqual(['Copy', 'Copy'])
  })

  it('keeps the 14 icon in a padding of 4 but reaches a 40 dp touch target', () => {
    const button = copyButton(render(scheme))
    const box = flat(button.props.style({ pressed: false }))
    expect(box.padding).toBe(4)
    const slop = button.props.hitSlop as number
    expect(14 + 2 * 4 + 2 * slop).toBeGreaterThanOrEqual(40)
  })
})

describe('a reply’s Copy at a large system font size', () => {
  // The Claude app sizes its action icons in sp, so they follow the system font; the user asked
  // for this row at its fixed old size (2026-10-11), so the glyph stays 14 dp however large the font.
  it.each(['light', 'dark'] as const)('keeps its 14 dp glyph and its 40 dp target, in %s', (scheme) => {
    system.fontScale = 1.4
    const root = render(scheme)
    expect(glyphs(root)[0]).toMatchObject({ type: 'Copy', size: 14 })
    const slop = copyButton(root).props.hitSlop as number
    expect(14 + 2 * 4 + 2 * slop).toBe(40)
  })
})
