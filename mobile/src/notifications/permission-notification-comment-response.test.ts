import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { mobileChatPermissionKey } from '../session/mobile-native-chat-permission'
import type { PendingPrompt } from './permission-lookup'
import { answerPromptFromNotification } from './prompt-notification-response'

const ESCAPE = String.fromCharCode(27)
const connected = { getState: () => 'connected' } as unknown as RpcClient
const offline = { getState: () => 'disconnected' } as unknown as RpcClient

const PERMISSION = {
  title: 'Allow Bash?',
  detail: 'Recompile page 2',
  options: [
    { label: 'Allow', send: '1' },
    { label: 'Deny', send: ESCAPE }
  ]
}

function pending(agent = 'claude', permission = PERMISSION): PendingPrompt {
  return { kind: 'permission', terminal: 'live-terminal', agent, permission }
}

/** What a Claude banner's tap carries (permission-notification-decorate.ts). */
const DATA = {
  hostId: 'host-1',
  worktreeId: 'wt-1',
  permissionKey: mobileChatPermissionKey(PERMISSION),
  sends: { 'permission:0': '1', 'permission:1': ESCAPE },
  comment: true
}

function tap(overrides: Partial<Parameters<typeof answerPromptFromNotification>[0]> = {}) {
  const sendComment = vi.fn(async () => 'sent' as const)
  const sendPermission = vi.fn(async () => true)
  const sendQuestion = vi.fn(async () => true)
  const args = {
    actionIdentifier: 'permission-comment',
    userText: 'use the date command instead',
    data: DATA,
    resolveClient: () => connected,
    lookup: async () => pending(),
    sendPermission,
    sendQuestion,
    sendPermissionComment: sendComment,
    ...overrides
  }
  return { run: () => answerPromptFromNotification(args), sendComment, sendPermission, sendQuestion }
}

// "Deny with comment" from the shade (n030.java:486-520, `hub_deny_comment`): the words go to the
// agent the live prompt is waiting in, by Claude Code's own keys (claude-permission-comment-send.ts),
// after the same re-check every other tap makes: a banner minutes old must not carry its words to
// whatever the agent is asking now.

describe('a tap on Deny with comment', () => {
  it('sends the typed words to the terminal the prompt is waiting in', async () => {
    const t = tap()
    expect(await t.run()).toBe('sent')
    expect(t.sendComment).toHaveBeenCalledWith({
      client: connected,
      terminal: 'live-terminal',
      comment: 'use the date command instead'
    })
  })

  it('writes no option keystroke of its own: the comment path is the only writer', async () => {
    const t = tap()
    await t.run()
    expect(t.sendPermission).not.toHaveBeenCalled()
    expect(t.sendQuestion).not.toHaveBeenCalled()
  })

  it('trims the words before they are sent', async () => {
    const t = tap({ userText: '  use the date command instead \n' })
    await t.run()
    expect(t.sendComment).toHaveBeenCalledWith(expect.objectContaining({ comment: 'use the date command instead' }))
  })

  it('answers stale and sends nothing when the agent now asks something else', async () => {
    const other = { ...PERMISSION, detail: 'Delete the build folder' }
    const t = tap({ lookup: async () => pending('claude', other) })
    expect(await t.run()).toBe('stale')
    expect(t.sendComment).not.toHaveBeenCalled()
  })

  it('answers stale when a question has taken the permission’s place', async () => {
    const t = tap({
      lookup: async (): Promise<PendingPrompt> => ({
        kind: 'question',
        terminal: 'live-terminal',
        agent: 'claude',
        prompt: { questions: [] } as never
      })
    })
    expect(await t.run()).toBe('stale')
    expect(t.sendComment).not.toHaveBeenCalled()
  })

  it('answers stale when nothing is pending any more', async () => {
    const t = tap({ lookup: async () => null })
    expect(await t.run()).toBe('stale')
  })

  it('refuses empty words without asking the host anything', async () => {
    const lookup = vi.fn(async () => pending())
    for (const userText of [null, '', '   \n']) {
      const t = tap({ userText, lookup })
      expect(await t.run()).toBe('refused')
      expect(t.sendComment).not.toHaveBeenCalled()
    }
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuses when the live prompt is waiting in an agent whose dialog this was not captured for', async () => {
    const t = tap({ lookup: async () => pending('codex') })
    expect(await t.run()).toBe('refused')
    expect(t.sendComment).not.toHaveBeenCalled()
  })

  it('serves OpenClaude, which draws Claude Code’s dialog', async () => {
    const t = tap({ lookup: async () => pending('openclaude') })
    expect(await t.run()).toBe('sent')
  })

  it('answers offline and unroutable without a lookup', async () => {
    const lookup = vi.fn(async () => pending())
    expect(await tap({ resolveClient: () => offline, lookup }).run()).toBe('offline')
    expect(await tap({ resolveClient: () => null, lookup }).run()).toBe('unroutable')
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each(['stale', 'refused', 'failed'] as const)('passes the sender’s %s on', async (outcome) => {
    const t = tap({ sendPermissionComment: vi.fn(async () => outcome) })
    expect(await t.run()).toBe(outcome)
  })

  it('answers failed when the sender throws', async () => {
    const t = tap({
      sendPermissionComment: vi.fn(async () => {
        throw new Error('socket closed')
      })
    })
    expect(await t.run()).toBe('failed')
  })

  it('is no answer at all on a banner that did not offer the button', async () => {
    const { comment: _comment, ...withoutComment } = DATA
    void _comment
    const t = tap({ data: withoutComment })
    expect(await t.run()).toBe('not-an-answer')
    expect(t.sendComment).not.toHaveBeenCalled()
  })

  it('is no answer for a banner that is not ours', async () => {
    expect(await tap({ data: { hostId: 'host-1' } }).run()).toBe('not-an-answer')
  })

  it('leaves an Approve the banner never offered unanswerable', async () => {
    const { sends } = DATA
    const withheld = { ...DATA, sends: { 'permission:1': sends['permission:1'] } }
    const t = tap({ actionIdentifier: 'permission:0', userText: null, data: withheld })
    expect(await t.run()).toBe('not-an-answer')
    expect(t.sendPermission).not.toHaveBeenCalled()
  })

  it('still answers the ordinary Deny button with its Escape', async () => {
    const t = tap({ actionIdentifier: 'permission:1', userText: null })
    expect(await t.run()).toBe('sent')
    expect(t.sendPermission).toHaveBeenCalledWith({ client: connected, terminal: 'live-terminal', text: ESCAPE })
  })
})
