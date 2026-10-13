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

    const choices = renderer.root.findAllByProps({ accessibilityRole: 'radio' })
    await act(async () => choices[1]!.props.onPress())
    const submit = renderer.root.findByProps({ accessibilityLabel: 'Submit selected options' })
    await act(async () => submit.props.onPress())

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
// accepted answer used to hand every row back, so a second answer before the
// row moved sent a second answer. (A single-select row answered on the tap
// itself then; since 2026-10-13 a tap chooses and Submit sends.)
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

  /** The option rows: host Pressables in the radio role (single-select). */
  function optionRows(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio'
    )
  }

  /** Choose a row, then Submit it: the card's two taps for one answer. */
  async function answerWith(tree: ReactTestRenderer, row: number): Promise<void> {
    await act(async () => optionRows(tree)[row]!.props.onPress())
    const submit = tree.root.find(
      (node) =>
        (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Submit selected options'
    )
    await act(async () => {
      submit.props.onPress()
    })
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
    await answerWith(renderer, 0)
    // The test renderer does not drop taps on a disabled Pressable, so these
    // also prove the handlers refuse; the disabled flags are checked after.
    const again = optionRows(renderer)
    await answerWith(renderer, 1)
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
    await answerWith(renderer, 0)
    expect(captions(renderer)).toContainEqual({ text: 'Sending answer…', color: palette.textSecondary })
    await act(async () => settle(true))
    expect(captions(renderer)).toContainEqual({ text: 'Answer sent · waiting for agent', color: palette.textSecondary })
  })

  it('gives the rows back at once when the answer is refused', async () => {
    const onAnswer = vi.fn(async () => false)
    renderer = renderQuestion(pickOne, onAnswer)
    const rows = () => optionRows(renderer!)
    await answerWith(renderer, 0)
    expect(rows()[1]!.props.disabled).toBeFalsy()
    expect(captions(renderer).map((caption) => caption.text)).not.toContain('Answer sent · waiting for agent')
    await answerWith(renderer, 1)
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

// 2026-10-13, from the phone: "as soon as I select the answer it gets
// submitted, instead of [waiting for] me clicking the Submit button." On the
// structured lane an AskUserQuestion is drawn by this card, and a single-select
// row used to answer on the tap itself. Now a tap chooses and Submit sends; a
// grouped question's earlier steps say Next and only fold into the draft.
describe('the question card, choose first and Submit after', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    colorScheme = 'light'
  })

  const pickOne = {
    question: 'Push it and update the pull request?',
    options: ['Yes, push to PR 1100', 'No, keep it local'],
    optionDescriptions: ['Push the branch.', 'Leave the commits here.'],
    multiSelect: false,
    allowOther: true,
    optionTokens: ['yes-token', 'no-token']
  }

  const radios = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio')
  const submit = (tree: ReactTestRenderer) =>
    tree.root.find(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Submit selected options'
    )
  const borderOf = (node: { props: { style?: unknown } }): unknown => {
    const style =
      typeof node.props.style === 'function'
        ? (node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false })
        : node.props.style
    return (style as { borderColor?: unknown }).borderColor
  }

  it('does not send an answer when an option is tapped, only on Submit', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion(pickOne, onAnswer)

    expect(submit(renderer).props.disabled).toBe(true)
    await act(async () => radios(renderer!)[1]!.props.onPress())
    expect(onAnswer).not.toHaveBeenCalled()
    expect(radios(renderer)[1]!.props.accessibilityState).toMatchObject({ checked: true })

    await act(async () => submit(renderer!).props.onPress())
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('no-token')
  })

  it('lets the choice change before Submit', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion(pickOne, onAnswer)

    await act(async () => radios(renderer!)[0]!.props.onPress())
    await act(async () => radios(renderer!)[1]!.props.onPress())
    await act(async () => radios(renderer!)[1]!.props.onPress())
    expect(radios(renderer).map((row) => row.props.accessibilityState.checked)).toEqual([false, true])
    expect(onAnswer).not.toHaveBeenCalled()

    await act(async () => submit(renderer!).props.onPress())
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('no-token')
  })

  it('says Next on a grouped question’s earlier step, Submit on its last', () => {
    renderer = renderQuestion({ ...pickOne, nextStep: true }, vi.fn(async () => true))
    const labels = () =>
      renderer!.root
        .findAllByType('Text' as never)
        .map((node) => node.props.children as unknown)
        .filter((text) => text === 'Next' || text === 'Submit')
    expect(labels()).toEqual(['Next'])
    renderer.unmount()
    renderer = renderQuestion(pickOne, vi.fn(async () => true))
    expect(labels()).toEqual(['Submit'])
  })

  it('waits for Submit on a single question with a single option', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion({ ...pickOne, options: ['Blue'], optionTokens: ['blue-token'] }, onAnswer)

    await act(async () => radios(renderer!)[0]!.props.onPress())
    expect(onAnswer).not.toHaveBeenCalled()
    await act(async () => submit(renderer!).props.onPress())
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('blue-token')
  })

  // Review finding, 2026-10-13: a chosen row and typed words could stand
  // together, and each control silently dropped the other. One answer at a
  // time, as the Claude app keeps it: typing clears the row, a row clears the text.
  it('never holds a chosen row and typed words at once on a single-select card', async () => {
    const onAnswer = vi.fn(async () => true)
    renderer = renderQuestion(pickOne, onAnswer)
    const input = () => renderer!.root.findByType('TextInput' as never)

    await act(async () => radios(renderer!)[0]!.props.onPress())
    await act(async () => input().props.onChangeText('Push to a new branch'))
    expect(radios(renderer).map((row) => row.props.accessibilityState.checked)).toEqual([false, false])
    expect(submit(renderer).props.disabled).toBe(true)

    await act(async () => radios(renderer!)[1]!.props.onPress())
    expect(input().props.value).toBe('')
    await act(async () => submit(renderer!).props.onPress())
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('no-token')
  })

  it('names the page-turn button Next for a screen reader too', () => {
    renderer = renderQuestion({ ...pickOne, nextStep: true }, vi.fn(async () => true))
    const labels = renderer.root
      .findAll((node) => (node.type as unknown) === 'Pressable' && typeof node.props.accessibilityLabel === 'string')
      .map((node) => node.props.accessibilityLabel as string)
    expect(labels).toContain('Next question')
    expect(labels).not.toContain('Submit selected options')
  })

  it.each(['light', 'dark'] as const)('marks the chosen row in the accent, in %s', async (scheme) => {
    const palette = scheme === 'dark' ? darkColors : lightColors
    renderer = renderQuestion(pickOne, vi.fn(async () => true), scheme)

    await act(async () => radios(renderer!)[1]!.props.onPress())
    expect(borderOf(radios(renderer)[1]!)).toBe(palette.accent)
    expect(borderOf(radios(renderer)[0]!)).toBe(palette.border)
  })
})
