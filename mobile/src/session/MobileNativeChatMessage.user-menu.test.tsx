import { useEffect, useRef, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

// The Claude app's message menu on a Code session (1.261009.20, fmg.java and
// rgs.java:85-110): a hold on a sent message opens a card of "Copy" and
// "Select text", with "Undo send" first on a message still waiting (in the
// place of the app's Edit). Before this a hold copied the prompt at once and
// there was no way to select part of it. Since 2026-10-15 ("we need exact hold
// to copy from Claude mobile") a reply opens the same menu; the hold on a
// reply is pinned in chat-message-hold-menu.test.tsx.

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, children) : null
  }
})
// The drawer is a Modal with gestures; this one shows its children while `visible` and says
// "after close" the moment it goes from visible to hidden, as the real one does once its exit ends.
const drawers = vi.hoisted(() => ({ seen: [] as Record<string, unknown>[] }))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: (props: {
      visible: boolean
      header?: ReactNode
      children?: ReactNode
      onAfterClose?: () => void
    }) => {
      drawers.seen.push(props as unknown as Record<string, unknown>)
      const was = useRef(props.visible)
      useEffect(() => {
        if (was.current && !props.visible) {
          props.onAfterClose?.()
        }
        was.current = props.visible
      }, [props.visible, props.onAfterClose])
      return props.visible
        ? React.createElement('BottomDrawer', props as never, props.header, props.children)
        : null
    }
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
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Modal: ({ children, ...props }: { children?: ReactNode }) => React.createElement('Modal', props, children),
    Platform: { OS: 'android', Version: 34 },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
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
import { triggerSuccess } from '../platform/haptics'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { markdownPlainText } from '../components/markdown-plain-text'

const prompt = (blocks: NativeChatBlock[], id = 'u1'): NativeChatMessage => ({
  id,
  role: 'user',
  blocks,
  timestamp: null,
  source: 'transcript'
})
const TYPED = 'run the gate\n\n- then **push**\n- `main` only'
const reply: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Done.' }],
  timestamp: null,
  source: 'transcript'
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))
const words = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(words).join('')

let renderer: ReactTestRenderer | null = null

function render(
  message: NativeChatMessage,
  scheme: 'light' | 'dark' = 'light',
  props: Partial<Parameters<typeof MobileNativeChatMessage>[0]> = {}
): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatMessage message={message} {...props} />
      </ThemeProvider>
    )
  })
  return renderer!.root
}

/** The bubble that takes the hold: a sent prompt carries the label, a waiting message only the hold. */
const bubble = (root: ReactTestInstance): ReactTestInstance =>
  root.find(
    (node) => String(node.type) === 'Pressable' && typeof node.props.onLongPress === 'function'
  )

/** A sent prompt's bubble, held or not. */
const sentPrompt = (root: ReactTestInstance): ReactTestInstance =>
  root.find(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Sent prompt'
  )

/** A menu row: an unlabelled Pressable that takes a tap (a waiting message's bubble takes none). */
const isRow = (node: ReactTestInstance): boolean =>
  String(node.type) === 'Pressable' &&
  node.props.accessibilityLabel === undefined &&
  typeof node.props.onPress === 'function'

/** The menu's rows, by the words on them. */
const menuRows = (root: ReactTestInstance): string[] =>
  root.findAll(isRow).map((node) => words(node))

const row = (root: ReactTestInstance, label: string): ReactTestInstance =>
  root.find((node) => isRow(node) && words(node) === label)

const selectBody = (root: ReactTestInstance): ReactTestInstance | undefined =>
  root.findAll(
    (node) => node.props.testID === 'select-text-body' && typeof node.type !== 'string'
  )[0]

/** A finger that goes down on the bubble and stays still past the long-press timeout. */
async function hold(root: ReactTestInstance): Promise<void> {
  const touch = { nativeEvent: { pageX: 300, pageY: 200 } }
  await act(async () => {
    bubble(root).props.onPressIn(touch)
  })
  await act(async () => {
    bubble(root).props.onLongPress(touch)
  })
}

