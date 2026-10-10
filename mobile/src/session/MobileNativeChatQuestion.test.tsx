import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatQuestion } from './MobileNativeChatQuestion'

let colorScheme: 'light' | 'dark' = 'light'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => colorScheme,
  ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  CircleHelp: 'CircleHelp',
  X: 'X'
}))

function renderQuestion(
  question: Record<string, unknown>,
  onAnswer: (text: string) => Promise<boolean>,
  preference: 'light' | 'dark' = 'light'
) {
  colorScheme = preference
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: preference },
        createElement(MobileNativeChatQuestion, { question, onAnswer } as never)
      )
    )
  })
  return renderer as unknown as ReactTestRenderer
}

describe('MobileNativeChatQuestion', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    colorScheme = 'light'
  })

  it('submits the selected duplicate-label row by position', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion(
      {
        question: 'Pick regions',
        options: ['Region', 'Region'],
        multiSelect: true,
        allowOther: false,
        optionTokens: ['first-token', 'second-token']
      },
      onAnswer
    )

    const choices = renderer.root.findAllByProps({ accessibilityRole: 'checkbox' })
    await act(async () => choices[1]!.props.onPress())
    const submit = renderer.root.findByProps({ accessibilityLabel: 'Submit selected options' })
    await act(async () => submit.props.onPress())

    expect(onAnswer).toHaveBeenCalledWith('second-token')
  })

  it('submits a tokenless duplicate-label row by position', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion(
      {
        question: 'Pick one',
        options: ['Choice', 'Choice'],
        multiSelect: false,
        allowOther: false,
        optionTokens: ['first-token', null]
      },
      onAnswer
    )

    const choices = renderer.root.findAllByProps({ accessibilityRole: 'button' })
    await act(async () => choices[1]!.props.onPress())

    expect(onAnswer).toHaveBeenCalledWith('Choice')
  })

  it('submits multi-select choices together with the other text', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion(
      {
        question: 'Pick regions',
        options: ['us-east', 'eu-west'],
        multiSelect: true,
        allowOther: true,
        optionTokens: ['east-token', 'west-token'],
        freeTextToken: 'other-token'
      },
      onAnswer
    )

    const choices = renderer.root.findAllByProps({ accessibilityRole: 'checkbox' })
    await act(async () => choices[0]!.props.onPress())
    const input = renderer.root.findByType('TextInput' as never)
    await act(async () => input.props.onChangeText('ap-south'))
    const submit = renderer.root.findByProps({ accessibilityLabel: 'Submit selected options' })
    await act(async () => submit.props.onPress())

    expect(onAnswer).toHaveBeenCalledWith('east-token, other-token:ap-south')
  })

  it('shows the option description under its label', () => {
    renderer = renderQuestion(
      {
        question: 'Pick one',
        options: ['Fast', 'Thorough'],
        multiSelect: false,
        allowOther: false,
        optionTokens: [null, null],
        optionDescriptions: ['Skips the deep scan', 'Reads every file']
      },
      async () => true
    )

    const texts = renderer.root
      .findAllByType('Text' as never)
      .flatMap((node) => node.props.children)
    expect(texts).toContain('Skips the deep scan')
    expect(texts).toContain('Reads every file')
  })

  // Orca #20601: the X on the card cancels the prompt itself, naming the item.
  it('passes the rendered prompt identity to cancel, in both themes', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const onCancel = vi.fn(async () => true)
      colorScheme = scheme
      await act(async () => {
        renderer = create(
          createElement(
            ThemeProvider,
            { initialPreference: scheme },
            createElement(MobileNativeChatQuestion, {
              question: {
                question: 'Pick one',
                prompt: { itemId: 'question-1', expectedRevision: 7 },
                options: ['Choice'],
                multiSelect: false,
                allowOther: false,
                optionTokens: ['choice-token']
              },
              onAnswer: vi.fn(async () => true),
              onCancel
            })
          )
        )
      })
      const cancel = renderer!.root.findByProps({ accessibilityLabel: 'Cancel' })
      await act(async () => cancel.props.onPress())
      expect(onCancel).toHaveBeenCalledWith({ itemId: 'question-1', expectedRevision: 7 })
      expect(renderer!.root.findByType('X').props.color).toBe(
        (scheme === 'dark' ? darkColors : lightColors).textMuted
      )
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('keeps the option description readable in light and dark', () => {
    const question = {
      question: 'Pick one',
      options: ['Fast'],
      multiSelect: false,
      allowOther: false,
      optionTokens: [null],
      optionDescriptions: ['Skips the deep scan']
    }

    const descriptionColor = (preference: 'light' | 'dark'): unknown => {
      const tree = renderQuestion(question, async () => true, preference)
      const node = tree.root
        .findAllByType('Text' as never)
        .find((candidate) => candidate.props.children === 'Skips the deep scan')
      const style = ([] as unknown[]).concat(node?.props.style ?? []) as { color?: unknown }[]
      const color = style.map((entry) => entry?.color).find((entry) => entry !== undefined)
      act(() => tree.unmount())
      return color
    }

    const light = descriptionColor('light')
    const dark = descriptionColor('dark')
    expect(light).toBe(lightColors.textMuted)
    expect(dark).toBe(darkColors.textMuted)
    expect(light).not.toBe(dark)
  })
})

