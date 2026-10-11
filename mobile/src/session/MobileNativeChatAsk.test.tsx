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
    useColorScheme: () => 'light',
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
import { ThemeProvider } from '../theme/theme-context'
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
    // The free-text box only exists once "Something else" is chosen.
    act(() => {
      // "Something else" is the last option row.
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

/** The two questions Claude Code 2.1.282 drew for UI test 5
 *  (fixtures/claude-screen-ask-two-questions-2.1.282.txt), as the card gets them. */
const TWO_QUESTIONS_2_1_282: AskPrompt = {
  questions: [
    {
      question: 'Where should the Hours view go?',
      header: 'Placement',
      multiSelect: false,
      options: [
        { label: 'Tab in Fleet', description: 'A new tab' },
        { label: 'New sidebar page', description: 'Its own item' }
      ]
    },
    {
      question: 'Push after the change?',
      header: 'Push',
      multiSelect: false,
      options: [
        { label: 'Yes, push to PR 1100', description: 'Push now' },
        { label: 'No, keep it local', description: 'Stay local' }
      ]
    }
  ]
} as AskPrompt

// The Claude app 1.261009.20's question card counts its pages "1 of 2"
// (`question_card_page`), calls its free answer "Something else"
// (`question_card_other_hint`), and dims the choices to 0.4 once one is typed.
describe('an ask card, the Claude app’s way', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const txt = (value: string) =>
    renderer!.root.findAll((node) => (node.type as unknown) === 'Txt' && [node.props.children].flat().join('') === value)
  const rows = () =>
    renderer!.root
      .findAllByType('Pressable' as never)
      .filter((node) => node.props.accessibilityRole === 'radio' || node.props.accessibilityRole === 'checkbox')
  const opacityOf = (row: { props: { style: unknown } }): number => {
    const style = typeof row.props.style === 'function' ? (row.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : row.props.style
    return Number(flatten(style).opacity ?? 1)
  }

  it('counts the questions "1 of 2", then "2 of 2"', () => {
    act(() => {
      renderer = create(createElement(MobileNativeChatAsk, { prompt: TWO_QUESTIONS_2_1_282, onAnswer: async () => true }))
    })
    expect(txt('1 of 2')).toHaveLength(1)
    expect(txt('1/2')).toHaveLength(0)
    const tabs = renderer!.root.findAllByType('Pressable' as never).filter((node) => node.props.accessibilityRole === 'tab')
    act(() => tabs[1]!.props.onPress())
    expect(txt('2 of 2')).toHaveLength(1)
  })

  it.each(['light', 'dark'] as const)(
    'offers "Something else" and dims the choices to 0.4 once a single-select answer is typed there, in %s',
    (scheme) => {
      act(() => {
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: scheme },
            createElement(MobileNativeChatAsk, { prompt: TWO_QUESTIONS_2_1_282, onAnswer: async () => true })
          )
        )
      })
      expect(txt('Something else')).toHaveLength(1)
      expect(txt('Other…')).toHaveLength(0)
      act(() => rows().at(-1)!.props.onPress())
      // Chosen but empty: nothing typed yet, so the choices keep their strength.
      expect(rows().slice(0, 2).map(opacityOf)).toEqual([1, 1])
      act(() => renderer!.root.findByType('TextInput' as never).props.onChangeText('A popover on the map'))
      expect(rows().slice(0, 2).map(opacityOf)).toEqual([0.4, 0.4])
      expect(opacityOf(rows().at(-1)!)).toBe(1)
    }
  )

  it('leaves a multi-select question’s choices at full strength, since they stay part of the answer', () => {
    const multi = {
      questions: [{ ...TWO_QUESTIONS_2_1_282.questions[0]!, multiSelect: true }]
    } as AskPrompt
    act(() => {
      renderer = create(createElement(MobileNativeChatAsk, { prompt: multi, onAnswer: async () => true }))
    })
    act(() => rows()[0]!.props.onPress())
    act(() => rows().at(-1)!.props.onPress())
    act(() => renderer!.root.findByType('TextInput' as never).props.onChangeText('and a widget'))
    expect(rows().slice(0, 2).map(opacityOf)).toEqual([1, 1])
  })
})
