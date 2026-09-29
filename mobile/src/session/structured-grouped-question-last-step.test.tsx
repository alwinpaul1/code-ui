import { createElement, useLayoutEffect, useRef, useState } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionPromptResult } from '../../../src/shared/agent-session-wire'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  type StructuredAgentSessionState
} from '../../../src/shared/structured-agent-session-reducer'
import { ThemeProvider } from '../theme/theme-context'
import type {
  StructuredAgentSessionMutate,
  StructuredAgentSessionMutationResult
} from './mobile-structured-agent-session-rpc'

// Found while tracing "when a user question appears and I click one option
// and click submit the screen flashes" (2026-09-29), on the structured lane
// (an agent-session tab). A Claude AskUserQuestion with two questions is
// answered as two steps and sent as one group. Once the host accepted the
// group, the phone dropped the steps it had collected, while the journal still
// had the prompt pending: the card went back to "First? (1 of 2)", a fresh
// card with every row live, until the journal said the prompt was resolved.
// A tap in that window answers the first question again.

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  ScrollView: 'ScrollView',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('lucide-react-native', () => ({ ArrowUp: 'ArrowUp', Check: 'Check', CircleHelp: 'CircleHelp', X: 'X' }))
// The dock's other cards are not under test.
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'Ask' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'Permission' }))
vi.mock('./MobileNativeChatTerminalWait', () => ({ MobileNativeChatTerminalWait: 'TerminalWait' }))

import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import { projectStructuredQuestion, type StructuredQuestionItem } from './mobile-structured-agent-prompts'
import { useMobileStructuredPromptResponses } from './use-mobile-structured-prompt-responses'

/** The host's grouped shape (mobile-structured-agent-prompts-grouped.test.ts):
 *  a single-select question, then a multi-select one. */
function groupedPrompt(resolution: 'pending' | 'resolved'): AgentJournalRenderItem {
  return {
    itemId: 'item-1',
    revision: 1,
    sequence: 1,
    observedAt: 1,
    body: {
      kind: 'question',
      question: '2 grouped questions from Claude',
      options: [],
      questions: [
        {
          id: 'q1',
          question: 'Which database?',
          multiSelect: false,
          options: [
            { id: 'q1:choice-1', label: 'Postgres' },
            { id: 'q1:choice-2', label: 'SQLite' }
          ]
        },
        {
          id: 'q2',
          question: 'Which regions?',
          multiSelect: true,
          options: [
            { id: 'q2:choice-1', label: 'us-east' },
            { id: 'q2:choice-2', label: 'eu-west' }
          ]
        }
      ],
      resolution:
        resolution === 'pending'
          ? { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
          : { state: 'resolved', selectedOptionId: 'group', resolvedBy: 'mobile', resolvedAt: 2 }
    }
  } as unknown as AgentJournalRenderItem
}

let renderer: ReactTestRenderer | null = null
let frames: string[] = []
let setJournal: (state: StructuredAgentSessionState) => void = () => undefined
let replies: ((result: StructuredAgentSessionMutationResult<AgentSessionPromptResult>) => void)[] = []
const mutate = vi.fn(
  () => new Promise((resolve) => replies.push(resolve))
) as unknown as StructuredAgentSessionMutate

function journal(resolution: 'pending' | 'resolved'): StructuredAgentSessionState {
  return { ...EMPTY_STRUCTURED_AGENT_SESSION, status: 'ready', items: [groupedPrompt(resolution)] }
}

/** The session hook's half (the journal and the grouped draft) and the dock's
 *  card, as use-mobile-structured-agent-session.ts and the view wire them. */
function Chat(): React.JSX.Element {
  const [state, setState] = useState(() => journal('pending'))
  setJournal = setState
  const stateRef = useRef(state)
  stateRef.current = state
  const { groupedDraft, respondQuestion } = useMobileStructuredPromptResponses({
    stateRef,
    sessionKey: 'session-1',
    mutate,
    onSendError: vi.fn()
  })
  const pending = state.items.find((item) => item.body.kind === 'question' && item.body.resolution.state === 'pending')
  const question = projectStructuredQuestion((pending ?? null) as StructuredQuestionItem | null, groupedDraft)
  useLayoutEffect(() => {
    frames.push(question?.question ?? 'no card')
  })
  return createElement(MobileNativeChatPromptCard, { question, onAnswerQuestion: respondQuestion })
}

function texts(node: ReactTestInstance): string[] {
  return node.findAll((child) => (child.type as unknown) === 'Text').flatMap((child) =>
    (Array.isArray(child.props.children) ? child.props.children : [child.props.children]).filter(
      (part: unknown): part is string => typeof part === 'string'
    )
  )
}

function row(label: string): ReactTestInstance {
  const found = renderer!.root.findAll(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      (node.props.accessibilityRole === 'button' || node.props.accessibilityRole === 'checkbox') &&
      texts(node).includes(label)
  )[0]
  expect(found, `no row "${label}" on the card`).toBeDefined()
  return found!
}

function saysSent(): boolean {
  return texts(renderer!.root).includes('Answer sent · waiting for agent')
}

beforeEach(() => {
  frames = []
  replies = []
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference="light">
        <Chat />
      </ThemeProvider>
    )
  })
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('a grouped question on the structured lane, after its last step is sent', () => {
  it('stays on the last step as sent until the journal resolves it, never going back to the first', async () => {
    expect(frames.at(-1)).toBe('Which database? (1 of 2)')
    // Step 1 answers on the tap and stays on the phone.
    await act(async () => row('Postgres').props.onPress())
    expect(frames.at(-1)).toBe('Which regions? (2 of 2)')
    // Step 2: pick one, Submit. The group goes to the host.
    await act(async () => row('us-east').props.onPress())
    const submit = renderer!.root.findByProps({ accessibilityLabel: 'Submit selected options' })
    await act(async () => submit.props.onPress())
    expect(mutate).toHaveBeenCalledTimes(1)
    const sentAt = frames.length
    await act(async () => {
      replies[0]!({
        status: 'accepted',
        value: {
          itemId: 'item-1',
          revision: 1,
          resolution: { state: 'resolved', selectedOptionId: 'group', resolvedBy: 'mobile', resolvedAt: 2 }
        } as never,
        sameFence: true
      })
    })
    // The journal has not caught up yet: the card says what it sent.
    expect(frames.slice(sentAt), frames.join(' → ')).not.toContain('Which database? (1 of 2)')
    expect(frames.at(-1)).toBe('Which regions? (2 of 2)')
    expect(saysSent(), 'the last step does not say it was sent').toBe(true)
    // The journal resolves the prompt: the card goes.
    act(() => setJournal(journal('resolved')))
    expect(frames.at(-1)).toBe('no card')
  })

  // The failure path keeps its rule: an answer the phone cannot confirm
  // starts again from the first question, as a retry must.
  it('starts again from the first question when the host cannot confirm the group', async () => {
    await act(async () => row('Postgres').props.onPress())
    await act(async () => row('us-east').props.onPress())
    const submit = renderer!.root.findByProps({ accessibilityLabel: 'Submit selected options' })
    await act(async () => submit.props.onPress())
    await act(async () => {
      replies[0]!({ status: 'unknown' } as never)
    })
    expect(frames.at(-1)).toBe('Which database? (1 of 2)')
  })
})
