import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { createHookListenerState, type HookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import { normalizeAndAccept } from '../../../src/shared/agent-hook-listener-test-harness'
import {
  ASK_USER_QUESTION_CLEANUP,
  ASK_USER_QUESTION_STACK_AND_LOOK,
  CODEX_REQUEST_USER_INPUT
} from '../notifications/ask-user-question-fixtures'

// Reported from the phone twice. 2026-09-25: on a one-question card the user
// "had to tap Submit twice". 2026-09-28: "when a ask question user thing was
// open and I had to click the submit button multiple times".
//
// What the first tap looked like: Submit went to half opacity with the same
// word on it, and nothing else on the card moved until the host acknowledged
// the LAST keystroke group. One relay round trip for a lone pick (the relayed
// floor is ~250 ms, and seconds while the relay re-dials), and one extra second
// per group after the first (MOBILE_NATIVE_CHAT_QUESTION_STEP_MS) for a
// multi-question, multi-select or free-text answer: 2 to 4 seconds of a faded
// "Submit" that looked like a tap that did not register. Then the card was
// dismissed the moment the write was accepted, whether or not the agent ever
// took the answer; a lost answer left no card and no "waits in the terminal"
// notice either.
//
// These cases drive Claude Code's and Codex's hook rows through Orca's own
// normalizer, the phone's prompt pipeline and the dismissal the controller
// owns, into the real card. They pin: the tap shows at once ("Sending…"), an
// accepted answer puts a "Sent" status where Submit was until the hook row says
// the agent took it, a refusal gives the tap back at once, and nothing sends
// twice.

vi.mock('react-native', async () => {
  const React = await import('react')
  const passthrough =
    (name: string) =>
    ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement(name, props, children)
  return {
    Pressable: passthrough('Pressable'),
    ScrollView: passthrough('ScrollView'),
    Text: passthrough('Text'),
    TextInput: passthrough('TextInput'),
    View: passthrough('View'),
    useWindowDimensions: () => ({ width: 412, height: 915 })
  }
})
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))
vi.mock('../ui/Button', () => ({ Button: 'Button' }))
vi.mock('../ui/Txt', () => ({ Txt: 'Txt' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'Permission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'Question' }))

import { ASK_SENT_WAIT_MS } from './MobileNativeChatAsk'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import { useMobileNativeChatAskDismiss } from './use-mobile-native-chat-ask-dismiss'
import { useMobileNativeChatPrompts } from './use-mobile-native-chat-prompts'

/** The 2026-09-25 report's question: one question, single-select, two options. */
const PUSH = {
  questions: [
    {
      question: 'The branch is ready. Push it and update the pull request?',
      header: 'Push',
      multiSelect: false,
      options: [
        { label: 'Yes, push to PR 1100', description: 'Push the branch and update the open pull request.' },
        { label: 'No, keep it local', description: 'Leave the commits on this machine for now.' }
      ]
    }
  ]
}

type Row = Record<string, unknown>
type Question = { questions: unknown[] }

const LEAD_TURN: Row = { hook_event_name: 'UserPromptSubmit', prompt: 'ship it' }
type Agent = 'claude' | 'codex'
/** Each agent's own question tool: Claude Code's AskUserQuestion, Codex's
 *  request_user_input (0.145+, auto-allowed, so it posts PreToolUse and waits). */
const TOOL: Record<Agent, string> = { claude: 'AskUserQuestion', codex: 'request_user_input' }
const asks = (input: Question, agent: Agent = 'claude'): Row => ({
  hook_event_name: 'PreToolUse',
  tool_name: TOOL[agent],
  tool_input: input,
  tool_use_id: 'toolu_ask'
})
/** What the agent posts once it has taken the answer (state → working, prompt
 *  gone). Both agents' rows go through Orca's normalizer to that same shape. */
const took = (input: Question, answer: string, agent: Agent = 'claude'): Row => ({
  hook_event_name: 'PostToolUse',
  tool_name: TOOL[agent],
  tool_input: input,
  tool_use_id: 'toolu_ask',
  tool_response: answer
})
const askCall = (input: Question, agent: Agent = 'claude'): NativeChatMessage => ({
  id: 'assistant-ask',
  role: 'assistant',
  timestamp: 1,
  source: 'transcript',
  blocks: [{ type: 'tool-call', name: TOOL[agent], input }]
})
const TOOL_RESULT: NativeChatMessage = {
  id: 'tool-result',
  role: 'tool',
  timestamp: 2,
  source: 'transcript',
  blocks: [{ type: 'tool-result', output: 'answered' }]
}

let renderer: ReactTestRenderer | null = null
let hookState: HookListenerState
let status: AgentStatusEntry | null = null
let rowAt = 0
let answers: AskAnswerSelection[][] = []
let replies: ((accepted: boolean) => void)[] = []
let cancels = 0
let cardMounted = true
/** False: the controller's dismissal records nothing (it is a no-op when the
 *  detected prompt moved under the send), so only the card's own hold is left. */
let recordAnswers = true
/** The approval card the controller hands the dock (from the screen or a hook row). */
let permission: unknown = null

beforeEach(() => {
  hookState = createHookListenerState()
  status = null
  rowAt = 0
  answers = []
  replies = []
  cancels = 0
  cardMounted = true
  recordAnswers = true
  permission = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The controller's half (prompts + dismissal) and the dock's card. The card's
 *  subtree can unmount (a chat↔terminal toggle) while the controller stays. */
function Chat({ messages }: { messages: NativeChatMessage[] }): React.JSX.Element | null {
  const prompts = useMobileNativeChatPrompts({ enabled: true, status, messages, transcriptLoading: false })
  const { askKey, showAsk, dismissAsk, askSentAt } = useMobileNativeChatAskDismiss({
    ask: prompts.ask,
    detectedAsk: prompts.detectedAsk,
    liveAsk: prompts.liveAsk,
    scopeKey: 'tab-1',
    sessionKey: 'session-1',
    observing: true
  })
  if (!cardMounted) {
    return null
  }
  return (
    <MobileNativeChatPromptCard
      ask={showAsk ? prompts.ask : null}
      askKey={askKey}
      askSentAt={askSentAt}
      onDismissAsk={recordAnswers ? dismissAsk : () => undefined}
      onAnswerAsk={(_prompt: AskPrompt, selections: AskAnswerSelection[]) => {
        answers.push(selections)
        return new Promise<boolean>((resolve) => replies.push(resolve))
      }}
      onCancelAsk={async () => {
        cancels += 1
        return true
      }}
      permission={permission as never}
    />
  )
}

function hook(row: Row, messages: NativeChatMessage[], agent: Agent = 'claude'): void {
  rowAt += 1
  const event = normalizeAndAccept(hookState, agent, { session_id: 'session-1', turn_id: 'turn-1', ...row })
  if (event) {
    status = { ...event.payload, updatedAt: rowAt, stateStartedAt: rowAt } as AgentStatusEntry
  }
  render(messages)
}

function render(messages: NativeChatMessage[]): void {
  act(() => {
    if (renderer) {
      renderer.update(<Chat messages={messages} />)
    } else {
      renderer = create(<Chat messages={messages} />)
    }
  })
}

function isHost(node: ReactTestInstance, tag: string): boolean {
  return (node.type as unknown) === tag
}

/** The card's primary button, whatever it says (Next, Submit, Sending…). */
function primary(): ReactTestInstance | null {
  return renderer!.root.findAll((node) => isHost(node, 'Button') && node.props.variant === 'accent')[0] ?? null
}

/** The Sent status that takes the button's place once the host accepts. */
function sentPill(): ReactTestInstance | null {
  return renderer!.root.findAll((node) => isHost(node, 'View') && node.props.testID === 'ask-sent')[0] ?? null
}

/** Any of the ask card on screen: its button or its Sent status. */
function askCard(): ReactTestInstance | null {
  return primary() ?? sentPill()
}

function expectSent(message = 'no Sent status on the card'): void {
  expect(sentPill(), message).not.toBeNull()
  expect(primary(), 'a live Submit beside Sent').toBeNull()
}

/** Every handler on the card, pressed. The test renderer does not drop taps on
 *  a disabled Pressable, so this also proves each handler refuses on its own. */
async function pressEverything(): Promise<void> {
  const handlers = (): ReactTestInstance[] =>
    renderer!.root.findAll(
      (node) => (isHost(node, 'Pressable') || isHost(node, 'Button')) && typeof node.props.onPress === 'function'
    )
  // Re-read before each press: a tab press swaps the rows under the list.
  for (let index = 0; index < handlers().length; index += 1) {
    const node = handlers()[index]!
    await act(async () => {
      node.props.onPress()
    })
  }
}

function cancelButton(): ReactTestInstance | null {
  return renderer!.root.findAll((node) => isHost(node, 'Button') && node.props.label === 'Cancel')[0] ?? null
}

function texts(): string[] {
  return renderer!.root
    .findAll((node) => isHost(node, 'Txt'))
    .map((node) => [node.props.children].flat().join(''))
}

function optionRow(label: string): ReactTestInstance {
  const row = renderer!.root.findAll(
    (node) =>
      isHost(node, 'Pressable') &&
      (node.props.accessibilityRole === 'radio' || node.props.accessibilityRole === 'checkbox') &&
      node.findAll((child) => isHost(child, 'Txt') && child.props.children === label).length > 0
  )[0]
  expect(row, `no option row "${label}" on the card`).toBeDefined()
  return row!
}

function pick(label: string): void {
  const row = optionRow(label)
  act(() => row.props.onPress())
}

/** A tap that reaches the button's handler. The real Pressable drops taps on a
 *  disabled button; this does not, so it also proves the handler refuses. */
async function tap(button: ReactTestInstance | null): Promise<void> {
  expect(button, 'the card is gone').not.toBeNull()
  await act(async () => {
    button!.props.onPress()
  })
}

async function reply(accepted: boolean): Promise<void> {
  const next = replies.shift()
  expect(next, 'no answer is in flight').toBeDefined()
  await act(async () => {
    next!(accepted)
  })
}

function open(input: Question, agent: Agent = 'claude'): NativeChatMessage[] {
  const messages = [askCall(input, agent)]
  hook(LEAD_TURN, messages, agent)
  hook(asks(input, agent), messages, agent)
  expect(primary(), 'the question never reached the card').not.toBeNull()
  return messages
}

describe('the ask card after Submit is tapped', () => {
  it('shows the first tap at once: Submit reads Sending… while the answer is in flight', async () => {
    open(PUSH)
    pick('Yes, push to PR 1100')
    await tap(primary())

    expect(answers).toEqual([[{ indices: [0] }]])
    expect(primary()!.props.label, 'the first tap left Submit looking untouched').toBe('Sending…')
    expect(primary()!.props.loading).toBe(true)
    expect(cancelButton()!.props.disabled).toBe(true)
  })

  it('keeps Submit disabled after an answer is sent until Claude takes it', async () => {
    const messages = open(PUSH)
    pick('Yes, push to PR 1100')
    await tap(primary())
    await reply(true)

    // Accepted by the host, not yet taken: the hook row still shows the question.
    expectSent('the card left before Claude took the answer')
    expect(cancelButton(), 'Cancel would send Escape into a turn that may have started').toBeNull()
    // The pick that was sent can no longer be changed on the card.
    expect(optionRow('No, keep it local').props.disabled).toBe(true)

    hook(took(PUSH, 'Yes, push to PR 1100'), messages)
    expect(askCard(), 'the card outlived the hook row that took the answer').toBeNull()
    render([...messages, TOOL_RESULT])
    expect(askCard()).toBeNull()
  })

  it('does not send the answer twice when Submit is tapped again before the card goes', async () => {
    open(PUSH)
    pick('Yes, push to PR 1100')
    await tap(primary())
    // Tapped again while the first is in flight.
    await tap(primary())
    await reply(true)
    // And everything on the card, after the host accepted it, card still up.
    await pressEverything()
    pick('No, keep it local')
    await pressEverything()

    expect(answers).toEqual([[{ indices: [0] }]])
    expect(replies).toHaveLength(0)
  })

  it('holds Sent on its own when the controller kept no record of the answer', async () => {
    // The controller's dismissal is a no-op when the detected prompt moved
    // under the send; the card must not hand Submit back for that.
    recordAnswers = false
    open(PUSH)
    pick('Yes, push to PR 1100')
    await tap(primary())
    await reply(true)
    expectSent('Submit came back live after an accepted answer')
    await pressEverything()
    expect(answers).toEqual([[{ indices: [0] }]])
  })

  it('says it is waiting for Claude when the answer has not been taken 3 s after it was sent', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const messages = open(PUSH)
    pick('Yes, push to PR 1100')
    await tap(primary())
    await reply(true)

    const waiting = 'Sent — waiting for the agent to take it'
    act(() => {
      vi.advanceTimersByTime(ASK_SENT_WAIT_MS - 1)
    })
    expect(texts()).not.toContain(waiting)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(texts()).toContain(waiting)
    // It says so, and offers no second send: a numbered menu still on screen
    // could as well be the next prompt, and a digit typed into it answers that.
    expectSent()
    const logged = (): string[] =>
      warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('[ask] answer accepted'))
    expect(logged()).toHaveLength(1)
    // One line per answer, not one per mount: a toggle past the wait says it again on screen only.
    cardMounted = false
    render(messages)
    cardMounted = true
    render(messages)
    expect(texts()).toContain(waiting)
    expect(logged()).toHaveLength(1)

    hook(took(PUSH, 'Yes, push to PR 1100'), messages)
    expect(askCard()).toBeNull()
  })

  it('gives the tap back at once when the answer is refused', async () => {
    open(PUSH)
    pick('Yes, push to PR 1100')
    await tap(primary())
    await reply(false)

    expect(primary()!.props.label).toBe('Submit')
    expect(primary()!.props.disabled).toBe(false)
    expect(primary()!.props.loading).not.toBe(true)
    expect(cancelButton()!.props.disabled).toBe(false)
    // The pick survived, so the retry is one tap.
    await tap(primary())
    expect(answers).toEqual([[{ indices: [0] }], [{ indices: [0] }]])
  })

  it('stays Sent across a chat↔terminal toggle before Claude takes it', async () => {
    const messages = open(PUSH)
    pick('Yes, push to PR 1100')
    await tap(primary())
    await reply(true)

    cardMounted = false
    render(messages)
    expect(askCard()).toBeNull()
    cardMounted = true
    render(messages)

    expectSent('the answered card came back with Submit live')
  })

  it('leaves at once when no hook row carries the question to watch', async () => {
    // A stale row projects to done with no prompt, and the transcript's copy is
    // the only source. The phone has nothing to wait on, so the accepted answer
    // is the last word, as before.
    const messages = [askCall(PUSH)]
    hook(LEAD_TURN, messages)
    expect(primary()).not.toBeNull()
    pick('Yes, push to PR 1100')
    await tap(primary())
    await reply(true)

    expect(askCard()).toBeNull()
  })

  it('an accepted Cancel still takes the card away at once', async () => {
    open(PUSH)
    await tap(cancelButton())
    expect(cancels).toBe(1)
    expect(askCard()).toBeNull()
  })
})

describe('an approval raised while an answered question waits', () => {
  // A Codex child's rows reuse the lead's snapshot, so the hook row stays
  // `waiting` on the lead's question while the child's approval is on screen.
  // Found by review, 2026-09-28: the Sent card kept the dock, and the approval
  // it used to give way to (the old dismissal hid the card) never drew.
  const APPROVAL = { tool: 'Bash', command: 'pnpm test', options: [] }

  function approvalCard(): ReactTestInstance | null {
    return renderer!.root.findAll((node) => isHost(node, 'Permission'))[0] ?? null
  }

  it('shows the approval, not the Sent card', async () => {
    const messages = open(CODEX_REQUEST_USER_INPUT, 'codex')
    pick('Blue')
    await tap(primary())
    await reply(true)
    expectSent()

    permission = APPROVAL
    render(messages)
    expect(approvalCard(), 'an approval sat hidden behind a card that can do nothing').not.toBeNull()
    expect(askCard()).toBeNull()

    // The approval answered, the question still on the row: the Sent card is back.
    permission = null
    render(messages)
    expectSent()
  })

  it('still puts an unanswered question first', () => {
    const messages = open(CODEX_REQUEST_USER_INPUT, 'codex')
    permission = APPROVAL
    render(messages)
    expect(primary()!.props.label).toBe('Submit')
    expect(approvalCard()).toBeNull()
  })
})

describe('the sent state on the other card shapes', () => {
  it('a one-option question, from Codex', async () => {
    // Codex's real request_user_input input offers one option; Claude's schema
    // asks for two to four, so this is the degenerate size as well.
    const messages = open(CODEX_REQUEST_USER_INPUT, 'codex')
    pick('Blue')
    await tap(primary())
    expect(primary()!.props.label).toBe('Sending…')
    await reply(true)
    expectSent()
    hook(took(CODEX_REQUEST_USER_INPUT, 'Blue', 'codex'), messages, 'codex')
    expect(askCard(), 'the card outlived the Codex row that took the answer').toBeNull()
    expect(answers).toEqual([[{ indices: [0] }]])
  })

  it('a two-question card: Next, then Submit on the last question', async () => {
    const messages = open(ASK_USER_QUESTION_STACK_AND_LOOK)
    pick('Fork Orca mobile (Expo/RN) (Recommended)')
    expect(primary()!.props.label).toBe('Next')
    await tap(primary())
    expect(answers, 'Next sent something').toEqual([])
    expect(primary()!.props.label).toBe('Submit')
    pick('Claude app: warm cream/ink, serif headings (Recommended)')
    await tap(primary())
    expect(primary()!.props.label).toBe('Sending…')
    // The tabs cannot take the card back to a question whose answer is going out.
    const tabs = renderer!.root.findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'tab')
    expect(tabs.every((tab) => tab.props.disabled === true)).toBe(true)
    await reply(true)
    expectSent()
    await pressEverything()
    hook(took(ASK_USER_QUESTION_STACK_AND_LOOK, 'answered'), messages)
    expect(askCard()).toBeNull()
    expect(answers).toEqual([[{ indices: [0] }, { indices: [0] }]])
  })

  it('a multi-select question with an Other answer', async () => {
    open(ASK_USER_QUESTION_CLEANUP)
    pick('Tier 1 caches (~45 GB) (Recommended)')
    pick('Hugging Face models (22 GB)')
    pick('Other…')
    const input = renderer!.root.findAll((node) => isHost(node, 'TextInput'))[0]!
    act(() => input.props.onChangeText('the old simulator images'))
    await tap(primary())
    expect(primary()!.props.label).toBe('Sending…')
    const locked = renderer!.root.findAll((node) => isHost(node, 'TextInput'))[0]!
    expect(locked.props.editable, 'the Other text could be edited after it went out').toBe(false)
    await reply(true)
    expectSent()
    await pressEverything()
    expect(answers).toEqual([[{ indices: [0, 2], other: 'the old simulator images' }]])
  })
})
