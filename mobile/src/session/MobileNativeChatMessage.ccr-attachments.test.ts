import { createElement, type ComponentProps, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { decodeCcrEvent } from './ccr-transcript-decode'
import { FILES_ONLY_PROMPT, RECORDING_PROMPT, RECORDING_UUID, withPayload } from './fixtures/ccr-attachments-2026-10-15'

// The user's report of 2026-10-15: the Claude app drew the recording they attached as a card (an "MP4"
// chip, the name without its extension); Code UI drew only the sentence. The rows here are the
// decoder's own output for the recorded events (fixtures/ccr-attachments-2026-10-15.ts), drawn by the
// real message component under both themes.

const open = vi.fn(async (_ref: never) => undefined)
const load = vi.fn()
vi.mock('./ccr-attachment-open', () => ({
  openCcrAttachment: (ref: unknown) => open(ref as never),
  loadCcrAttachmentFile: (ref: unknown) => load(ref)
}))
vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, header, children) : null
  }
})
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
    Platform: { OS: 'android', Version: 34 },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) => React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
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

const NAME = 'Screen_Recording_20261015_123030_Code UI'
const LABEL = `Attached file ${NAME}`

describe('a prompt’s attachments drawn from Anthropic’s events', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    open.mockClear()
    load.mockReset()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const themed = (message: NativeChatMessage, preference: 'light' | 'dark' = 'light') => {
    act(() => {
      renderer = create(createElement(ThemeProvider, { initialPreference: preference } as ComponentProps<typeof ThemeProvider>, createElement(MobileNativeChatMessage, { message })))
    })
    return renderer!
  }
  // A Pressable's style is a function of its pressed state; read it at rest.
  const flat = (node: ReactTestInstance): Record<string, unknown> => {
    const style = typeof node.props.style === 'function' ? (node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false }) : node.props.style
    return Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))
  }
  const textOf = (node: ReactTestInstance): string[] => node.findAll((n) => n.type === ('Text' as never)).map((text) => String(text.children.join('')))
  const rowOf = (event: Parameters<typeof decodeCcrEvent>[0]) => decodeCcrEvent(event)[0]!

  it('draws the recording as an MP4 card named without its extension, and keeps the words in the bubble', () => {
    const tree = themed(rowOf(RECORDING_PROMPT))
    const card = tree.root.findByProps({ accessibilityLabel: LABEL })
    expect(textOf(card)).toEqual(['MP4', NAME])
    expect(textOf(tree.root)).toContain("See claude mobile shows nicely and code ui doesn't show fix  that")
    // The carrier block's text (the file name) is not drawn a second time as prose.
    expect(textOf(tree.root).filter((text) => text.includes('.mp4'))).toEqual([])
  })

  it('opens the recording from Anthropic on a tap: the card carries its file uuid', async () => {
    const tree = themed(rowOf(RECORDING_PROMPT))
    await act(async () => tree.root.findByProps({ accessibilityLabel: LABEL }).props.onPress())
    expect(open).toHaveBeenCalledWith({ fileUuid: RECORDING_UUID, fileName: `${NAME}.mp4`, isImage: false })
  })

  it('draws a prompt that was only files as cards with no empty bubble', () => {
    load.mockReturnValue(new Promise(() => undefined))
    const tree = themed(rowOf(FILES_ONLY_PROMPT))
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Attached file Screen_Recording_20261014_185614_Claude' }).length).toBeGreaterThan(0)
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Attached file 1000150278' }).length).toBeGreaterThan(0)
    expect(tree.root.findAll((node) => typeof node.type === 'string' && flat(node).backgroundColor === lightColors.userBubble)).toHaveLength(0)
  })

  it('draws an attached photo as its picture, 96 dp and rounded, once it has come down', async () => {
    load.mockResolvedValue({ uri: 'file:///cache/ccr-attachments/x/1000150278.jpg' })
    const tree = themed(rowOf(FILES_ONLY_PROMPT))
    await act(async () => undefined)
    const image = tree.root.findAll((node) => node.type === ('Image' as never) && (node.props.source as { uri?: string })?.uri === 'file:///cache/ccr-attachments/x/1000150278.jpg')
    expect(image).toHaveLength(1)
    expect(flat(image[0]!)).toMatchObject({ width: 96, height: 96 })
    const tile = image[0]!.parent!
    expect(flat(tile)).toMatchObject({ width: 96, height: 96, borderRadius: 16 })
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ fileName: '1000150278.jpg', isImage: true }))
  })

  it('falls back to the file card for a photo that cannot come down, still tappable', async () => {
    load.mockResolvedValue({ error: 'None of the signed-in Anthropic accounts owns this file.' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tree = themed(rowOf(FILES_ONLY_PROMPT))
    await act(async () => undefined)
    const card = tree.root.findByProps({ accessibilityLabel: 'Attached file 1000150278' })
    expect(textOf(card)).toEqual(['JPG', '1000150278'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('owns this file'))
    await act(async () => card.props.onPress())
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ fileName: '1000150278.jpg' }))
    warn.mockRestore()
  })

  it('draws an entry it does not know the shape of as nothing, not a card named undefined', () => {
    const tree = themed(rowOf(withPayload(RECORDING_PROMPT, { file_attachments: [{ file_uuid: RECORDING_UUID }, 7, null] })))
    expect(tree.root.findAllByProps({ accessibilityLabel: /^Attached file/ })).toHaveLength(0)
    expect(textOf(tree.root)).toContain("See claude mobile shows nicely and code ui doesn't show fix  that")
  })

  it.each([
    ['light', lightColors, darkColors],
    ['dark', darkColors, lightColors]
  ] as const)('draws the card and its chip from the %s theme', (preference, colors, other) => {
    const tree = themed(rowOf(RECORDING_PROMPT), preference)
    const card = tree.root.findByProps({ accessibilityLabel: LABEL })
    expect(flat(card)).toMatchObject({ width: 116, height: 96, borderRadius: 16, borderWidth: 1, backgroundColor: colors.attachmentCardFill, borderColor: colors.attachmentCardBorder })
    expect(flat(card).backgroundColor).not.toBe(other.attachmentCardFill)
    const chip = card.findAll((node) => node.type === ('Text' as never) && node.children.join('') === 'MP4')[0]!
    expect(flat(chip).color).toBe(colors.attachmentCardText)
  })

  it.each(['light', 'dark'] as const)('draws the photo tile from the %s theme while it loads', (preference) => {
    load.mockReturnValue(new Promise(() => undefined))
    const tree = themed(rowOf(FILES_ONLY_PROMPT), preference)
    const tile = tree.root.findAllByProps({ accessibilityLabel: 'Attached file 1000150278' })[0]!
    expect(flat(tile).backgroundColor).toBe((preference === 'light' ? lightColors : darkColors).attachmentCardFill)
  })
})
