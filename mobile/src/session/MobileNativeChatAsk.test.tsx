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
vi.mock('lucide-react-native', () => ({ Check: 'Check', ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight' }))
vi.mock('../ui/Button', () => ({ Button: 'Button' }))
// The real row so its onPress is reachable; only its leaf pieces are stubbed.
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../notifications/notification-plain-text', () => ({
  notificationPlainText: (text: string) => text
}))

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
 * touching the cancel and submit buttons row and seemed cluttered." That was the
 * free-text box drawing its own border above the footer rule. The Claude app's
 * card has no such box: the free answer is a borderless field inside the last
 * row, so nothing of it can meet the footer's rule (ask-card-claude-look.test.tsx).
 */
describe('the free-text field on an ask card', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('draws no border of its own, so no second line sits against the footer rule', () => {
    act(() => {
      renderer = create(createElement(MobileNativeChatAsk, { prompt, onAnswer: async () => true }))
    })
    const input = renderer!.root.findByType('TextInput' as never)
    const style = flatten(input.props.style)
    expect(style.borderWidth ?? 0).toBe(0)
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
    const next = renderer!.root
      .findAllByType('Pressable' as never)
      .find((node) => node.props.accessibilityLabel === 'Next question')!
    act(() => next.props.onPress())
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
      expect(renderer!.root.findByType('TextInput' as never).props.placeholder).toBe('Something else')
      // Nothing typed yet, so the choices keep their strength.
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
    act(() => renderer!.root.findByType('TextInput' as never).props.onChangeText('and a widget'))
    expect(rows().slice(0, 2).map(opacityOf)).toEqual([1, 1])
  })
})