beforeEach(() => {
  drawers.seen.length = 0
  vi.mocked(Clipboard.setStringAsync).mockReset()
  vi.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
  vi.mocked(triggerSuccess).mockClear()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])(
  'holding a sent prompt in a %s session',
  (scheme, palette) => {
    it('opens a menu of Copy and Select text instead of copying at once', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      expect(menuRows(root)).toEqual([])
      await hold(root)
      expect(menuRows(root)).toEqual(['Copy', 'Select text'])
      expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
      expect(bubble(root).props.accessibilityHint).toBe('Hold for options')
      expect(bubble(root).props.delayLongPress).toBe(400)
    })

    it('copies the words as typed without their Markdown marks, from Copy, and tints the bubble', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      await hold(root)
      await act(async () => row(root, 'Copy').props.onPress())
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(markdownPlainText(TYPED))
      expect(triggerSuccess).toHaveBeenCalledTimes(1)
      expect(flat(bubble(root).props.style).backgroundColor).toBe(palette.successSoft)
      expect(selectBody(root)).toBeUndefined()
    })

    it('closes the menu and opens the whole message in a selectable sheet from Select text', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      await hold(root)
      await act(async () => row(root, 'Select text').props.onPress())
      // The menu leaves first, then the sheet opens in its place.
      expect(menuRows(root)).toEqual([])
      const body = selectBody(root)
      expect(body).toBeDefined()
      expect(body!.props.selectable).toBe(true)
      expect(words(body!)).toBe(markdownPlainText(TYPED))
      expect(words(body!)).not.toMatch(/\*\*|`/)
      expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
    })

    it('draws the selected text in the sheet’s own ink, not the bubble’s', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      await hold(root)
      await act(async () => row(root, 'Select text').props.onPress())
      const text = root.find(
        (node) => String(node.type) === 'Text' && node.props.testID === 'select-text-body'
      )
      // The Claude sheet's text colour, `ad5.u0()` (b.java:2359 through ho7 case 3).
      expect(flat(text.props.style).color).toBe(palette.askText)
    })

    it('does not let a drag on the selectable words move the sheet', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      await hold(root)
      await act(async () => row(root, 'Select text').props.onPress())
      const sheet = drawers.seen.at(-1)!
      expect(sheet.dragContentToDismiss).toBe(false)
    })

    it('lets the sheet go once it has closed: the next hold opens the menu, not a stale sheet', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      await hold(root)
      await act(async () => row(root, 'Select text').props.onPress())
      const sheet = drawers.seen.at(-1)!
      await act(async () => (sheet.onClose as () => void)())
      expect(selectBody(root)).toBeUndefined()
      await hold(root)
      expect(menuRows(root)).toEqual(['Copy', 'Select text'])
      expect(selectBody(root)).toBeUndefined()
    })
  }
)

describe('the menu on a message still waiting behind a running turn', () => {
  it('offers Undo send first, and it takes the message back out of the queue', async () => {
    const onCancelQueued = vi.fn()
    const root = render(prompt([{ type: 'text', text: 'queued words' }]), 'light', {
      onCancelQueued
    })
    await hold(root)
    expect(menuRows(root)).toEqual(['Undo send', 'Copy', 'Select text'])
    await act(async () => row(root, 'Undo send').props.onPress())
    expect(onCancelQueued).toHaveBeenCalledTimes(1)
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
  })

  it('does not offer Send now: Claude Code takes a queued message between tool calls, there is no sooner', async () => {
    const root = render(prompt([{ type: 'text', text: 'queued words' }]), 'dark', {
      onCancelQueued: vi.fn()
    })
    await hold(root)
    expect(menuRows(root)).not.toContain('Send now')
  })

  // A label on the bubble replaces what TalkBack reads inside it; a sent prompt has always carried
  // "Sent prompt", but a waiting message was plain text before it could be held.
  it('is read by its own words and Queued line: no label over them, no button role', () => {
    const root = render(prompt([{ type: 'text', text: 'queued words' }]), 'light', {
      onCancelQueued: vi.fn()
    })
    expect(bubble(root).props.accessibilityLabel).toBeUndefined()
    expect(bubble(root).props.accessibilityRole).toBeUndefined()
    expect(bubble(root).props.accessibilityHint).toBe('Hold for options')
  })

  it('keeps its Queued line and Cancel beside the menu', () => {
    const root = render(prompt([{ type: 'text', text: 'queued words' }]), 'light', {
      onCancelQueued: vi.fn()
    })
    const cancel = root.findAll((node) => node.props.accessibilityLabel === 'Cancel queued message')
    expect(cancel.length).toBeGreaterThan(0)
  })

  it('still offers Undo send to a waiting message that has no words', async () => {
    const onCancelQueued = vi.fn()
    const root = render(prompt([{ type: 'image-ref', path: '/tmp/shot.png' }]), 'light', {
      onCancelQueued
    })
    await hold(root)
    expect(menuRows(root)).toEqual(['Undo send'])
  })
})

describe('a message with nothing to copy or select', () => {
  it.each(['light', 'dark'] as const)(
    'offers no hold at all on a prompt with no words, in %s',
    (scheme) => {
      const root = render(prompt([{ type: 'image-ref', path: '/tmp/shot.png' }]), scheme)
      expect(sentPrompt(root).props.onLongPress).toBeUndefined()
      expect(sentPrompt(root).props.accessibilityHint).toBeUndefined()
    }
  )

  it('offers no hold on a prompt with no blocks at all', () => {
    const root = render(prompt([]))
    expect(sentPrompt(root).props.onLongPress).toBeUndefined()
  })

  it('offers no hold on a prompt of blank words', () => {
    const root = render(prompt([{ type: 'text', text: ' \n ' }]))
    expect(sentPrompt(root).props.onLongPress).toBeUndefined()
  })
})

describe('a prompt of one character', () => {
  it('holds, copies and selects like any other', async () => {
    const root = render(prompt([{ type: 'text', text: 'k' }]))
    await hold(root)
    await act(async () => row(root, 'Select text').props.onPress())
    expect(words(selectBody(root)!)).toBe('k')
  })
})

describe('a prompt the lead agent wrote, drawn as Markdown', () => {
  it('selects the prompt as the words it shows, not its Markdown source (Claude gives the source; Code UI gives plain text, by the user’s choice)', async () => {
    const root = render(
      prompt([{ type: 'text', text: '**Task:** run `npm test` and report' }]),
      'light',
      {
        promptsAsMarkdown: true
      }
    )
    await hold(root)
    await act(async () => row(root, 'Select text').props.onPress())
    expect(words(selectBody(root)!)).toBe('Task: run npm test and report')
  })
})

// The chat list recycles a row's component instance for other messages (FlashList gives them one
// item type), so what a row holds in state belongs to the message it was opened on.
describe('a cell the list recycles for another message', () => {
  const bind = (message: NativeChatMessage): void => {
    act(() => {
      renderer!.update(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatMessage message={message} />
        </ThemeProvider>
      )
    })
  }

  it('does not carry an open menu over to the next prompt bound to it', async () => {
    const root = render(prompt([{ type: 'text', text: 'first words' }], 'u1'))
    await hold(root)
    expect(menuRows(root)).toEqual(['Copy', 'Select text'])
    bind(prompt([{ type: 'text', text: 'second words' }], 'u2'))
    expect(menuRows(root)).toEqual([])
  })

  it('does not open by itself when a prompt comes back to a cell a reply passed through', async () => {
    const root = render(prompt([{ type: 'text', text: 'first words' }], 'u1'))
    await hold(root)
    bind(reply)
    bind(prompt([{ type: 'text', text: 'third words' }], 'u3'))
    expect(menuRows(root)).toEqual([])
  })

  it('does not open by itself when the very prompt that was held is bound back to it', async () => {
    const first = prompt([{ type: 'text', text: 'first words' }], 'u1')
    const root = render(first)
    await hold(root)
    bind(prompt([{ type: 'text', text: 'second words' }], 'u2'))
    bind(first)
    expect(menuRows(root)).toEqual([])
  })

  it('does not show the selected words of one prompt under another', async () => {
    const root = render(prompt([{ type: 'text', text: 'first words' }], 'u1'))
    await hold(root)
    await act(async () => row(root, 'Select text').props.onPress())
    expect(words(selectBody(root)!)).toBe('first words')
    bind(prompt([{ type: 'text', text: 'second words' }], 'u2'))
    expect(selectBody(root)).toBeUndefined()
  })
})

describe('a reply', () => {
  it('is not held as a sent prompt: no tap, no prompt label, no menu hold (its words select in place)', () => {
    const root = render(reply)
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Sent prompt')).toEqual([])
    const holds = root.findAll((node) => String(node.type) === 'Pressable' && typeof node.props.onLongPress === 'function')
    expect(holds).toHaveLength(0)
  })
})
