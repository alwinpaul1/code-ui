import { createElement } from 'react'
import TestRenderer from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileNativeChatPrompts } from './use-mobile-native-chat-prompts'

const APPROVAL = JSON.stringify({
  approval: { tool: 'Bash', summary: 'pnpm build > build.log 2>&1' }
})

const ASK = JSON.stringify({
  questions: [{ question: 'Which path?', options: ['fast', 'safe'] }]
})

function promptsFor(
  status: Partial<AgentStatusEntry> | null,
  messages: NativeChatMessage[] = [],
  transcriptLoading = false
): ReturnType<typeof useMobileNativeChatPrompts> {
  let captured: ReturnType<typeof useMobileNativeChatPrompts> | undefined
  function Probe(): null {
    captured = useMobileNativeChatPrompts({
      enabled: true,
      status: status as AgentStatusEntry | null,
      messages,
      transcriptLoading
    })
    return null
  }
  TestRenderer.act(() => {
    TestRenderer.create(createElement(Probe))
  })
  return captured!
}

function permissionFor(status: Partial<AgentStatusEntry> | null): unknown {
  return promptsFor(status).permission
}

describe('useMobileNativeChatPrompts approval-envelope state gate', () => {
  it('uses a complete host command payload and ignores truncated JSON previews', () => {
    const command = 'pdftoppm -r 110 -f 2 -l 2 -png main.pdf /private/tmp/fig1'
    const status = { state: 'waiting' as const, toolName: 'Bash', interactivePrompt: APPROVAL }
    expect(permissionFor({ ...status, toolInput: JSON.stringify({ command }) })).toMatchObject({
      command
    })
    expect(permissionFor({ ...status, toolInput: '{"command":"pdftoppm' })).not.toHaveProperty(
      'command'
    )
  })
  it('renders no approval card while the agent is working', () => {
    expect(permissionFor({ state: 'working', interactivePrompt: APPROVAL })).toBeNull()
  })

  it('renders no approval card after the turn is done', () => {
    expect(permissionFor({ state: 'done', interactivePrompt: APPROVAL })).toBeNull()
  })

  it('renders no approval card without a status', () => {
    expect(permissionFor(null)).toBeNull()
  })

  it('renders the approval card while the agent is waiting', () => {
    expect(permissionFor({ state: 'waiting', interactivePrompt: APPROVAL })).toMatchObject({
      title: 'Allow Bash?',
      detail: 'pnpm build > build.log 2>&1'
    })
  })

  it('renders the approval card while the agent is blocked', () => {
    expect(permissionFor({ state: 'blocked', interactivePrompt: APPROVAL })).toMatchObject({
      title: 'Allow Bash?'
    })
  })

  it('prefers the heuristic numbered menu over the envelope while paused', () => {
    const permission = permissionFor({
      state: 'waiting',
      interactivePrompt: APPROVAL,
      lastAssistantMessage: 'Allow this Bash command?\n1. Yes\n2. No'
    }) as { options: Array<{ label: string }> } | null
    expect(permission).toMatchObject({ title: 'Permission requested' })
    expect(permission?.options.map((o) => o.label)).toEqual(['Yes', 'No'])
  })
})

describe('useMobileNativeChatPrompts ask state gate', () => {
  const askMessages: NativeChatMessage[] = [
    {
      id: 'm1',
      role: 'assistant',
      blocks: [
        {
          type: 'tool-call',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Which path?', options: ['fast', 'safe'] }] }
        }
      ],
      timestamp: 0,
      source: 'transcript'
    }
  ]

  it('renders the ask card only while the agent is waiting or blocked', () => {
    expect(promptsFor({ state: 'waiting', interactivePrompt: ASK }).ask).toMatchObject({
      questions: [{ question: 'Which path?' }]
    })
    expect(promptsFor({ state: 'blocked', interactivePrompt: ASK }).ask).not.toBeNull()
  })

  it('renders no ask card from a sticky prompt while the agent is working or done', () => {
    // The prompt payload outlives its answer — same paused gate as permission.
    const working = promptsFor({ state: 'working', interactivePrompt: ASK })
    expect(working.ask).toBeNull()
    expect(working.detectedAsk).not.toBeNull()

    const done = promptsFor({ state: 'done', interactivePrompt: ASK })
    expect(done.ask).toBeNull()
    expect(done.detectedAsk).not.toBeNull()
  })

  it('keeps the transcript-derived pending ask outside the paused gate', () => {
    // A hook row idle past AGENT_STATUS_STALE_AFTER_MS projects to `done` with no
    // interactivePrompt, so gating this too would make a still-pending question
    // unanswerable from mobile. `extractPendingAsk` clears on the tool result.
    expect(promptsFor({ state: 'waiting' }, askMessages).ask).not.toBeNull()
    expect(promptsFor({ state: 'done' }, askMessages).ask).not.toBeNull()
    expect(promptsFor({ state: 'working' }, askMessages).ask).not.toBeNull()
    expect(promptsFor(null, askMessages).ask).not.toBeNull()
  })

  it('withholds retained transcript asks while the replacement read is unsettled', () => {
    const prompts = promptsFor({ state: 'done' }, askMessages, true)
    expect(prompts.ask).toBeNull()
    expect(prompts.detectedAsk).toBeNull()
  })

  it('keeps a paused live status ask authoritative while the read is unsettled', () => {
    const prompts = promptsFor({ state: 'waiting', interactivePrompt: ASK }, askMessages, true)
    expect(prompts.ask).toMatchObject({ questions: [{ question: 'Which path?' }] })
    expect(prompts.detectedAsk).not.toBeNull()
  })

  it('does not leak a paused-out sticky status prompt through the transcript fallback', () => {
    // The post-answer window: the status still carries the prompt while flipping
    // to `working`, and the transcript's tool-result row has not landed yet, so
    // both sources still describe the answered question. The paused gate only
    // holds because a status prompt suppresses the transcript fallback outright.
    const working = promptsFor({ state: 'working', interactivePrompt: ASK }, askMessages)
    expect(working.ask).toBeNull()
    expect(working.detectedAsk).not.toBeNull()
  })

  it('still refuses an unpaused sticky status prompt that the transcript does not back', () => {
    const answered: NativeChatMessage[] = [
      ...askMessages,
      {
        id: 'm2',
        role: 'tool',
        blocks: [{ type: 'tool-result', output: 'fast' }],
        timestamp: 1,
        source: 'transcript'
      }
    ]
    expect(promptsFor({ state: 'done', interactivePrompt: ASK }, answered).ask).toBeNull()
    expect(promptsFor({ state: 'done' }, answered).ask).toBeNull()
  })
})

