import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAskFromStatus, type AskPrompt } from '../../../src/shared/native-chat-ask'
import type { RpcClient } from '../transport/rpc-client'
import { ASK_USER_QUESTION_CONTEXT_RING } from './ask-user-question-fixtures'
import type { PendingPrompt } from './permission-lookup'
import { answerPromptFromNotification } from './prompt-notification-response'

const ESCAPE = String.fromCharCode(27)

function ask(input: unknown): AskPrompt {
  const parsed = parseAskFromStatus(JSON.stringify(input))
  if (!parsed) {
    throw new Error('fixture did not parse')
  }
  return parsed
}

const BASH: PendingPrompt = {
  kind: 'permission',
  terminal: 'agent-1',
  agent: 'claude',
  permission: {
    title: 'Allow Bash?',
    detail: 'Recompile page 2',
    options: [
      { label: 'Allow', send: '1' },
      { label: 'Deny', send: ESCAPE }
    ]
  }
}

const QUESTION: PendingPrompt = {
  kind: 'question',
  terminal: 'agent-1',
  agent: 'claude',
  prompt: ask(ASK_USER_QUESTION_CONTEXT_RING)
}

const PERMISSION_DATA = {
  hostId: 'host-1',
  worktreeId: 'wt-1',
  // `mobileChatPermissionKey` joins title, command and detail with NUL.
  permissionKey: ['Allow Bash?', '', 'Recompile page 2'].join('\u0000'),
  sends: { 'permission:0': '1', 'permission:1': ESCAPE }
}

const QUESTION_DATA = {
  hostId: 'host-1',
  worktreeId: 'wt-1',
  questionKey: `question:${JSON.stringify(QUESTION.prompt.questions)}`,
  picks: { 'question:0': 0, 'question:1': 1 }
}

const client = { getState: () => 'connected' } as unknown as RpcClient

/**
 * One tap handler for both banner kinds. The data says which it is, each path
 * keeps its own guard, and a reply typed into the shade reaches the question
 * path with its text. Nothing here navigates.
 */
describe('answering whichever prompt a banner was about', () => {
  const sendPermission = vi.fn(async () => true)
  const sendQuestion = vi.fn(async () => true)
  let log: ReturnType<typeof vi.spyOn>

  function run(
    actionIdentifier: string,
    data: unknown,
    pending: PendingPrompt | null,
    userText: string | null = null
  ) {
    return answerPromptFromNotification({
      actionIdentifier,
      userText,
      data,
      resolveClient: () => client,
      lookup: async () => pending,
      sendPermission,
      sendQuestion
    })
  }

  beforeEach(() => {
    sendPermission.mockClear()
    sendQuestion.mockClear()
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    log.mockRestore()
  })

  it('routes a permission button to the permission sender', async () => {
    expect(await run('permission:1', PERMISSION_DATA, BASH)).toBe('sent')
    expect(sendPermission).toHaveBeenCalledWith({ client, terminal: 'agent-1', text: ESCAPE })
    expect(sendQuestion).not.toHaveBeenCalled()
  })

  it('routes a question button to the question sender', async () => {
    expect(await run('question:1', QUESTION_DATA, QUESTION)).toBe('sent')
    expect(sendQuestion).toHaveBeenCalledWith({
      hostId: 'host-1',
      client,
      terminal: 'agent-1',
      agent: 'claude',
      prompt: QUESTION.prompt,
      selections: [{ indices: [1] }]
    })
    expect(sendPermission).not.toHaveBeenCalled()
  })

  it('routes a typed reply to the question sender with what was typed', async () => {
    expect(await run('question:other', QUESTION_DATA, QUESTION, 'keep everything')).toBe('sent')
    expect(sendQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ selections: [{ indices: [], other: 'keep everything' }] })
    )
    expect(sendPermission).not.toHaveBeenCalled()
  })

  it('refuses a reply it cannot read, sending nothing and leaving a line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await run('question:other', QUESTION_DATA, QUESTION, '   ')).toBe('refused')
    expect(sendQuestion).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('[prompt-notification]'),
      expect.objectContaining({ outcome: 'refused', actionIdentifier: 'question:other' })
    )
    warn.mockRestore()
  })

  // Android delivers its DEFAULT identifier for a body tap, on either kind.
  it.each([
    ['a permission banner', PERMISSION_DATA],
    ['a question banner', QUESTION_DATA],
    ['a plain banner', { hostId: 'host-1', worktreeId: 'wt-1', source: 'agent-task-complete' }]
  ])('is not an answer when the body of %s is tapped', async (_label, data) => {
    expect(await run('expo.modules.notifications.actions.DEFAULT', data, BASH)).toBe(
      'not-an-answer'
    )
    expect(sendPermission).not.toHaveBeenCalled()
    expect(sendQuestion).not.toHaveBeenCalled()
  })

  // Rule: a tap that did nothing must leave a line saying why, with the host
  // and worktree on it — a dead button is otherwise indistinguishable from a
  // slow one.
  it('leaves a line behind when a tap sends nothing', async () => {
    expect(await run('question:1', QUESTION_DATA, null)).toBe('stale')
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('[prompt-notification]'),
      expect.objectContaining({
        outcome: 'stale',
        actionIdentifier: 'question:1',
        hostId: 'host-1',
        worktreeId: 'wt-1'
      })
    )
  })

  it('leaves no line for a tap that was never ours to answer', async () => {
    await run('expo.modules.notifications.actions.DEFAULT', QUESTION_DATA, QUESTION)
    expect(log).not.toHaveBeenCalled()
  })
})
