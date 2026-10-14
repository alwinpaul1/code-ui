import { useEffect, useRef, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'

// The Claude app's message menu (1.261009.20, gv20.java:583-860): a hold on a
// sent message opens a menu of "Copy message" and "Select text", with "Undo
// send" first on a message still waiting. Before this a hold copied the
// prompt at once and there was no way to select part of it (the bubble's text
// is not selectable on purpose: a selectable Text took the hold first).
// A reply keeps its in-place selection (the user, 2026-10-09: "the hold to
// copy was good before ... revert"); only the sent prompt gets the menu.

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
import { triggerSuccess } from '../platform/haptics'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

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

const bubble = (root: ReactTestInstance): ReactTestInstance =>
  root.find(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Sent prompt'
  )

/** The menu's rows, by the words on them. */
const menuRows = (root: ReactTestInstance): string[] =>
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

const selectBody = (root: ReactTestInstance): ReactTestInstance | undefined =>
  root.findAll(
    (node) => node.props.testID === 'select-text-body' && typeof node.type !== 'string'
  )[0]

async function hold(root: ReactTestInstance): Promise<void> {
  await act(async () => {
    bubble(root).props.onLongPress()
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
    it('opens a menu of Copy message and Select text instead of copying at once', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      expect(menuRows(root)).toEqual([])
      await hold(root)
      expect(menuRows(root)).toEqual(['Copy message', 'Select text'])
      expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
      expect(bubble(root).props.accessibilityHint).toBe('Hold for options')
      expect(bubble(root).props.delayLongPress).toBe(400)
    })

    it('copies the words as typed, Markdown marks and all, from Copy message, and tints the bubble', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      await hold(root)
      await act(async () => row(root, 'Copy message').props.onPress())
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(TYPED)
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
      expect(words(body!)).toBe(TYPED)
      expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
    })

    it('draws the selected text in the sheet’s own ink, not the bubble’s', async () => {
      const root = render(prompt([{ type: 'text', text: TYPED }]), scheme)
      await hold(root)
      await act(async () => row(root, 'Select text').props.onPress())
      const text = root.find(
        (node) => String(node.type) === 'Text' && node.props.testID === 'select-text-body'
      )
      expect(flat(text.props.style).color).toBe(palette.text)
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
      expect(menuRows(root)).toEqual(['Copy message', 'Select text'])
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
    expect(menuRows(root)).toEqual(['Undo send', 'Copy message', 'Select text'])
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
      expect(bubble(root).props.onLongPress).toBeUndefined()
      expect(bubble(root).props.accessibilityHint).toBeUndefined()
    }
  )

  it('offers no hold on a prompt with no blocks at all', () => {
    const root = render(prompt([]))
    expect(bubble(root).props.onLongPress).toBeUndefined()
  })

  it('offers no hold on a prompt of blank words', () => {
    const root = render(prompt([{ type: 'text', text: ' \n ' }]))
    expect(bubble(root).props.onLongPress).toBeUndefined()
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
  it('copies and selects the words it shows, as a reply’s Copy does', async () => {
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

describe('a reply', () => {
  it('has no hold menu: its words stay selectable in place, as the user asked on 2026-10-09', () => {
    const root = render(reply)
    expect(root.findAll((node) => node.props.accessibilityLabel === 'Sent prompt')).toEqual([])
    expect(root.findAll((node) => typeof node.props.onLongPress === 'function')).toEqual([])
  })
})
