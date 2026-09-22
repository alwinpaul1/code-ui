import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'

vi.mock('react-native', async () => {
  const React = await import('react')
  const passthrough =
    (name: string) =>
    ({ children, ...props }: { children?: unknown }) =>
      React.createElement(name, props, children)
  return {
    Pressable: passthrough('Pressable'),
    ScrollView: passthrough('ScrollView'),
    TextInput: passthrough('TextInput'),
    View: passthrough('View'),
    useWindowDimensions: () => ({ width: 400, height: 900 })
  }
})
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))
vi.mock('../ui/Button', () => ({ Button: 'Button' }))
// The real row so its onPress is reachable; only its leaf pieces are stubbed.
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../notifications/notification-plain-text', () => ({
  notificationPlainText: (text: string) => text
}))

import { space } from '../theme/tokens'
import { MobileNativeChatAsk } from './MobileNativeChatAsk'

const prompt: AskPrompt = {
  questions: [
    {
      question: 'Which one?',
      header: 'Pick',
      multiSelect: false,
      options: [
        { label: 'First', description: 'the first' },
        { label: 'Second', description: 'the second' }
      ]
    }
  ]
} as AskPrompt

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    const all: Record<string, unknown> = {}
    for (const one of style) {
      Object.assign(all, flatten(one))
    }
    return all
  }
  return (style ?? {}) as Record<string, unknown>
}

/**
 * 2026-09-15 from the phone: "the typing input of that question card was
 * touching the cancel and submit buttons row and seemed cluttered." The free
 * text box has a visible border of its own and the footer has a divider above
 * it, so the two lines landed almost on top of each other with only 12px of
 * total clearance between them.
 */
describe('the free-text box on an ask card', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('does not sit against the Cancel and Submit row', () => {
    act(() => {
      renderer = create(
        createElement(MobileNativeChatAsk, { prompt, onAnswer: async () => true })
      )
    })
    // The free-text box only exists once "Other…" is chosen.
    act(() => {
      // "Other…" is the last option row.
      const rows = renderer!.root
        .findAllByType('Pressable' as never)
        .filter((node) => node.props.accessibilityRole === 'radio')
      rows.at(-1)?.props.onPress?.()
    })
    const input = renderer!.root.findByType('TextInput' as never)
    const scroll = renderer!.root
      .findAllByType('ScrollView' as never)
      .find((node) => flatten(node.props.contentContainerStyle).paddingBottom !== undefined)

    const below = Number(flatten(input.props.style).marginBottom ?? 0)
    const scrollPad = Number(flatten(scroll?.props.contentContainerStyle).paddingBottom ?? 0)
    // Two borders meeting needs more than a hairline between them.
    expect(below + scrollPad).toBeGreaterThanOrEqual(space.lg + space.sm)
  })

  it('clears the Other row border when the answer box opens', () => {
    act(() => {
      renderer = create(
        createElement(MobileNativeChatAsk, { prompt, onAnswer: async () => true })
      )
    })
    act(() => {
      const rows = renderer!.root
        .findAllByType('Pressable' as never)
        .filter((node) => node.props.accessibilityRole === 'radio')
      rows.at(-1)?.props.onPress?.()
    })
    const input = renderer!.root.findByType('TextInput' as never)
    const style = flatten(input.props.style)
    // The Other row already has a border. With no gap above the field, that
    // line and the field's own top edge read as one overlapping stroke
    // (Claude ask card, 2026-09-22).
    expect(Number(style.marginTop ?? 0)).toBeGreaterThanOrEqual(space.md)
    expect(input.props.underlineColorAndroid).toBe('transparent')
  })
})
