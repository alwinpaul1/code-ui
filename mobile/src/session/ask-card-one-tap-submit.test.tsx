import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { AskAnswerSelection, AskPrompt } from '../../../src/shared/native-chat-ask'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { createHookListenerState, type HookListenerState } from '../../../src/shared/agent-hook-listener/listener-state'
import { normalizeAndAccept } from '../../../src/shared/agent-hook-listener-test-harness'

// Reported from the phone on 2026-09-25: on Claude Code's AskUserQuestion card
// (one question, single-select, "Yes, push to PR 1100" / "No, keep it local")
// the user picked an option and had to tap Submit twice.
//
// The card keeps its pick in local state, keyed by the question, so one way to
// lose the first tap is a card that remounts (or blinks out) between the pick
// and Submit. These cases drive the hook rows Claude Code sends while its
// question waits through Orca's own normalizer (src/shared, vendored), then
// through the phone's prompt pipeline into the real card, and check that the
// pick survives every row and one tap sends it.
//
// They passed on the code the report came from, so they rule that cause out
// for this shape of question; they did not find the lost tap. They go red if
// the card remounts on a row: keying it per render fails every case that has
// a row between the pick and Submit. Not driven here: a background agent's
// PermissionRequest while the lead's question waits. The row then carries the
// child's approval, the card falls back to the transcript's copy of the
// question, and what a digit answers on the desktop is unverified.

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
// The other two cards are not under test; the ask card wins over both anyway.
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'Permission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'Question' }))

import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import { useMobileNativeChatAskDismiss } from './use-mobile-native-chat-ask-dismiss'
import { useMobileNativeChatPrompts } from './use-mobile-native-chat-prompts'

/** The reported question's shape: one question, single-select, two options. */
const QUESTION = {
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

const ASK_CALL: NativeChatMessage = {
  id: 'assistant-ask',
  role: 'assistant',
  timestamp: 1,
  source: 'transcript',
  blocks: [{ type: 'tool-call', name: 'AskUserQuestion', input: QUESTION }]
}

type Row = Record<string, unknown>

const LEAD_TURN: Row = { hook_event_name: 'UserPromptSubmit', prompt: 'ship it' }
const LEAD_ASKS: Row = {
  hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion',
  tool_input: QUESTION,
  tool_use_id: 'toolu_ask'
}
/** Newer Claude Code builds report the same question as a PermissionRequest too. */
const LEAD_ASKS_PERMISSION: Row = {
  hook_event_name: 'PermissionRequest',
  tool_name: 'AskUserQuestion',
  tool_input: QUESTION,
  tool_use_id: 'toolu_ask'
}
const NOTIFICATION: Row = {
  hook_event_name: 'Notification',
  message: 'Claude needs your permission to use AskUserQuestion'
}
const CHILD_START: Row = { hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'general-purpose' }
const CHILD_TOOL: Row = {
  hook_event_name: 'PreToolUse',
  agent_id: 'agent-1',
  tool_name: 'Bash',
  tool_input: { command: 'pnpm test' },
  tool_use_id: 'toolu_child'
}
const CHILD_TOOL_DONE: Row = {
  hook_event_name: 'PostToolUse',
  agent_id: 'agent-1',
  tool_name: 'Bash',
  tool_input: { command: 'pnpm test' },
  tool_use_id: 'toolu_child',
  tool_response: 'ok'
}
const CHILD_STOP: Row = { hook_event_name: 'SubagentStop', agent_id: 'agent-1' }
const SIBLING_STARTS: Row = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'sleep 5' },
  tool_use_id: 'toolu_sibling'
}
const SIBLING_ENDS: Row = {
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'sleep 5' },
  tool_use_id: 'toolu_sibling',
  tool_response: 'done'
}

let renderer: ReactTestRenderer | null = null
let hookState: HookListenerState
let status: AgentStatusEntry | null = null
let rowAt = 0
let answers: AskAnswerSelection[][] = []

