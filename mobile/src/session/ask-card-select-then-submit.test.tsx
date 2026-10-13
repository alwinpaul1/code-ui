import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskPrompt } from '../../../src/shared/native-chat-ask'
import type { AgentType } from '../../../src/shared/native-chat-types'
import {
  ASK_USER_QUESTION_CLEANUP,
  ASK_USER_QUESTION_CONTEXT_RING,
  ASK_USER_QUESTION_STACK_AND_LOOK,
  CODEX_REQUEST_USER_INPUT
} from '../notifications/ask-user-question-fixtures'

// Reported from the phone on 2026-10-13: "When an ask question comes and I try
// to select an answer, as soon as I select the answer it gets submitted,
// instead of [waiting for] me clicking the Submit button."
//
// The card had taken Orca #26288's auto-advance: a single-select pick moved to
// the next question 200 ms later, and on the last (or only) question that move
// WAS the submit, so the pick reached the agent with no Submit tap. The Claude
// app 1.261009.20 never does that: an option tap only rewrites the page's
// answer (`CdsQuestionAnswer(picked, typed)`), and Next/Submit is a separate
// button enabled once the page is answered.
//
// These cases pin the user's order: a tap selects, the choice can change, Next
// only turns the page, and only Submit sends, every page at once. The last
// block wires the card to the real answer-send hook, so "nothing sent" means no
// keystroke reached the agent's terminal either, for Claude Code and Codex.

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
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))
vi.mock('../ui/Button', () => ({ Button: 'Button' }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('../notifications/notification-plain-text', () => ({
  notificationPlainText: (text: string) => text
}))

import type { RpcClient } from '../transport/rpc-client'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { resetMobileNativeChatStaleInputForTests } from './mobile-native-chat-stale-input'
import { resetMobileNativeChatTerminalWritesForTests } from './mobile-native-chat-terminal-write-lock'
import { MobileNativeChatAsk } from './MobileNativeChatAsk'
import { useMobileNativeChatAnswerSend } from './use-mobile-native-chat-answer-send'

/** Longer than any beat a card could wait before moving on by itself. */
const LONG_AFTER_A_TAP_MS = 10_000

let tree: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => tree?.unmount())
  tree = null
  vi.useRealTimers()
})

function render(prompt: unknown, onAnswer = vi.fn(async () => true), scheme?: 'light' | 'dark'): typeof onAnswer {
  const card = createElement(MobileNativeChatAsk, {
    prompt: prompt as AskPrompt,
    onAnswer,
    onCancel: async () => true
  })
  act(() => {
    tree = create(scheme ? <ThemeProvider initialPreference={scheme}>{card}</ThemeProvider> : card)
  })
  return onAnswer
}

const root = (): ReactTestInstance => tree!.root

function row(label: string): ReactTestInstance {
  return root().find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      (node.props.accessibilityRole === 'radio' || node.props.accessibilityRole === 'checkbox') &&
      node.findAll((n) => (n.type as unknown) === 'Txt' && n.props.children === label).length > 0
  )
}

const checked = (label: string): boolean => row(label).props.accessibilityState.checked === true

function tap(label: string): void {
  act(() => row(label).props.onPress())
}

function button(label: string): ReactTestInstance {
  return root().find((node) => (node.type as unknown) === 'Button' && node.props.label === label)
}

async function press(label: string): Promise<void> {
  await act(async () => button(label).props.onPress())
}

function type(text: string): void {
  act(() => root().findByType('TextInput' as never).props.onChangeText(text))
}

async function waitLong(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LONG_AFTER_A_TAP_MS)
  })
}

const shows = (text: string): boolean =>
  root().findAll((node) => (node.type as unknown) === 'Txt' && node.props.children === text).length > 0

function borderOf(node: ReactTestInstance): unknown {
  const style = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style
  return (style as { borderColor?: unknown }).borderColor
}

