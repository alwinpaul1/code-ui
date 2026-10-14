import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { PendingPermission } from './permission-lookup'
import { decorateWithPrompt } from './permission-notification-decorate'

const ESCAPE = String.fromCharCode(27)
const client = {} as RpcClient

// The Claude Android app's permission notification (i09.java, n030.java:486-520): Approve (not for
// a plan, a question or a destructive tool), Deny, and Deny with comment, whose reply field says
// "Tell Claude what to do instead". Over a terminal tab the comment is typed into Claude Code's
// own "No" row (claude-permission-comment-send.ts), so it is offered for Claude Code, whose dialog
// that is, and not for Codex, whose dialog has another shape and was not captured.

function pending(title: string, agent: string, command?: string): PendingPermission {
  return {
    kind: 'permission',
    terminal: 'agent-1',
    agent,
    permission: {
      title,
      ...(command === undefined ? {} : { command }),
      options: [
        { label: 'Allow', send: '1' },
        { label: 'Deny', send: ESCAPE }
      ]
    }
  }
}

const DESKTOP = {
  title: 'Claude needs input',
  body: 'stdout of the previous command',
  data: { source: 'agent-task-complete', hostId: 'host-1', worktreeId: 'wt-1' }
}

async function decorate(prompt: PendingPermission) {
  const ensureCategory = vi.fn(async () => 'codeui-permission-test')
  const out = await decorateWithPrompt(DESKTOP, { worktreeId: 'wt-1' }, 'host-1', {
    resolveClient: () => client,
    lookup: async () => prompt,
    ensureCategory
  })
  const registered = (ensureCategory.mock.calls as unknown as [Array<Record<string, unknown>>][])[0]?.[0] ?? null
  return { out, registered }
}

const labels = (registered: Array<Record<string, unknown>> | null) => registered?.map((action) => action.label)

describe('the buttons on a Claude Code permission banner', () => {
  it('are Approve, Deny and Deny with comment for an ordinary request', async () => {
    const { registered } = await decorate(pending('Allow Bash?', 'claude', 'npm test'))
    expect(labels(registered)).toEqual(['Allow', 'Deny', 'Deny with comment'])
  })

  it('give Deny with comment a reply field that says what to type, in the Claude app’s words', async () => {
    const { registered } = await decorate(pending('Allow Bash?', 'claude', 'npm test'))
    expect(registered?.at(-1)).toEqual({
      identifier: 'permission-comment',
      label: 'Deny with comment',
      textInput: { placeholder: 'Tell Claude what to do instead' }
    })
  })

  it('stay within the three Android draws', async () => {
    const { registered } = await decorate(pending('Allow Bash?', 'claude', 'npm test'))
    expect(registered!.length).toBeLessThanOrEqual(3)
  })

  it('let a tap on the comment button through, and only that one and the two options', async () => {
    const { out } = await decorate(pending('Allow Bash?', 'claude', 'npm test'))
    expect(out.data).toMatchObject({ comment: true, sends: { 'permission:0': '1', 'permission:1': ESCAPE } })
  })

  it('serve OpenClaude, which draws Claude Code’s dialog, the same', async () => {
    const { registered } = await decorate(pending('Allow Bash?', 'openclaude', 'npm test'))
    expect(labels(registered)).toEqual(['Allow', 'Deny', 'Deny with comment'])
  })

  it('leave Codex with Approve and Deny only: its dialog was not captured for a comment', async () => {
    const { registered, out } = await decorate(pending('Allow Bash?', 'codex', 'npm test'))
    expect(labels(registered)).toEqual(['Allow', 'Deny'])
    expect(out.data).not.toHaveProperty('comment')
  })
})

describe('Approve withheld from the banner', () => {
  it('is not drawn for a plan to approve, and the banner offers Deny alone', async () => {
    const { registered, out } = await decorate(pending('Allow ExitPlanMode?', 'claude'))
    expect(labels(registered)).toEqual(['Deny'])
    expect(out.data).toMatchObject({ sends: { 'permission:1': ESCAPE } })
  })

  it('cannot be answered by a tap that names it anyway: its keystrokes are not on the banner', async () => {
    const { out } = await decorate(pending('Allow ExitPlanMode?', 'claude'))
    expect((out.data as { sends: Record<string, string> }).sends).not.toHaveProperty('permission:0')
  })

  it('is not drawn for a question to answer', async () => {
    const { registered } = await decorate(pending('Allow AskUserQuestion?', 'claude'))
    expect(labels(registered)).toEqual(['Deny'])
  })

  it('is not drawn for a destructive command, which can still be denied, with a comment', async () => {
    const { registered, out } = await decorate(pending('Allow Bash?', 'claude', 'rm -rf build'))
    expect(labels(registered)).toEqual(['Deny', 'Deny with comment'])
    expect(out.data).toMatchObject({ comment: true })
    expect((out.data as { sends: Record<string, string> }).sends).toEqual({ 'permission:1': ESCAPE })
  })

  it('is not drawn for a destructive command in Codex either, and gets no comment button', async () => {
    const { registered } = await decorate(pending('Allow Bash?', 'codex', 'git push --force'))
    expect(labels(registered)).toEqual(['Deny'])
  })

  it('leaves the desktop’s own banner when nothing is left to answer', async () => {
    const lookupOnly: PendingPermission = {
      kind: 'permission',
      terminal: 'agent-1',
      agent: 'claude',
      permission: { title: 'Allow ExitPlanMode?', options: [{ label: 'Allow', send: '1' }] }
    }
    const ensureCategory = vi.fn(async () => 'x')
    const out = await decorateWithPrompt(DESKTOP, { worktreeId: 'wt-1' }, 'host-1', {
      resolveClient: () => client,
      lookup: async () => lookupOnly,
      ensureCategory
    })
    expect(out).toEqual(DESKTOP)
    expect(ensureCategory).not.toHaveBeenCalled()
  })
})
