import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'

// Reported 2026-10-16 with two screenshots, the Claude app's question card beside
// ours: "I need the same ui for ask question". The app (1.261013.20, numbers and
// sources in ask-card-claude-app-spec.ts) draws a hairline edge round the card,
// "0 selected" on the left of the footer, an outlined Skip pill, and a ROUND send
// button with an arrow that stays grey until the page has an answer. Ours drew a
// text Cancel and a filled Submit pill, and no edge.

vi.mock('react-native', async () => {
  const React = await import('react')
  const passthrough =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement(name, props, children)
  return {
    ActivityIndicator: passthrough('ActivityIndicator'),
    Pressable: passthrough('Pressable'),
    ScrollView: passthrough('ScrollView'),
    StyleSheet: { hairlineWidth: 0.5 },
    TextInput: passthrough('TextInput'),
    View: passthrough('View'),
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 412, height: 915 })
  }
})
vi.mock('lucide-react-native', () => ({
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight'
}))
vi.mock('../ui/Button', () => ({ Button: 'Button' }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../notifications/notification-plain-text', () => ({
  notificationPlainText: (text: string) => text
}))

import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatAsk } from './MobileNativeChatAsk'

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

type Scheme = 'light' | 'dark'

function render(
  prompt: AskPrompt,
  scheme: Scheme = 'light',
  onAnswer = vi.fn(async () => true),
  onCancel = vi.fn(async () => true)
) {
  act(() => {
    tree = create(
      createElement(
        ThemeProvider as never,
        { initialPreference: scheme },
        createElement(MobileNativeChatAsk, { prompt, onAnswer, onCancel })
      )
    )
  })
  return { onAnswer, onCancel }
}

const root = (): ReactTestInstance => tree!.root
const host = (node: ReactTestInstance, tag: string): boolean => (node.type as unknown) === tag

function flatten(style: unknown): Record<string, unknown> {
  const resolved =
    typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style
  if (Array.isArray(resolved)) {
    return Object.assign({}, ...resolved.map(flatten))
  }
  return (resolved ?? {}) as Record<string, unknown>
}

const text = (node: ReactTestInstance): string => [node.props.children].flat().join('')
const txts = (value: string): ReactTestInstance[] => root().findAll((n) => host(n, 'Txt') && text(n) === value)
const rows = (): ReactTestInstance[] =>
  root().findAll(
    (n) =>
      host(n, 'Pressable') &&
      (n.props.accessibilityRole === 'radio' || n.props.accessibilityRole === 'checkbox')
  )
const send = (): ReactTestInstance => root().find((n) => host(n, 'Pressable') && n.props.testID === 'ask-send')
const skip = (): ReactTestInstance => root().find((n) => host(n, 'Button') && n.props.label === 'Skip')
const pagerNext = (): ReactTestInstance =>
  root().find((n) => host(n, 'Pressable') && n.props.accessibilityLabel === 'Next question')

const SINGLE: AskPrompt = {
  questions: [
    {
      question: 'Which library should we use?',
      multiSelect: false,
      options: [
        { label: 'date-fns', description: 'Small' },
        { label: 'luxon', description: 'Zones' }
      ]
    }
  ]
} as AskPrompt

const MULTI: AskPrompt = {
  questions: [
    {
      question: 'Which features do you want to enable?',
      multiSelect: true,
      options: [
        { label: 'Dark mode', description: 'Enable dark theme support' },
        { label: 'Notifications', description: 'Push and in-app notifications' },
        { label: 'Offline mode', description: 'Cache data for offline access' }
      ]
    }
  ]
} as AskPrompt

const TWO: AskPrompt = {
  questions: [
    {
      question: 'Where should the Hours view go?',
      multiSelect: false,
      options: [
        { label: 'Tab in Fleet', description: 'A new tab' },
        { label: 'New sidebar page', description: 'Its own item' }
      ]
    },
    {
      question: 'Push after the change?',
      multiSelect: false,
      options: [
        { label: 'Yes, push', description: 'Push now' },
        { label: 'No, keep it local', description: 'Stay local' }
      ]
    }
  ]
} as AskPrompt

