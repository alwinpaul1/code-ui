import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

// A message's Copy and a sent prompt's hold-to-copy fired the clipboard write
// and forgot it: `void Clipboard.setStringAsync(text); triggerSuccess();
// setCopied(true)`. setStringAsync answers false when the pasteboard did not
// take the text, and it can reject, so the phone buzzed and tinted "copied"
// over a write that never landed, and a rejection went unhandled.

// The draggable sheet needs RN exports this mock leaves out; a bare shell, as
// in MobileNativeChatMessage.test.ts.
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
    Platform: { OS: 'android', Version: 34 },
    Keyboard: { metrics: () => undefined },
    Modal: 'Modal',
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerMediumImpact: vi.fn()
}))
vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  Image: 'ImageIcon',
  Sparkles: 'Sparkles',
  SquareChevronRight: 'SquareChevronRight',
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  TextCursor: 'TextCursor',
  Undo2: 'Undo2',
  Wrench: 'Wrench'
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
// A hold on a sent prompt opens its menu in a drawer; this one is a bare shell.
vi.mock('../components/BottomDrawer', async () => {
  const { BottomDrawerDouble } = await import('./user-message-menu.test-support')
  return { BottomDrawer: BottomDrawerDouble }
})

import * as Clipboard from 'expo-clipboard'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { holdThenChoose } from './user-message-menu.test-support'

const prompt: NativeChatMessage = {
  id: 'u1',
  role: 'user',
  blocks: [{ type: 'text', text: 'run the full gate' }],
  timestamp: null,
  source: 'transcript'
}
const reply: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Done.' }],
  timestamp: null,
  source: 'transcript'
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

const textsIn = (node: ReactTestInstance): ReactTestInstance[] => node.findAllByType('Text' as never)

const notice = (tree: ReactTestRenderer): ReactTestInstance | undefined =>
  textsIn(tree.root).find((node) => String(node.children.join('')).startsWith("Couldn't copy"))

let renderer: ReactTestRenderer | null = null

function render(message: NativeChatMessage, preference: 'light' | 'dark' = 'light'): ReactTestRenderer {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={preference}>
        <MobileNativeChatMessage message={message} />
      </ThemeProvider>
    )
  })
  return renderer!
}

// A hold on a sent prompt opens the Claude app's menu; Copy message is the row that copies.
async function hold(tree: ReactTestRenderer): Promise<void> {
  await holdThenChoose(tree.root, 'Copy message')
}

async function pressCopy(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    tree.root.findByProps({ accessibilityLabel: 'Copy message' }).props.onPress()
  })
}

beforeEach(() => {
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(triggerSuccess).mockClear()
  vi.mocked(triggerError).mockClear()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe('copying a message the clipboard refuses', () => {
  it.each([
    ['light', lightColors, darkColors],
    ['dark', darkColors, lightColors]
  ] as const)(
    'does not buzz or tint "copied" over a held prompt the clipboard refused, and says so in the %s danger ink',
    async (preference, colors, other) => {
      vi.mocked(Clipboard.setStringAsync).mockResolvedValue(false)
      const tree = render(prompt, preference)
      await hold(tree)
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('run the full gate')
      expect(triggerSuccess).not.toHaveBeenCalled()
      expect(triggerError).toHaveBeenCalledTimes(1)
      const bubble = tree.root.findByProps({ accessibilityLabel: 'Sent prompt' })
      expect(flat(bubble.props.style).backgroundColor).toBe(colors.userBubble)
      const line = notice(tree)
      expect(line?.children.join('')).toBe("Couldn't copy: the clipboard did not accept this text.")
      expect(flat(line?.props.style).color).toBe(colors.danger)
      expect(flat(line?.props.style).color).not.toBe(other.danger)
    }
  )

  it('shows the refusal under a reply whose Copy the clipboard rejected, with no unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      vi.mocked(Clipboard.setStringAsync).mockRejectedValue(new Error('pasteboard unavailable'))
      const tree = render(reply, 'dark')
      await pressCopy(tree)
      // Let a stray rejection reach the process before looking.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(unhandled).toEqual([])
      expect(triggerSuccess).not.toHaveBeenCalled()
      expect(notice(tree)?.children.join('')).toBe("Couldn't copy: pasteboard unavailable.")
      expect(flat(notice(tree)?.props.style).color).toBe(darkColors.danger)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('takes the refusal away after a while', async () => {
    vi.useFakeTimers()
    vi.mocked(Clipboard.setStringAsync).mockResolvedValue(false)
    const tree = render(reply)
    await pressCopy(tree)
    expect(notice(tree)).toBeDefined()
    await act(async () => {
      vi.advanceTimersByTime(5_000)
    })
    expect(notice(tree)).toBeUndefined()
  })
})

describe('copying a message the clipboard takes', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('leaves a held prompt’s landed copy to the system to confirm: no buzz, no tint, in %s', async (preference, colors) => {
    // The Claude app (1.261013.20 e730.A) adds nothing to a copy from Android 13 on: the system
    // confirms every clipboard write itself.
    let land: (value: boolean) => void = () => {}
    vi.mocked(Clipboard.setStringAsync).mockReturnValue(
      new Promise<boolean>((resolve) => {
        land = resolve
      })
    )
    const tree = render(prompt, preference)
    await hold(tree)
    const bubble = () => tree.root.findByProps({ accessibilityLabel: 'Sent prompt' })
    // Still in flight: no claim yet.
    expect(triggerSuccess).not.toHaveBeenCalled()
    expect(flat(bubble().props.style).backgroundColor).toBe(colors.userBubble)
    await act(async () => {
      land(true)
    })
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('run the full gate')
    expect(triggerSuccess).not.toHaveBeenCalled()
    expect(triggerError).not.toHaveBeenCalled()
    expect(flat(bubble().props.style).backgroundColor).toBe(colors.userBubble)
    expect(notice(tree)).toBeUndefined()
  })

  it('writes nothing and claims nothing for a prompt with no text', async () => {
    vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
    const tree = render({ ...prompt, blocks: [] })
    // No hold is offered at all (MobileNativeChatMessage.copy-control.test.tsx).
    expect(tree.root.findByProps({ accessibilityLabel: 'Sent prompt' }).props.onLongPress).toBeUndefined()
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
    expect(triggerSuccess).not.toHaveBeenCalled()
    expect(triggerError).not.toHaveBeenCalled()
  })
})
