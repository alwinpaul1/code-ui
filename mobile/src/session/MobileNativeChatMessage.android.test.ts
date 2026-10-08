import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// Orca #22871. Android draws the chat transcript with no inline selection (two
// flicks in one spot while scrolling read as a double tap and selected a
// word), so a long press on a message opens a sheet with "Copy message" and
// "Select text". This pins the wiring from the row's long press to that sheet,
// for every kind of row whose prose is Markdown, and that a sent prompt keeps
// this fork's hold-to-copy (2026-09-21) instead of the sheet.
const { setStringAsync } = vi.hoisted(() => ({ setStringAsync: vi.fn(async () => true) }))
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
vi.mock('expo-clipboard', () => ({ setStringAsync }))
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
vi.mock('./MobileNativeChatMessageActionsSheet', () => ({
  MobileNativeChatMessageActionsSheet: 'MessageActionsSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))

import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const message: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Read https://example.com then reply.' }],
  timestamp: null,
  source: 'transcript'
}

describe('MobileNativeChatMessage on Android', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => setStringAsync.mockClear())

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function byType(type: string): ReactTestInstance[] {
    return renderer!.root.findAll((node) => String(node.type) === type)
  }

  function render(value: NativeChatMessage): void {
    act(() => {
      renderer = create(createElement(MobileNativeChatMessage, { message: value }))
    })
  }

  it('opens the actions sheet from a long press on the bubble, and closes it again', () => {
    render(message)
    expect(byType('MessageActionsSheet')).toHaveLength(0)

    const [bubble] = byType('Pressable')
    expect(typeof bubble!.props.onLongPress).toBe('function')
    // The markdown gets the same handler, so a link span or image under the finger opens the sheet.
    const [markdown] = byType('MobileMarkdown')
    expect(markdown!.props.onLongPress).toBe(bubble!.props.onLongPress)
    expect(markdown!.props.rangeSelectable).toBe(true)

    act(() => bubble!.props.onLongPress())
    const [sheet] = byType('MessageActionsSheet')
    expect(sheet!.props.message).toBe(message)

    act(() => sheet!.props.onClose())
    expect(byType('MessageActionsSheet')).toHaveLength(0)
  })

  // Upstream pins its host notices here; this fork has none, and its
  // transcript rows of their own (a thought, a subagent's message, a plan)
  // draw Markdown outside the bubble, so each needs the gate and the sheet.
  it.each([
    [
      'a thought',
      { ...message, id: 'r1', role: 'reasoning', blocks: [{ type: 'text', text: 'Thinking it over.' }] }
    ],
    [
      'a plan document',
      {
        ...message,
        id: 's1',
        role: 'system',
        blocks: [{ type: 'text', text: '1. Do it', presentation: 'plan-document' }]
      }
    ]
  ] as [string, NativeChatMessage][])('turns inline selection off for %s and opens the sheet on a hold', (_label, row) => {
    render(row)
    const [markdown] = byType('MobileMarkdown')
    expect(markdown!.props.rangeSelectable).toBe(true)
    expect(typeof markdown!.props.onLongPress).toBe('function')
    const holder = byType('Pressable').find((node) => node.props.onLongPress === markdown!.props.onLongPress)
    expect(holder).toBeDefined()
    act(() => holder!.props.onLongPress())
    expect(byType('MessageActionsSheet')).toHaveLength(1)
    expect(byType('MessageActionsSheet')[0]!.props.message).toBe(row)
  })

  it('renders the user bubble without inline selection, and a hold still copies the prompt', () => {
    render({ ...message, id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'ship it' }] })
    expect(byType('Text').filter((node) => node.props.selectable === true)).toHaveLength(0)
    const [bubble] = byType('Pressable')
    act(() => bubble!.props.onLongPress())
    expect(setStringAsync).toHaveBeenCalledWith('ship it')
    expect(byType('MessageActionsSheet')).toHaveLength(0)
  })

  it('keeps the agent message’s Copy control copying the reply', () => {
    render(message)
    const copy = byType('Pressable').find((node) => node.props.accessibilityLabel === 'Copy message')
    expect(copy).toBeDefined()
    act(() => copy!.props.onPress())
    expect(setStringAsync).toHaveBeenCalledWith('Read https://example.com then reply.')
  })
})