describe('an ask card, choose first and Submit after', () => {
  it('does not send an answer when an option is tapped, only on Submit', async () => {
    const onAnswer = render(ASK_USER_QUESTION_CONTEXT_RING)

    tap('Skip it for Codex')
    await waitLong()

    expect(onAnswer).not.toHaveBeenCalled()
    expect(checked('Skip it for Codex')).toBe(true)
    expect(button('Submit').props.disabled).toBe(false)

    await press('Submit')
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [1] }])
  })

  it('lets the choice change before Submit', async () => {
    const onAnswer = render(ASK_USER_QUESTION_CONTEXT_RING)

    tap('Tap to refresh')
    await waitLong()
    tap('Skip it for Codex')
    expect(checked('Tap to refresh')).toBe(false)
    expect(checked('Skip it for Codex')).toBe(true)
    // A radio: tapping the chosen row again keeps it chosen, as in the Claude
    // app, instead of quietly emptying the answer.
    tap('Skip it for Codex')
    expect(checked('Skip it for Codex')).toBe(true)
    await waitLong()
    expect(onAnswer).not.toHaveBeenCalled()

    await press('Submit')
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [1] }])
  })

  it('sends every page’s answers on the final Submit', async () => {
    const onAnswer = render(ASK_USER_QUESTION_STACK_AND_LOOK)

    tap('Native Kotlin/Compose')
    await waitLong()
    // The tap did not turn the page; Next does, and sends nothing.
    expect(shows("How should the new Android app be built on top of Orca's relay?")).toBe(true)
    await press('Next')
    expect(onAnswer).not.toHaveBeenCalled()
    expect(shows('Which visual direction for the UI layer?')).toBe(true)

    tap('Codex app: neutral white/black, sans-serif')
    await waitLong()
    expect(onAnswer).not.toHaveBeenCalled()

    await press('Submit')
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [2] }, { indices: [1] }])
  })

  it('keeps Submit off until every question has an answer, even from the last page', async () => {
    const onAnswer = render(ASK_USER_QUESTION_STACK_AND_LOOK)
    const tabs = root().findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'tab'
    )
    act(() => tabs[1]!.props.onPress())
    tap("Keep Orca's graphite dark palette")

    expect(button('Submit').props.disabled).toBe(true)
    await press('Submit')
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('toggles a multi-select question and sends the set only on Submit', async () => {
    const onAnswer = render(ASK_USER_QUESTION_CLEANUP)

    tap('Tier 1 caches (~45 GB) (Recommended)')
    tap('Hugging Face models (22 GB)')
    tap('Unreal Engine 5.2 (48 GB)')
    tap('Unreal Engine 5.2 (48 GB)')
    await waitLong()
    expect(onAnswer).not.toHaveBeenCalled()

    await press('Submit')
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [0, 2] }])
  })

  it('sends a "Something else" answer only on Submit, not while it is typed', async () => {
    const onAnswer = render(ASK_USER_QUESTION_CONTEXT_RING)

    tap('Something else')
    type('A chip that refreshes on a timer')
    await waitLong()
    expect(onAnswer).not.toHaveBeenCalled()

    await press('Submit')
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([
      { indices: [], other: 'A chip that refreshes on a timer' }
    ])
  })

  it('sends nothing for an empty or blank "Something else"', async () => {
    const onAnswer = render(ASK_USER_QUESTION_CONTEXT_RING)

    tap('Something else')
    expect(button('Submit').props.disabled).toBe(true)
    await press('Submit')
    type('   ')
    expect(button('Submit').props.disabled).toBe(true)
    await press('Submit')
    await waitLong()

    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('waits for Submit on a single question with a single option (Codex 0.145)', async () => {
    const onAnswer = render(CODEX_REQUEST_USER_INPUT)

    tap('Blue')
    await waitLong()
    expect(onAnswer).not.toHaveBeenCalled()

    await press('Submit')
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [0] }])
  })

  it('sends nothing when the question is cancelled after a pick', async () => {
    const onAnswer = render(ASK_USER_QUESTION_CONTEXT_RING)

    tap('Tap to refresh')
    await press('Cancel')
    await waitLong()

    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('holds its choice while the answer is being delivered and sends it once', async () => {
    const onAnswer = render(
      ASK_USER_QUESTION_CONTEXT_RING,
      vi.fn(() => new Promise<boolean>(() => {}))
    )

    tap('Tap to refresh')
    await press('Submit')
    tap('Skip it for Codex')
    // The same button, now spinning: a second press must not send again.
    await press('Sending\u2026')

    expect(row('Skip it for Codex').props.disabled).toBe(true)
    expect(checked('Tap to refresh')).toBe(true)
    expect(checked('Skip it for Codex')).toBe(false)
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith([{ indices: [0] }])
  })

  it.each(['light', 'dark'] as const)('shows the chosen row in the accent and the rest unmarked, in %s', (scheme) => {
    const palette = scheme === 'dark' ? darkColors : lightColors
    render(ASK_USER_QUESTION_CONTEXT_RING, vi.fn(async () => true), scheme)

    tap('Tap to refresh')
    tap('Skip it for Codex')

    expect(borderOf(row('Skip it for Codex'))).toBe(palette.accent)
    expect(borderOf(row('Tap to refresh'))).toBe(palette.border)
  })
})

// The terminal half: the card's Submit is the only thing that drives the
// agent's own keys. The keys and their order are the ones the selector takes,
// pinned against real screens in claude-ask-answer-keys-screens.test.ts; here
// only WHEN they are written is under test.
describe('an ask card wired to the agent’s terminal', () => {
  let sendRequest: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetMobileNativeChatStaleInputForTests()
    resetMobileNativeChatTerminalWritesForTests()
    sendRequest = vi.fn(async () => ({
      id: 'send',
      ok: true as const,
      result: { send: { accepted: true } },
      _meta: { runtimeId: 'runtime' }
    }))
  })

  function Wired({ prompt, agent }: { prompt: AskPrompt; agent: AgentType }): React.JSX.Element {
    const answerSend = useMobileNativeChatAnswerSend({
      client: { sendRequest } as unknown as RpcClient,
      enabled: true,
      handleRef: { current: 'terminal' },
      deviceTokenRef: { current: 'device' },
      agentRef: { current: agent },
      sessionId: 'session',
      streamIdentity: 'host\0worktree\0tab\0session',
      onSendError: () => undefined
    })
    return createElement(MobileNativeChatAsk, {
      prompt,
      onAnswer: (selections) => answerSend.answerAsk(prompt, selections)
    })
  }

  function mount(prompt: unknown, agent: AgentType): void {
    act(() => {
      tree = create(createElement(Wired, { prompt: prompt as AskPrompt, agent }))
    })
  }

  const written = (): unknown[] => sendRequest.mock.calls.map((call) => (call[1] as { text: string }).text)

  it.each([
    ['claude', ['2', '3', '\r']],
    ['codex', ['2', '3']]
  ] as const)(
    'does not send an answer when an option is tapped, only on Submit, on %s',
    async (agent, keys) => {
      mount(ASK_USER_QUESTION_STACK_AND_LOOK, agent)

      tap('Web app + Capacitor with real beUI')
      await waitLong()
      await press('Next')
      tap("Keep Orca's graphite dark palette")
      await waitLong()
      expect(sendRequest, 'a tap reached the terminal').not.toHaveBeenCalled()

      await press('Submit')
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(written()).toEqual(keys)
    }
  )
})