describe('useMobileNativeChatPrompts question card', () => {
  const reply = [
    'Findings so far:',
    '- the cache is stale',
    '- the lock is held',
    '',
    'Which fix do you want?',
    '1. Clear the cache',
    '2. Release the lock'
  ].join('\n')

  it('offers a waiting agent the choice list under its question, not the findings above it', () => {
    expect(promptsFor({ state: 'waiting', lastAssistantMessage: reply }).question).toEqual({
      question: 'Which fix do you want?',
      options: ['Clear the cache', 'Release the lock'],
      multiSelect: false,
      optionTokens: ['1', '2']
    })
    expect(promptsFor({ state: 'blocked', lastAssistantMessage: reply }).question?.options).toEqual([
      'Clear the cache',
      'Release the lock'
    ])
  })

  // The notes reply pinned null until 2026-09-30, when the card took the
  // reply's last list; the choices are the list under the line that asks.
  it('offers the choices under the question when a notes list follows them', () => {
    expect(
      promptsFor({
        state: 'waiting',
        lastAssistantMessage: 'Which fix?\n1. Clear\n2. Release\n\nNotes:\n- a\n- b'
      }).question
    ).toEqual({
      question: 'Which fix?',
      options: ['Clear', 'Release'],
      multiSelect: false,
      optionTokens: ['1', '2']
    })
  })

  it('shows no question card for a reply whose lists sit under no question', () => {
    expect(
      promptsFor({
        state: 'waiting',
        lastAssistantMessage: 'Findings:\n- x\n- y\n\nNotes:\n- a\n- b'
      }).question
    ).toBeNull()
    expect(promptsFor({ state: 'waiting', lastAssistantMessage: '' }).question).toBeNull()
  })

  it('shows no question card while the agent is working', () => {
    expect(promptsFor({ state: 'working', lastAssistantMessage: reply }).question).toBeNull()
  })
})

// 2026-09-30: "do you want to" made this a "Permission requested" card whose
// buttons were the choices, and a permission card hides the question card.
describe('useMobileNativeChatPrompts: a question or a plan is not a permission', () => {
  const database = 'Which database do you want to use?\n\n1. Postgres\n2. SQLite'
  const plan = 'I will make these changes:\n1. Edit a.ts\n2. Edit b.ts\n\nDo you want to go ahead?'

  it.each(['waiting', 'blocked'] as const)(
    'shows a %s agent’s choice of database as a question card, not a permission',
    (state) => {
      const prompts = promptsFor({ state, lastAssistantMessage: database })
      expect(prompts.permission).toBeNull()
      expect(prompts.question).toEqual({
        question: 'Which database do you want to use?',
        options: ['Postgres', 'SQLite'],
        multiSelect: false,
        optionTokens: ['1', '2']
      })
    }
  )

  it('asks Allow or Deny for a plan that asks to go ahead, and shows no question card', () => {
    const prompts = promptsFor({ state: 'waiting', lastAssistantMessage: plan })
    expect(prompts.permission?.options).toEqual([
      { label: 'Allow', send: 'y' },
      { label: 'Deny', send: 'n' }
    ])
    expect(prompts.question).toBeNull()
  })

  // The host's approval envelope is a pending permission whatever the last
  // message says, so it still takes the card after a question is left alone.
  it('keeps the host approval envelope over a question in the last message', () => {
    const prompts = promptsFor({
      state: 'waiting',
      interactivePrompt: APPROVAL,
      lastAssistantMessage: database
    })
    expect(prompts.permission).toMatchObject({ title: 'Allow Bash?' })
    expect(prompts.question).toBeNull()
  })
})
