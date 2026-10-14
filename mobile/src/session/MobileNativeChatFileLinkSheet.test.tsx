import { useState, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

// The Claude app's menu on an inline file link (1.261009.20, xt20.java:87-91):
// the path over Open, Copy file name and, with a path relative to the project,
// Copy relative path. Here a hold on the chip that names a picture the phone
// cannot show opens it; replies' own links sit in a native text view with no
// hold event (docs/claude-app-parity-gaps.md, G20).

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, children) : null
  }
})
vi.mock('../components/BottomDrawer', async () => {
  const { BottomDrawerDouble } = await import('./user-message-menu.test-support')
  return { BottomDrawer: BottomDrawerDouble }
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
    ActivityIndicator: 'ActivityIndicator',
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

import * as Clipboard from 'expo-clipboard'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { MobileNativeChatFileLinkSheet } from './MobileNativeChatFileLinkSheet'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { DESKTOP_PROMPT_IMAGE_REF } from './mobile-desktop-prompt-images'

const words = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(words).join('')
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null

/** The sheet, shown and closed by its parent as a screen would. */
function Harness({ pathText, onOpen }: { pathText: string; onOpen: (path: string) => void }) {
  const [visible, setVisible] = useState(true)
  return (
    <MobileNativeChatFileLinkSheet
      visible={visible}
      pathText={pathText}
      onOpen={onOpen}
      onClose={() => setVisible(false)}
    />
  )
}

function renderSheet(
  pathText: string,
  scheme: 'light' | 'dark' = 'light',
  onOpen: (path: string) => void = vi.fn()
) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <Harness pathText={pathText} onOpen={onOpen} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const rows = (root: ReactTestInstance): string[] =>
  root
    .findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === undefined
    )
    .map((node) => words(node))
const row = (root: ReactTestInstance, label: string): ReactTestInstance =>
  root.find(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityLabel === undefined &&
      words(node) === label
  )

beforeEach(() => {
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
  vi.mocked(triggerSuccess).mockClear()
  vi.mocked(triggerError).mockClear()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('the file link menu in a %s session', (scheme, palette) => {
  it('heads the rows with the path as written, in the sheet’s muted ink', () => {
    const root = renderSheet('./src/a.ts:12', scheme)
    const title = root.find(
      (node) => String(node.type) === 'Text' && words(node) === './src/a.ts:12'
    )
    expect(flat(title.props.style).color).toBe(palette.textMuted)
  })

  it('offers Open, Copy file name and Copy relative path for a path inside the project', () => {
    expect(rows(renderSheet('src/session/a.ts', scheme))).toEqual([
      'Open',
      'Copy file name',
      'Copy relative path'
    ])
  })

  it('leaves Copy relative path out for an absolute path, which has none the phone can state', () => {
    expect(rows(renderSheet('/Users/dev/proj/src/a.ts', scheme))).toEqual([
      'Open',
      'Copy file name'
    ])
  })
})

describe('the rows', () => {
  it('copies the file name alone, buzzes success and opens nothing', async () => {
    const onOpen = vi.fn()
    const root = renderSheet('src/session/a.ts:12', 'light', onOpen)
    await act(async () => row(root, 'Copy file name').props.onPress())
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('a.ts')
    expect(triggerSuccess).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('copies the relative path without its ./ and its :line tail', async () => {
    const root = renderSheet('./src/session/a.ts:12:3')
    await act(async () => row(root, 'Copy relative path').props.onPress())
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('src/session/a.ts')
  })

  it('closes the sheet on a copy', async () => {
    const root = renderSheet('src/a.ts')
    await act(async () => row(root, 'Copy file name').props.onPress())
    expect(rows(root)).toEqual([])
  })

  it('buzzes an error, not a success, when the clipboard refuses the text', async () => {
    vi.mocked(Clipboard.setStringAsync).mockResolvedValue(false)
    const root = renderSheet('src/a.ts')
    await act(async () => row(root, 'Copy file name').props.onPress())
    expect(triggerSuccess).not.toHaveBeenCalled()
    expect(triggerError).toHaveBeenCalledTimes(1)
  })

  it('buzzes an error, with nothing unhandled, when the clipboard rejects', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      vi.mocked(Clipboard.setStringAsync).mockRejectedValue(new Error('pasteboard unavailable'))
      const root = renderSheet('src/a.ts')
      await act(async () => row(root, 'Copy relative path').props.onPress())
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(unhandled).toEqual([])
      expect(triggerError).toHaveBeenCalledTimes(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('opens the link as written once the sheet has left, not under it', async () => {
    const onOpen = vi.fn()
    const root = renderSheet('src/a.ts:12', 'light', onOpen)
    await act(async () => row(root, 'Open').props.onPress())
    // The press closed the sheet, and the drawer's exit ended: now the route may change.
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('src/a.ts:12')
  })

  it('offers only Open for words with no file name in them', () => {
    expect(rows(renderSheet('   '))).toEqual(['Open'])
  })
})

describe('a chip that names a picture the phone cannot show', () => {
  const reply = (path: string | undefined, alt?: string): NativeChatMessage => ({
    id: 'a1',
    role: 'assistant',
    blocks: [{ type: 'image-ref', ...(path ? { path } : {}), ...(alt ? { alt } : {}) }],
    timestamp: null,
    source: 'transcript'
  })
  function renderReply(
    message: NativeChatMessage,
    onOpenFile?: (path: string) => void,
    scheme: 'light' | 'dark' = 'light'
  ) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatMessage message={message} onOpenFile={onOpenFile} />
        </ThemeProvider>
      )
    })
    return renderer!.root
  }
  const chip = (root: ReactTestInstance) =>
    root.find(
      (node) =>
        String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Attached image'
    )

  it.each(['light', 'dark'] as const)(
    'opens its file on a tap and the file link menu on a hold, in %s',
    async (scheme) => {
      const onOpenFile = vi.fn()
      const root = renderReply(reply('shots/ui.png'), onOpenFile, scheme)
      expect(chip(root).props.accessibilityHint).toBe('Hold for options')
      act(() => chip(root).props.onPress())
      expect(onOpenFile).toHaveBeenCalledWith('shots/ui.png')
      onOpenFile.mockClear()
      act(() => chip(root).props.onLongPress())
      expect(rows(root)).toEqual(['Open', 'Copy file name', 'Copy relative path'])
      await act(async () => row(root, 'Copy file name').props.onPress())
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('ui.png')
      expect(onOpenFile).not.toHaveBeenCalled()
    }
  )

  it('offers no hold, and no sheet, to a chip with no way to open its file', () => {
    const root = renderReply(reply('shots/ui.png'))
    expect(chip(root).props.onLongPress).toBeUndefined()
    expect(chip(root).props.accessibilityHint).toBeUndefined()
  })

  it('offers no hold to a picture pasted on the desktop, which names no file', () => {
    const root = renderReply(reply(DESKTOP_PROMPT_IMAGE_REF), vi.fn())
    const pasted = root.find(
      (node) =>
        String(node.type) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith('Image on Desktop')
    )
    expect(pasted.props.onLongPress).toBeUndefined()
  })

  it('does not carry its menu over to the next picture bound to the same cell', () => {
    const onOpenFile = vi.fn()
    const root = renderReply(reply('shots/one.png'), onOpenFile)
    act(() => chip(root).props.onLongPress())
    expect(rows(root)).toEqual(['Open', 'Copy file name', 'Copy relative path'])
    act(() => {
      renderer!.update(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatMessage message={reply('shots/two.png')} onOpenFile={onOpenFile} />
        </ThemeProvider>
      )
    })
    expect(rows(root)).toEqual([])
  })

  it('carries no sheet until it is held', () => {
    const root = renderReply(reply('shots/ui.png'), vi.fn())
    expect(rows(root)).toEqual([])
  })
})
