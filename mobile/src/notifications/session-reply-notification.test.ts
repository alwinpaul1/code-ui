import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_REPLY_ACTION,
  SESSION_REPLY_LABEL,
  decorateWithReply,
  sessionReplyHint
} from './session-reply-notification'

// The Claude Android app's Reply on a session notification (n530.java:775-792): an action labelled
// "Reply" (`notification_action_reply`) with a remote-input field whose hint is "Reply to Claude"
// (`notification_reply_hint`), answered in the shade without opening the app.

const FINISHED = {
  title: 'repo / main · Claude finished',
  body: 'Added the retry budget.',
  data: {
    source: 'agent-task-complete',
    hostId: 'host-1',
    worktreeId: 'wt-1',
    notificationId: 'agent:wt-1:tab-1%3Aleaf-1:123',
    paneKey: 'tab-1:leaf-1'
  }
}
const EVENT = { source: 'agent-task-complete' as const, worktreeId: 'wt-1' }

function deps(agent: string | null = 'claude') {
  return { agent, ensureCategory: vi.fn(async () => 'codeui-permission-session-reply') }
}

describe('the Reply button on a finished session', () => {
  it('is labelled Reply, with the field’s hint "Reply to Claude"', () => {
    expect(SESSION_REPLY_LABEL).toBe('Reply')
    expect(sessionReplyHint('claude')).toBe('Reply to Claude')
  })

  it('registers one reply action and claims the category for the banner', async () => {
    const d = deps()
    const out = await decorateWithReply(FINISHED, EVENT, d)
    expect(d.ensureCategory).toHaveBeenCalledWith([
      { identifier: SESSION_REPLY_ACTION, label: 'Reply', textInput: { placeholder: 'Reply to Claude' } }
    ])
    expect(out.categoryIdentifier).toBe('codeui-permission-session-reply')
  })

  it('keeps the banner’s own words and routing data', async () => {
    const out = await decorateWithReply(FINISHED, EVENT, deps())
    expect(out.title).toBe(FINISHED.title)
    expect(out.body).toBe(FINISHED.body)
    expect(out.data).toMatchObject(FINISHED.data)
  })

  it('names the agent the session runs in the hint', () => {
    expect(sessionReplyHint('codex')).toBe('Reply to Codex')
    expect(sessionReplyHint('openclaude')).toBe('Reply to OpenClaude')
    expect(sessionReplyHint(null)).toBe('Reply to Claude')
  })

  it('is offered for a session whose agent the host did not name (the desktop calls it Claude)', async () => {
    const d = deps(null)
    expect((await decorateWithReply(FINISHED, EVENT, d)).categoryIdentifier).toBeTruthy()
  })

  it('is offered for a Codex session, with that agent in the hint', async () => {
    const d = deps('codex')
    await decorateWithReply(FINISHED, EVENT, d)
    expect(d.ensureCategory).toHaveBeenCalledWith([
      expect.objectContaining({ textInput: { placeholder: 'Reply to Codex' } })
    ])
  })

  it.each([['grok'], ['gemini'], ['aider']])('is not offered for %s, which the outbox has no composer reader for', async (agent) => {
    const d = deps(agent)
    expect(await decorateWithReply(FINISHED, EVENT, d)).toEqual(FINISHED)
    expect(d.ensureCategory).not.toHaveBeenCalled()
  })

  it('is not offered where the reply could not be routed back to a tab', async () => {
    const d = deps()
    const noPane = { ...FINISHED, data: { ...FINISHED.data, paneKey: undefined } }
    expect(await decorateWithReply(noPane, EVENT, d)).toEqual(noPane)
    expect(d.ensureCategory).not.toHaveBeenCalled()
  })

  it('is not offered with no worktree or no host in the data', async () => {
    const d = deps()
    expect(await decorateWithReply({ ...FINISHED, data: { ...FINISHED.data, hostId: undefined } }, EVENT, d)).toEqual({
      ...FINISHED,
      data: { ...FINISHED.data, hostId: undefined }
    })
    expect(await decorateWithReply(FINISHED, { source: 'agent-task-complete' }, d)).toEqual(FINISHED)
  })

  it('is not offered on a bell or the test notification', async () => {
    const d = deps()
    expect(await decorateWithReply(FINISHED, { ...EVENT, source: 'terminal-bell' }, d)).toEqual(FINISHED)
    expect(await decorateWithReply(FINISHED, { ...EVENT, source: 'test' }, d)).toEqual(FINISHED)
  })

  it('does not replace buttons a banner already has (a permission or a question to answer)', async () => {
    const d = deps()
    const withButtons = { ...FINISHED, categoryIdentifier: 'codeui-permission-Allow|Deny' }
    expect(await decorateWithReply(withButtons, EVENT, d)).toEqual(withButtons)
    expect(d.ensureCategory).not.toHaveBeenCalled()
  })

  it('leaves the banner as it was when the system will not take the button', async () => {
    const d = { agent: 'claude', ensureCategory: vi.fn(async () => null) }
    expect(await decorateWithReply(FINISHED, EVENT, d)).toEqual(FINISHED)
  })

  it('leaves the banner as it was when registering throws', async () => {
    const d = {
      agent: 'claude',
      ensureCategory: vi.fn(async () => {
        throw new Error('no channel')
      })
    }
    expect(await decorateWithReply(FINISHED, EVENT, d)).toEqual(FINISHED)
  })
})
