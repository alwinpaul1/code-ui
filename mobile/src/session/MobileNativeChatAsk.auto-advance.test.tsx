import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'
import { NATIVE_CHAT_QUESTION_AUTO_ADVANCE_MS } from '../../../src/shared/native-chat-question-auto-advance'

// Orca #26288 (7c88ab7dd5): a single-select pick answers the question, so the
// card moves to the next question, or sends after the last one, without a
// Submit tap. Upstream's MobileNativeChatAsk.test.tsx, adapted to this fork's
// card: the rows are themed Pressables with the label in a Txt child, and
// Cancel and Submit are the shared Button.

vi.mock('react-native', async () => {
  const React = await import('react')
  const passthrough =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
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
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../notifications/notification-plain-text', () => ({
  notificationPlainText: (text: string) => text
}))

import { MobileNativeChatAsk } from './MobileNativeChatAsk'

const indent = {
  question: 'Tabs or spaces?',
  header: 'Indent',
  multiSelect: false,
  options: [{ label: 'Tabs' }, { label: 'Spaces' }]
}
const fruit = {
  question: 'Which fruit?',
  header: 'Fruit',
  multiSelect: false,
  options: [{ label: 'Apple' }, { label: 'Banana' }]
}

let tree: ReactTestRenderer

function render(prompt: AskPrompt, onAnswer = vi.fn(async () => true)): typeof onAnswer {
  vi.useFakeTimers()
  act(() => {
    tree = create(createElement(MobileNativeChatAsk, { prompt, onAnswer, onCancel: async () => true }))
  })
  return onAnswer
}

function row(label: string): ReactTestInstance {
  return tree.root.find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      (node.props.accessibilityRole === 'radio' || node.props.accessibilityRole === 'checkbox') &&
      node.findAll((n) => (n.type as unknown) === 'Txt' && n.props.children === label).length > 0
  )
}

function press(label: string): void {
  act(() => row(label).props.onPress())
}

function button(label: string): ReactTestInstance {
  return tree.root.find((node) => (node.type as unknown) === 'Button' && node.props.label === label)
}

async function passAutoAdvanceBeat(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_QUESTION_AUTO_ADVANCE_MS)
  })
}

const shows = (text: string): boolean =>
  tree.root.findAll((node) => (node.type as unknown) === 'Txt' && node.props.children === text).length > 0

afterEach(() => {
  act(() => tree.unmount())
  vi.useRealTimers()
})

describe('MobileNativeChatAsk single-select auto-advance', () => {
  it('moves to the next question after a pick and sends after the last one', async () => {
    const onAnswer = render({ questions: [indent, fruit] } as AskPrompt)

    press('Spaces')
    expect(shows('Tabs or spaces?')).toBe(true)
    await passAutoAdvanceBeat()
    expect(shows('Which fruit?')).toBe(true)
    expect(onAnswer).not.toHaveBeenCalled()
    press('Apple')
    await passAutoAdvanceBeat()

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [1] }, { indices: [0] }])
  })

  it('takes a pick back when the same row is tapped again inside the beat', async () => {
    const onAnswer = render({ questions: [indent] } as AskPrompt)

    press('Spaces')
    press('Spaces')
    await passAutoAdvanceBeat()

    expect(onAnswer).not.toHaveBeenCalled()
    expect(row('Spaces').props.accessibilityState).toMatchObject({ checked: false })
  })

  it('waits for the typed text when "Other…" is picked', async () => {
    const onAnswer = render({ questions: [indent] } as AskPrompt)

    press('Other…')
    await passAutoAdvanceBeat()

    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('waits for Submit on a multi-select question', async () => {
    const onAnswer = render({ questions: [{ ...fruit, multiSelect: true }] } as AskPrompt)

    press('Apple')
    await passAutoAdvanceBeat()

    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('holds its choices while an answer is being delivered', async () => {
    const onAnswer = render(
      { questions: [indent] } as AskPrompt,
      vi.fn(() => new Promise<boolean>(() => {}))
    )

    press('Tabs')
    await passAutoAdvanceBeat()
    press('Spaces')
    await passAutoAdvanceBeat()

    expect(row('Spaces').props).toMatchObject({ disabled: true })
    expect(row('Spaces').props.accessibilityState).toMatchObject({ checked: false })
    expect(row('Tabs').props.accessibilityState).toMatchObject({ checked: true })
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [0] }])
  })

  it('sends nothing when the question is cancelled before the pick moves on', async () => {
    const onAnswer = render({ questions: [indent] } as AskPrompt)

    press('Spaces')
    await act(async () => button('Cancel').props.onPress())
    await passAutoAdvanceBeat()

    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('sends once when Submit is tapped inside the beat', async () => {
    const onAnswer = render({ questions: [indent] } as AskPrompt)

    press('Tabs')
    await act(async () => button('Submit').props.onPress())
    await passAutoAdvanceBeat()

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [0] }])
  })
})
