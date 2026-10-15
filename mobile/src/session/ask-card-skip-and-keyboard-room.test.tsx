import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'

// Review of f00febd4a (2026-10-16), the Claude-app ask card:
// - Skip on the last page did nothing when a page in between had been passed
//   over with the pager's chevron: submit() refused because that page was
//   neither answered nor skipped, and said nothing. The Claude app sends such a
//   page as unanswered ("[No preference]", t52.java:83,97).
// - The card's cap is a share of the window, and the window does not shrink for
//   the keyboard. With "Something else" focused the keyboard took the bottom and
//   a tall card pushed its own question off the top.

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
    // A Galaxy S23's window, as the chat view tests use it.
    useWindowDimensions: () => ({ width: 384, height: 823 })
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
import { askCardMaxHeight } from './ask-card-claude-app-spec'

let tree: ReactTestRenderer | null = null
afterEach(() => {
  act(() => tree?.unmount())
  tree = null
})

function render(prompt: AskPrompt, opts: { keyboardInset?: number; scheme?: 'light' | 'dark' } = {}) {
  const onAnswer = vi.fn(async () => true)
  const onCancel = vi.fn(async () => true)
  act(() => {
    tree = create(
      createElement(
        ThemeProvider as never,
        { initialPreference: opts.scheme ?? 'light' },
        createElement(MobileNativeChatAsk, {
          prompt,
          onAnswer,
          onCancel,
          keyboardInset: opts.keyboardInset ?? 0
        })
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
const cardMaxHeight = (): number =>
  Number(
    flatten(root().find((n) => host(n, 'View') && flatten(n.props.style).borderRadius === 24).props.style)
      .maxHeight
  )

const page = (question: string): AskPrompt['questions'][number] => ({
  question,
  multiSelect: false,
  options: [
    { label: `${question} A`, description: 'First' },
    { label: `${question} B`, description: 'Second' }
  ]
})
const THREE: AskPrompt = { questions: [page('One?'), page('Two?'), page('Three?')] } as AskPrompt
const ONE: AskPrompt = { questions: [page('Only?')] } as AskPrompt

describe('Skip on the last page with a page passed over by the chevron', () => {
  it('sends the passed-over page as skipped instead of doing nothing', async () => {
    const { onAnswer, onCancel } = render(THREE)
    act(() => rows()[0]!.props.onPress())
    act(() => pagerNext().props.onPress())
    act(() => pagerNext().props.onPress())
    expect(txts('Three?')).toHaveLength(1)
    await act(async () => skip().props.onPress())
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [0] }, { indices: [] }, { indices: [] }])
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('sends every untouched page as skipped beside a last-page answer let go by Skip', async () => {
    const { onAnswer } = render(THREE)
    act(() => pagerNext().props.onPress())
    act(() => rows()[1]!.props.onPress())
    act(() => pagerNext().props.onPress())
    act(() => rows()[0]!.props.onPress())
    await act(async () => skip().props.onPress())
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [] }, { indices: [1] }, { indices: [] }])
  })

  it('still declines when no page anywhere has an answer', async () => {
    const { onAnswer, onCancel } = render(THREE)
    act(() => pagerNext().props.onPress())
    act(() => pagerNext().props.onPress())
    await act(async () => skip().props.onPress())
    expect(onAnswer).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it.each(['light', 'dark'] as const)(
    'says which page holds Submit back when an earlier one has no answer (%s)',
    (scheme) => {
      render(THREE, { scheme })
      act(() => rows()[0]!.props.onPress())
      act(() => pagerNext().props.onPress())
      act(() => pagerNext().props.onPress())
      act(() => rows()[0]!.props.onPress())
      expect(send().props.disabled).toBe(true)
      const hint = txts('Question 2 has no answer yet')
      expect(hint).toHaveLength(1)
      const colors = scheme === 'light' ? lightColors : darkColors
      expect(flatten(hint[0]!.props.style).color).toBe(colors.askMuted)
    }
  )

  it('draws no hint once every page is answered', () => {
    render(THREE)
    for (let i = 0; i < 3; i += 1) {
      act(() => rows()[0]!.props.onPress())
      if (i < 2) {
        act(() => send().props.onPress())
      }
    }
    expect(send().props.disabled).toBe(false)
    expect(root().findAll((n) => host(n, 'Txt') && /has no answer/.test(text(n)))).toHaveLength(0)
  })
})

describe('the card’s room with the keyboard up', () => {
  it('keeps the question on screen when the keyboard takes the bottom of the window', () => {
    // 823 dp window, a 330 dp keyboard: 493 dp above it, which the app's header
    // and the dock's other rows share with the card.
    render(ONE, { keyboardInset: 330 })
    expect(cardMaxHeight()).toBeLessThanOrEqual(Math.round((823 - 330) * 0.6))
  })

  it('keeps the old room with the keyboard down', () => {
    render(ONE)
    expect(cardMaxHeight()).toBe(askCardMaxHeight(823, 0))
    expect(askCardMaxHeight(915, 0)).toBeGreaterThanOrEqual(500)
  })

  it('never grows past what the keyboard leaves, down to nothing', () => {
    expect(askCardMaxHeight(823, 330)).toBeLessThan(823 - 330)
    expect(askCardMaxHeight(600, 300)).toBeLessThan(300)
    expect(askCardMaxHeight(400, 400)).toBeGreaterThan(0)
    expect(askCardMaxHeight(400, 500)).toBeGreaterThan(0)
  })
})