// The same shape as the ask card's (ask-card-submit-feedback.test.tsx): this
// card has no dismissal, so it stays up until the hook row moves on, and an
// accepted answer used to hand every row back. A single-select row answers on
// the tap itself, so a second tap before the row moved sent a second answer.
describe('the question card between the tap and the agent taking the answer', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    colorScheme = 'light'
  })

  const pickOne = {
    question: 'Which branch should I push?',
    options: ['main', 'fix/ask-submit-feedback'],
    multiSelect: false,
    allowOther: true,
    optionTokens: ['1', '2']
  }

  /** The option rows: host Pressables in the button role (single-select). */
  function optionRows(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'button'
    )
  }

  function captions(tree: ReactTestRenderer): { text: string; color: unknown }[] {
    return tree.root
      .findAllByType('Text' as never)
      .filter((node) => typeof node.props.children === 'string')
      .map((node) => ({
        text: node.props.children as string,
        color: ([] as { color?: unknown }[]).concat(node.props.style ?? []).map((entry) => entry?.color).find(Boolean)
      }))
  }

  it('does not send the answer twice when an option is tapped again before the card goes', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion(pickOne, onAnswer)
    const rows = optionRows(renderer)
    await act(async () => rows[0]!.props.onPress())
    // The test renderer does not drop taps on a disabled Pressable, so these
    // also prove the handlers refuse; the disabled flags are checked after.
    const again = optionRows(renderer)
    await act(async () => again[1]!.props.onPress())
    const reply = renderer.root.findByProps({ accessibilityLabel: 'Send reply' })
    act(() => renderer!.root.findByType('TextInput' as never).props.onChangeText('the other one'))
    await act(async () => reply.props.onPress())

    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer).toHaveBeenCalledWith('1')
    expect(again[1]!.props.disabled, 'the rows came back live after an accepted answer').toBe(true)
  })

  it.each(['light', 'dark'] as const)('says Sending, then Sent and waiting, in %s ink', async (scheme) => {
    let settle: (accepted: boolean) => void = () => undefined
    renderer = renderQuestion(
      pickOne,
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        }),
      scheme
    )
    const palette = scheme === 'dark' ? darkColors : lightColors
    const rows = optionRows(renderer)
    await act(async () => {
      rows[0]!.props.onPress()
    })
    expect(captions(renderer)).toContainEqual({ text: 'Sending answer…', color: palette.textSecondary })
    await act(async () => settle(true))
    expect(captions(renderer)).toContainEqual({ text: 'Answer sent · waiting for agent', color: palette.textSecondary })
  })

  it('gives the rows back at once when the answer is refused', async () => {
    const onAnswer = vi.fn(async () => false)
    renderer = renderQuestion(pickOne, onAnswer)
    const rows = () => optionRows(renderer!)
    await act(async () => rows()[0]!.props.onPress())
    expect(rows()[1]!.props.disabled).toBeFalsy()
    expect(captions(renderer).map((caption) => caption.text)).not.toContain('Answer sent · waiting for agent')
    await act(async () => rows()[1]!.props.onPress())
    expect(onAnswer).toHaveBeenCalledTimes(2)
  })

  // Orca #25851: a provider's editor/input dialog (Pi's) prefills, keeps whitespace, and may send empty.
  for (const scheme of ['light', 'dark'] as const) {
    it(`prefills an editor and sends its whitespace unchanged (${scheme})`, async () => {
      const onAnswer = vi.fn(async () => true)
      renderer = renderQuestion(
        {
          question: 'Edit the draft',
          options: [],
          multiSelect: false,
          optionTokens: [],
          freeTextToken: 'editor-token',
          freeTextInput: {
            allowEmpty: true,
            multiline: true,
            initialValue: '  draft\n',
            placeholder: 'Write here'
          }
        },
        onAnswer,
        scheme
      )
      const input = renderer.root.findByType('TextInput' as never)
      expect(input.props).toMatchObject({ value: '  draft\n', placeholder: 'Write here', multiline: true })
      await act(async () => input.props.onChangeText('  \n '))
      const send = renderer.root.findByProps({ accessibilityLabel: 'Send reply' })
      expect(send.props.disabled).toBe(false)
      await act(async () => send.props.onPress())
      expect(onAnswer).toHaveBeenCalledWith(`editor-token:${encodeURIComponent('  \n ')}`)
    })
  }

  it('sends an empty allowed answer and still disables an empty legacy answer', async () => {
    const onAnswer = vi.fn(async () => true)
    const question = {
      question: 'Input',
      options: [],
      multiSelect: false,
      optionTokens: [],
      freeTextToken: 'input-token'
    }
    renderer = renderQuestion({ ...question, freeTextInput: { allowEmpty: true, multiline: false } }, onAnswer)
    const send = renderer.root.findByProps({ accessibilityLabel: 'Send reply' })
    expect(renderer.root.findByType('TextInput' as never).props.multiline).toBe(false)
    expect(send.props.disabled).toBe(false)
    await act(async () => send.props.onPress())
    expect(onAnswer).toHaveBeenCalledWith('input-token:')

    renderer.unmount()
    renderer = renderQuestion(question, onAnswer)
    expect(renderer.root.findByProps({ accessibilityLabel: 'Send reply' }).props.disabled).toBe(true)
  })
})
