import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'

// The ask card in the Claude app's look. Claude app 1.261009.20, decompiled
// (defpackage/ = out/sources/defpackage/). Every number below is read from that
// source; "inferred" marks the few that the decompile does not spell out.
//
// What the app feeds its card from a Claude Code AskUserQuestion (a62.java:105-125):
//   question text = j62.a, options = hc5(label, description, preview = null),
//   multiSelect picks the checkbox kind. j62.b, the `header` chip, is NOT passed
//   on: the app draws no chip, and no tabs. So this card shows none either.
//   Previews are always null for Claude Code, so there is no preview pane.
//
// Card (dc5.java:668): fill ad5.n0() = #FFFFFF / #20201F, shape bn7.j = 24 dp
//   (zlw.java:16), no border, no shadow (aa20.n(.., z3 = false, default border 0)).
// Header (dc5.java:1724-1750, f()): padding 16 / 12 / 16 (8 with a pager) / 6;
//   question text jn7.E 15/400/21 (jn7.java:46) in ad5.u0() #0B0B0B / #F0EFEC.
// Pager (dc5.java:1842-1895, g()): prev chevron, "n of N" (jn7.E, ad5.y() #898781),
//   next chevron, each a 36 dp target around a 20 dp glyph (bf4.java); labels
//   "Previous question" / "Next question" / "Question n of N"
//   (strings question_card_*). Only with more than one question.
// Rows (dc5.java:1919-2296, h()): list padding 6, row radius bn7.f = 12, row
//   min height 48 (dc5.c), row padding 10/6/10/6 (dc5.a); title jn7.E in
//   ad5.x0() #52514E / #C3C2B7, pressed ad5.u0(); description jn7.H 13 in
//   ad5.y() (inferred: lut.d passes the description its own style, mut(E,E,H)
//   at lut.java:1765). Rows are numbered 1-9 in a 28 dp badge (lut.java:15258
//   f(), bn7.d = 8 dp), fill ad5.P() 5% ink, ad5.X() 10% when pressed
//   (lut.java:15258-15300); a tenth row and beyond has no number (nb5.java:39).
//   Multi-select rows carry a checkbox in that 28 dp slot (lut.java:15157 e()).
// Rules between rows: 1 line, ad5.A() 10% ink, 12 dp inset (dc5.java:2305 j(), padding dc5.d = 12).
// Other row (dc5.java:1562-1720 e(), 1957 placeholder): the placeholder is "Something else"
//   (question_card_other_hint); typing a single-select answer lets go of the
//   picked option and the options fade to 0.4 over 150 ms (dc5.java:2030, 150 ms tween); a
//   picked option lets go of the typed text (a62.java:186-193).
// Footer (dc5.java:1424-1465 c(), 1468 d()): a rule above, row padding
//   20/6/16/6, min height 48, 8 dp gaps; "n selected" (jn7.H, ad5.y()) on the
//   left for multi-select only (question_card_selected_count, dc5.java:1525);
//   Skip, then Next (ink pill kf4: ad5.k0() #0B0B0B / #FFFFFF) or, on the last
//   page, Submit (clay pill gf4: ad5.w0() #C6613F), 36 dp tall.
//   Skip is not built: it clears the page's answer and moves on
//   ("[No preference]", m62.java:23-24), and Claude Code's picker cannot be
//   driven to "no answer" with keys. Cancel keeps that slot.
// Once answered the app swaps the card for a plain answered card (x920.java:
//   caption "Question(s)" jn7.E ad5.x0(); each question jn7.B ad5.x0(), answer
//   jn7.B ad5.u0(), "Skipped" for none). That card is the transcript's, not
//   the dock's, and is not built here.

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
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 412, height: 915 })
  }
})
vi.mock('lucide-react-native', () => ({
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

function render(prompt: AskPrompt, scheme: Scheme = 'light', onAnswer = vi.fn(async () => true)) {
  act(() => {
    tree = create(
      createElement(
        ThemeProvider as never,
        { initialPreference: scheme },
        createElement(MobileNativeChatAsk, { prompt, onAnswer, onCancel: async () => true })
      )
    )
  })
  return onAnswer
}

const root = (): ReactTestInstance => tree!.root

function flatten(style: unknown): Record<string, unknown> {
  const resolved = typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style
  if (Array.isArray(resolved)) {
    return Object.assign({}, ...resolved.map(flatten))
  }
  return (resolved ?? {}) as Record<string, unknown>
}

const text = (node: ReactTestInstance): string => [node.props.children].flat().join('')
const txts = (value: string): ReactTestInstance[] =>
  root().findAll((n) => (n.type as unknown) === 'Txt' && text(n) === value)
const rows = (): ReactTestInstance[] =>
  root().findAll(
    (n) =>
      (n.type as unknown) === 'Pressable' &&
      (n.props.accessibilityRole === 'radio' || n.props.accessibilityRole === 'checkbox')
  )
const byLabel = (label: string): ReactTestInstance =>
  root().find((n) => (n.type as unknown) === 'Pressable' && n.props.accessibilityLabel === label)
const button = (label: string): ReactTestInstance =>
  root().find((n) => (n.type as unknown) === 'Button' && n.props.label === label)

const single = (n = 3): AskPrompt =>
  ({
    questions: [
      {
        question: 'Which library should we use for date formatting?',
        header: 'Library',
        multiSelect: false,
        options: ['date-fns', 'moment.js', 'day.js', 'luxon', 'dayjs', 'temporal', 'native', 'intl', 'custom', 'none']
          .slice(0, n)
          .map((label) => ({ label, description: `${label} description` }))
      }
    ]
  }) as AskPrompt

const TWO: AskPrompt = {
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

const MULTI: AskPrompt = {
  questions: [
    {
      question: 'Which features do you want to enable?',
      header: 'Features',
      multiSelect: true,
      options: [
        { label: 'Dark mode', description: 'Enable dark theme support' },
        { label: 'Notifications', description: 'Push and in-app notifications' },
        { label: 'Offline mode', description: 'Cache data for offline access' }
      ]
    }
  ]
} as AskPrompt

describe('the ask card has no header chip and no step tabs, as the Claude app draws none', () => {
  it('shows the question text and not its header word', () => {
    render(TWO)
    expect(txts('Where should the Hours view go?')).toHaveLength(1)
    expect(txts('Placement')).toHaveLength(0)
    expect(txts('Push')).toHaveLength(0)
    expect(root().findAll((n) => n.props.accessibilityRole === 'tab')).toHaveLength(0)
  })
})

describe('the pager on a card with more than one question', () => {
  it('pages with the chevrons and counts "1 of 2", then "2 of 2"', () => {
    render(TWO)
    expect(txts('1 of 2')).toHaveLength(1)
    expect(txts('Where should the Hours view go?')).toHaveLength(1)
    act(() => byLabel('Next question').props.onPress())
    expect(txts('2 of 2')).toHaveLength(1)
    expect(txts('Push after the change?')).toHaveLength(1)
    act(() => byLabel('Previous question').props.onPress())
    expect(txts('1 of 2')).toHaveLength(1)
  })

  it('names the page for a screen reader and disables the chevron at each end', () => {
    render(TWO)
    expect(txts('1 of 2')[0]!.props.accessibilityLabel).toBe('Question 1 of 2')
    expect(byLabel('Previous question').props.disabled).toBe(true)
    expect(byLabel('Next question').props.disabled).toBe(false)
    act(() => byLabel('Next question').props.onPress())
    expect(byLabel('Next question').props.disabled).toBe(true)
    expect(byLabel('Previous question').props.disabled).toBe(false)
  })

  it('keeps the answer of the page it left', () => {
    render(TWO)
    act(() => rows()[1]!.props.onPress())
    act(() => byLabel('Next question').props.onPress())
    act(() => byLabel('Previous question').props.onPress())
    expect(rows()[1]!.props.accessibilityState.checked).toBe(true)
  })

  it('draws no pager for a single question', () => {
    render(single())
    expect(txts('1 of 1')).toHaveLength(0)
    expect(root().findAll((n) => n.props.accessibilityLabel === 'Next question')).toHaveLength(0)
    expect(root().findAll((n) => n.props.accessibilityLabel === 'Previous question')).toHaveLength(0)
  })
})

describe('the options', () => {
  it('numbers a single-select question’s rows 1, 2, 3', () => {
    render(single(3))
    const digits = ['1', '2', '3'].map((d) => txts(d).length)
    expect(digits).toEqual([1, 1, 1])
  })

  it('numbers only the first nine of ten rows', () => {
    render(single(10))
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(txts(d)).toHaveLength(1)
    }
    expect(txts('10')).toHaveLength(0)
    expect(rows()).toHaveLength(11)
  })

  it('draws a checkbox, not a number, on a multi-select question', () => {
    render(MULTI)
    expect(txts('1')).toHaveLength(0)
    expect(rows().slice(0, 3).every((r) => r.props.accessibilityRole === 'checkbox')).toBe(true)
  })

  it('keeps a long label and a long description whole instead of cutting it at three lines', () => {
    const description = 'a very long description that wraps over many lines '.repeat(12)
    render({
      questions: [{ question: 'Q?', multiSelect: false, options: [{ label: 'L'.repeat(200), description }] }]
    } as AskPrompt)
    const desc = txts(description)[0]!
    expect(desc.props.numberOfLines).toBeUndefined()
    expect(txts('L'.repeat(200))[0]!.props.numberOfLines).toBeUndefined()
  })

  it('works with one option', () => {
    render({ questions: [{ question: 'Only?', multiSelect: false, options: [{ label: 'Yes' }] }] } as AskPrompt)
    expect(rows()).toHaveLength(2)
    expect(txts('1')).toHaveLength(1)
  })
})

describe('"Something else"', () => {
  const input = (): ReactTestInstance => root().findByType('TextInput' as never)

  it('is a field in the last row from the start, with the Claude app’s placeholder', () => {
    render(single())
    expect(input().props.placeholder).toBe('Something else')
    expect(rows().at(-1)!.props.accessibilityState.checked).toBe(false)
  })

  it('picks the row by typing in it, and lets go of the picked option on a single-select card', () => {
    render(single())
    act(() => rows()[0]!.props.onPress())
    expect(rows()[0]!.props.accessibilityState.checked).toBe(true)
    act(() => input().props.onChangeText('Something custom'))
    expect(rows().at(-1)!.props.accessibilityState.checked).toBe(true)
    expect(rows()[0]!.props.accessibilityState.checked).toBe(false)
  })

  it('empties the typed words when an option is picked on a single-select card', () => {
    render(single())
    act(() => input().props.onChangeText('Something custom'))
    act(() => rows()[1]!.props.onPress())
    expect(input().props.value).toBe('')
    expect(rows().at(-1)!.props.accessibilityState.checked).toBe(false)
    expect(rows()[1]!.props.accessibilityState.checked).toBe(true)
  })

  it('keeps the picks beside the typed words on a multi-select card', () => {
    render(MULTI)
    act(() => rows()[0]!.props.onPress())
    act(() => input().props.onChangeText('and more'))
    expect(rows()[0]!.props.accessibilityState.checked).toBe(true)
    expect(rows().at(-1)!.props.accessibilityState.checked).toBe(true)
  })

  it('treats whitespace only as no answer', () => {
    render(single())
    act(() => input().props.onChangeText('   '))
    expect(rows().at(-1)!.props.accessibilityState.checked).toBe(false)
  })
})

describe('the footer', () => {
  it('counts a multi-select card’s answers, with the typed one, and says nothing on a single-select card', () => {
    render(MULTI)
    expect(txts('0 selected')).toHaveLength(1)
    act(() => rows()[0]!.props.onPress())
    act(() => rows()[2]!.props.onPress())
    expect(txts('2 selected')).toHaveLength(1)
    act(() => root().findByType('TextInput' as never).props.onChangeText('and a widget'))
    expect(txts('3 selected')).toHaveLength(1)
    act(() => tree!.unmount())
    render(single())
    expect(root().findAll((n) => (n.type as unknown) === 'Txt' && text(n).endsWith(' selected'))).toHaveLength(0)
  })

  it('says Next on an earlier page and Submit on the last, as one pill', () => {
    render(TWO)
    expect(button('Next')).toBeTruthy()
    act(() => byLabel('Next question').props.onPress())
    expect(button('Submit')).toBeTruthy()
  })
})

describe.each(['light', 'dark'] as const)('the card’s colours in %s', (scheme) => {
  const colors = scheme === 'light' ? lightColors : darkColors

  it('fills the card at 24 dp with no border, and sets the question in the primary ink', () => {
    render(single(), scheme)
    const card = root().find((n) => (n.type as unknown) === 'View' && flatten(n.props.style).borderRadius === 24)
    const style = flatten(card.props.style)
    expect(style.backgroundColor).toBe(colors.askCardFill)
    expect(style.borderWidth ?? 0).toBe(0)
    const question = txts('Which library should we use for date formatting?')[0]!
    expect(flatten(question.props.style).color).toBe(colors.askText)
  })

  it('sets a row’s title in the label ink and its description in the muted ink', () => {
    render(single(), scheme)
    expect(flatten(txts('date-fns')[0]!.props.style).color).toBe(colors.askLabel)
    expect(flatten(txts('date-fns description')[0]!.props.style).color).toBe(colors.askMuted)
  })

  it('draws the rule between rows and above the footer in the 10 % hairline', () => {
    render(single(), scheme)
    const rules = root().findAll(
      (n) => (n.type as unknown) === 'View' && flatten(n.props.style).backgroundColor === colors.askDivider
    )
    // Between 3 options and the Other row: 3 rules; above the footer: 1.
    expect(rules.length).toBeGreaterThanOrEqual(4)
  })

  it('fills Next with ink and Submit with the clay', () => {
    render(TWO, scheme)
    expect(flatten(button('Next').props.style).backgroundColor).toBe(colors.askNextFill)
    act(() => byLabel('Next question').props.onPress())
    expect(flatten(button('Submit').props.style).backgroundColor).toBe(colors.askSubmitFill)
  })

  it('drops the options to 0.38 once the answer is sent, the chosen one staying whole', async () => {
    const onAnswer = render(single(), scheme)
    act(() => rows()[1]!.props.onPress())
    await act(async () => button('Submit').props.onPress())
    expect(onAnswer).toHaveBeenCalledTimes(1)
    const opacities = rows().map((r) => Number(flatten(r.props.style).opacity ?? 1))
    expect(opacities).toEqual([0.38, 1, 0.38, 0.38])
  })
})

describe('the colour tokens are the Claude app’s, in both schemes', () => {
  it('pins each value to the decompiled ad5 token', () => {
    expect([lightColors.askCardFill, darkColors.askCardFill]).toEqual(['#FFFFFF', '#20201F']) // ad5.n0()
    expect([lightColors.askText, darkColors.askText]).toEqual(['#0B0B0B', '#F0EFEC']) // ad5.u0()
    expect([lightColors.askLabel, darkColors.askLabel]).toEqual(['#52514E', '#C3C2B7']) // ad5.x0()
    expect([lightColors.askMuted, darkColors.askMuted]).toEqual(['#898781', '#898781']) // ad5.y()
    expect([lightColors.askDivider, darkColors.askDivider]).toEqual([
      'rgba(11, 11, 11, 0.1)',
      'rgba(255, 255, 255, 0.1)'
    ]) // ad5.A()
    expect([lightColors.askBadge, darkColors.askBadge]).toEqual([
      'rgba(11, 11, 11, 0.05)',
      'rgba(255, 255, 255, 0.05)'
    ]) // ad5.P()
    expect([lightColors.askBadgeStrong, darkColors.askBadgeStrong]).toEqual([
      'rgba(11, 11, 11, 0.1)',
      'rgba(255, 255, 255, 0.1)'
    ]) // ad5.X()
    expect([lightColors.askNextFill, darkColors.askNextFill]).toEqual(['#0B0B0B', '#FFFFFF']) // ad5.k0()
    expect([lightColors.askSubmitFill, darkColors.askSubmitFill]).toEqual(['#C6613F', '#C6613F']) // ad5.w0()
  })
})