describe('the ask card footer, as the Claude app draws it', () => {
  it('says "0 selected", then counts the picks, on a multi-select card', () => {
    render(MULTI)
    expect(txts('0 selected')).toHaveLength(1)
    act(() => rows()[0]!.props.onPress())
    expect(txts('1 selected')).toHaveLength(1)
  })

  it('offers Skip as an outlined pill, not a text Cancel', () => {
    render(MULTI)
    expect(root().findAll((n) => host(n, 'Button') && n.props.label === 'Cancel')).toHaveLength(0)
    expect(skip().props.size).toBe('sm')
    const style = flatten(skip().props.style)
    expect(style.backgroundColor).toBe('transparent')
    expect(Number(style.borderWidth)).toBeGreaterThan(0)
  })

  it('sends with a round 36 dp arrow button that stays off until a choice is made', () => {
    render(MULTI)
    expect(root().findAll((n) => host(n, 'Button') && n.props.label === 'Submit')).toHaveLength(0)
    const style = flatten(send().props.style)
    expect([style.width, style.height, style.borderRadius]).toEqual([36, 36, 18])
    expect(send().props.accessibilityLabel).toBe('Submit')
    expect(send().props.disabled).toBe(true)
    expect(send().findAll((n) => host(n, 'ArrowUp'))).toHaveLength(1)
    act(() => rows()[1]!.props.onPress())
    expect(send().props.disabled).toBe(false)
  })

  it('turns the page with a round arrow-right Next button before the last page', () => {
    render(TWO)
    expect(send().props.accessibilityLabel).toBe('Next')
    expect(send().findAll((n) => host(n, 'ArrowRight'))).toHaveLength(1)
    act(() => rows()[0]!.props.onPress())
    act(() => send().props.onPress())
    expect(txts('Push after the change?')).toHaveLength(1)
    expect(send().props.accessibilityLabel).toBe('Submit')
  })

  it('sets the question in semibold', () => {
    render(SINGLE)
    expect(txts('Which library should we use?')[0]!.props.weight).toBe('semibold')
  })
})

describe('Skip, as the Claude app skips a page', () => {
  it('lets go of the page’s answer and turns to the next page', () => {
    const { onAnswer } = render(TWO)
    act(() => rows()[1]!.props.onPress())
    act(() => skip().props.onPress())
    expect(txts('Push after the change?')).toHaveLength(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('sends a skipped page unanswered beside the answered ones on Submit', async () => {
    const { onAnswer } = render(TWO)
    act(() => skip().props.onPress())
    act(() => rows()[1]!.props.onPress())
    await act(async () => send().props.onPress())
    expect(onAnswer).toHaveBeenCalledWith([{ indices: [] }, { indices: [1] }])
  })

  it('submits from the last page, that page unanswered', async () => {
    const { onAnswer } = render(TWO)
    act(() => rows()[0]!.props.onPress())
    act(() => pagerNext().props.onPress())
    act(() => rows()[0]!.props.onPress())
    await act(async () => skip().props.onPress())
    expect(onAnswer).toHaveBeenCalledWith([{ indices: [0] }, { indices: [] }])
  })

  it('declines the question when nothing at all was answered', async () => {
    const { onAnswer, onCancel } = render(SINGLE)
    await act(async () => skip().props.onPress())
    expect(onAnswer).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does nothing once the answer is sent', async () => {
    const { onAnswer, onCancel } = render(SINGLE)
    act(() => rows()[0]!.props.onPress())
    await act(async () => send().props.onPress())
    expect(root().findAll((n) => host(n, 'Button') && n.props.label === 'Skip')).toHaveLength(0)
    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('the card’s room', () => {
  it('leaves room for four described options and "Something else" on a 915 dp phone', () => {
    render(SINGLE)
    const card = root().find((n) => host(n, 'View') && flatten(n.props.style).borderRadius === 24)
    // Header 39 + four 2-line rows (62) and the Other row (48) with rules + list
    // padding 12, the rule above the footer and the 48 dp footer: about 450.
    expect(Number(flatten(card.props.style).maxHeight)).toBeGreaterThanOrEqual(500)
  })
})

describe.each(['light', 'dark'] as const)('the footer’s colours in %s', (scheme) => {
  const colors = scheme === 'light' ? lightColors : darkColors

  it('edges the card with the hairline rule colour', () => {
    render(SINGLE, scheme)
    const card = root().find((n) => host(n, 'View') && flatten(n.props.style).borderRadius === 24)
    const style = flatten(card.props.style)
    expect(style.borderWidth).toBe(0.5)
    expect(style.borderColor).toBe(colors.askDivider)
    expect(style.backgroundColor).toBe(colors.askCardFill)
  })

  it('fills Next with the ink and Submit with the clay once there is an answer, grey before', () => {
    render(TWO, scheme)
    expect(flatten(send().props.style).backgroundColor).toBe(colors.askBadgeStrong)
    act(() => rows()[0]!.props.onPress())
    expect(flatten(send().props.style).backgroundColor).toBe(colors.askNextFill)
    expect(send().find((n) => host(n, 'ArrowRight')).props.color).toBe(colors.askNextLabel)
    act(() => send().props.onPress())
    act(() => rows()[0]!.props.onPress())
    expect(flatten(send().props.style).backgroundColor).toBe(colors.askSubmitFill)
    expect(send().find((n) => host(n, 'ArrowUp')).props.color).toBe(colors.askSubmitLabel)
  })

  it('draws Skip’s label in the card ink and its edge in the theme border', () => {
    render(SINGLE, scheme)
    expect(skip().props.labelColor).toBe(colors.askText)
    expect(flatten(skip().props.style).borderColor).toBe(colors.border)
  })
})