beforeEach(() => {
  hookState = createHookListenerState()
  status = null
  rowAt = 0
  answers = []
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

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
  return (
    <MobileNativeChatPromptCard
      ask={showAsk ? prompts.ask : null}
      askKey={askKey}
      askSentAt={askSentAt}
      onDismissAsk={dismissAsk}
      onAnswerAsk={async (_prompt: AskPrompt, selections: AskAnswerSelection[]) => {
        answers.push(selections)
        return true
      }}
      onCancelAsk={async () => true}
    />
  )
}

/** One hook post to Orca: the phone sees the row it produces, or keeps the last one. */
function hook(row: Row, messages: NativeChatMessage[]): void {
  rowAt += 1
  const event = normalizeAndAccept(hookState, 'claude', { session_id: 'session-1', ...row })
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

/** A host tag the mocks above render: the test renderer types `type` as a component. */
function isHost(node: ReactTestInstance, tag: string): boolean {
  return (node.type as unknown) === tag
}

function card(): ReactTestInstance | null {
  return renderer!.root.findAll((node) => isHost(node, 'Button') && node.props.label === 'Submit')[0] ?? null
}

function pick(label: string): void {
  const row = renderer!.root.findAll(
    (node) =>
      isHost(node, 'Pressable') &&
      node.props.accessibilityRole === 'radio' &&
      node.findAll((child) => isHost(child, 'Txt') && child.props.children === label).length > 0
  )[0]
  expect(row, `no option row "${label}" on the card`).toBeDefined()
  act(() => row!.props.onPress())
}

async function tapSubmitOnce(): Promise<void> {
  const submit = card()
  expect(submit, 'the card is gone before Submit').not.toBeNull()
  expect(submit!.props.disabled, 'Submit is dead: the pick did not survive').toBe(false)
  await act(async () => {
    submit!.props.onPress()
  })
}

const SEQUENCES: { name: string; before: Row[]; between: Row[] }[] = [
  { name: 'the lead asks alone', before: [LEAD_TURN, LEAD_ASKS], between: [] },
  {
    name: 'the question is also reported as a PermissionRequest, then a Notification',
    before: [LEAD_TURN, LEAD_ASKS],
    between: [LEAD_ASKS_PERMISSION, NOTIFICATION]
  },
  {
    name: 'a background agent keeps working while the question waits',
    before: [LEAD_TURN, CHILD_START, LEAD_ASKS],
    between: [CHILD_TOOL, CHILD_TOOL_DONE, CHILD_STOP]
  },
  {
    name: 'a parallel tool call finishes while the question waits',
    before: [LEAD_TURN, SIBLING_STARTS, LEAD_ASKS],
    between: [SIBLING_ENDS]
  }
]

describe.each(SEQUENCES)('the ask card when $name', ({ before, between }) => {
  it('keeps the picked answer, and one Submit tap sends it', async () => {
    const messages = [ASK_CALL]
    for (const row of before) {
      hook(row, messages)
    }
    expect(card(), 'the question never reached the card').not.toBeNull()
    pick('Yes, push to PR 1100')
    for (const row of between) {
      hook(row, messages)
    }
    await tapSubmitOnce()
    expect(answers).toEqual([[{ indices: [0] }]])
  })
})

/** Any of the ask card: its button (Submit, Sending…) or its Sent status. */
function askCard(): ReactTestInstance | null {
  return (
    renderer!.root.findAll(
      (node) =>
        (isHost(node, 'Button') && node.props.variant === 'accent') ||
        (isHost(node, 'View') && node.props.testID === 'ask-sent')
    )[0] ?? null
  )
}

describe('the ask card after its answer lands', () => {
  it('goes away and does not come back when Claude reports the answer', async () => {
    const messages = [ASK_CALL]
    hook(LEAD_TURN, messages)
    hook(LEAD_ASKS, messages)
    pick('Yes, push to PR 1100')
    await tapSubmitOnce()
    // Accepted, not yet taken: it stays up as sent, with no live Submit on it
    // (ask-card-submit-feedback.test.tsx drives that state).
    expect(card(), 'a live Submit after an accepted answer').toBeNull()
    expect(askCard()?.props.testID).toBe('ask-sent')
    hook({ ...LEAD_ASKS, hook_event_name: 'PostToolUse', tool_response: 'Yes, push to PR 1100' }, messages)
    expect(askCard(), 'the card outlived the row that took the answer').toBeNull()
    const answered: NativeChatMessage[] = [
      ASK_CALL,
      { id: 'tool-result', role: 'tool', timestamp: 2, source: 'transcript', blocks: [{ type: 'tool-result', output: 'Yes' }] }
    ]
    render(answered)
    expect(askCard()).toBeNull()
  })
})
