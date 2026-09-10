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
  useColorScheme: () => colorScheme
}))

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  CircleHelp: 'CircleHelp'
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
