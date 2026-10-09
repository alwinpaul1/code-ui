import { existsSync } from 'node:fs'
import path from 'node:path'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

// 2026-10-09, the user: "the hold to copy was good before which we
// implemented; the ported thingy is bad, revert". Orca #22871 had replaced
// the fork's in-place selection on the Android transcript with a long-press
// sheet (Copy message / Select text). What comes back is 0.9.116's: a long
// press in a reply starts Android's own selection, its handles drag across
// words, lines, paragraphs and list items of the reply, and Copy gives the
// selected words. That takes three things this pins on Android: the reply's
// prose is ONE selectable Text, nothing above it takes the long press first,
// and no actions sheet exists to open. The 2026-09-12 scroll gate (no
// selection while a fling is in flight) comes back with it.
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
    Image: Object.assign(() => null, { getSize: () => undefined }),
    Linking: { openURL: () => Promise.resolve() },
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
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))

import { ChatTextSelectableContext } from '../components/chat-text-selectable-context'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

const REPLY = [
  'First paragraph of the reply.',
  '',
  'Second paragraph, with **bold** words.',
  '',
  '- one item',
  '- another item'
].join('\n')

const reply: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: REPLY }],
  timestamp: null,
  source: 'transcript'
}

/** The words a Text draws, its nested spans included. */
function words(node: ReactTestInstance | string): string {
  if (typeof node === 'string') {
    return node
  }
  return node.children.map(words).join('')
}

describe('holding a reply on Android selects its text in place', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(message: NativeChatMessage, selectable?: boolean): ReactTestInstance {
    const row = createElement(MobileNativeChatMessage, { message })
    act(() => {
      renderer = create(
        selectable === undefined ? row : createElement(ChatTextSelectableContext.Provider, { value: selectable }, row)
      )
    })
    return renderer!.root
  }

  /** The Text that holds `first`, whose selection can run to `last`. */
  function proseHolding(root: ReactTestInstance, first: string, last: string): ReactTestInstance | undefined {
    return root.findAll(
      (node) => String(node.type) === 'Text' && node.props.selectable === true && words(node).includes(first) && words(node).includes(last)
    )[0]
  }

  function longPressAbove(node: ReactTestInstance): unknown[] {
    const found: unknown[] = []
    for (let at = node.parent; at; at = at.parent) {
      if (typeof at.props.onLongPress === 'function') {
        found.push(at.type)
      }
    }
    return found
  }

  it('lets one hold drag from the first paragraph to the last list item: one selectable Text, nothing above it taking the hold', () => {
    const root = render(reply)
    const prose = proseHolding(root, 'First paragraph', 'another item')
    expect(prose).toBeDefined()
    expect(longPressAbove(prose!)).toEqual([])
  })

  it.each([
    ['a thought', { ...reply, id: 'r1', role: 'reasoning', blocks: [{ type: 'text', text: 'Thinking it over.\n\nThen again.' }] }],
    [
      'a plan document',
      { ...reply, id: 's1', role: 'system', blocks: [{ type: 'text', text: 'Plan intro.\n\n1. Do it', presentation: 'plan-document' }] }
    ]
  ] as [string, NativeChatMessage][])('selects %s in place too', (_label, message) => {
    const root = render(message)
    const text = (message.blocks[0] as { text: string }).text
    const first = text.split('\n')[0]!
    const last = text.split('\n').at(-1)!.replace(/^\d+\. /, '')
    const prose = proseHolding(root, first, last)
    expect(prose).toBeDefined()
    expect(longPressAbove(prose!)).toEqual([])
  })

  it('has no actions sheet to open: the #22871 sheet is gone', () => {
    expect(existsSync(path.join(__dirname, 'MobileNativeChatMessageActionsSheet.tsx'))).toBe(false)
    expect(existsSync(path.join(__dirname, 'MobileNativeChatLongPressRow.tsx'))).toBe(false)
  })

  // 2026-09-12: a finger put down to stop a fling and held armed Android's
  // selection and buzzed. The chat view turns selection off while a scroll is
  // in flight (use-mobile-chat-following.ts) and on once it settles.
  it('selects nothing while the list is scrolling, and the reply again once it settles', () => {
    const scrolling = render(reply, false)
    expect(scrolling.findAll((node) => String(node.type) === 'Text' && node.props.selectable === true)).toHaveLength(0)
    act(() => renderer?.unmount())
    renderer = null
    expect(proseHolding(render(reply, true), 'First paragraph', 'another item')).toBeDefined()
  })
})
