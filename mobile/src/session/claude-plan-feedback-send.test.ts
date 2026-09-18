import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import {
  CLAUDE_PLAN_FEEDBACK_REFUSAL_MESSAGE,
  sendClaudePlanFeedback
} from './claude-plan-feedback-send'

type Call = { method: string; params: unknown }

function fakeClient(
  handler: (method: string, params: unknown) => unknown,
  state: string = 'connected'
): { client: RpcClient; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    getState: () => state,
    sendRequest: vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params })
      return handler(method, params)
    })
  } as unknown as RpcClient
  return { client, calls }
}

const HIGHLIGHTED_OPTION_3_SCREEN = [
  ' Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '   1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '   ❯ 3. Tell Claude what to change',
  '        shift+tab to approve with this feedback'
]

const STILL_ON_OPTION_1_SCREEN = [
  ' Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '',
  '   ❯ 1. Yes, and use auto mode',
  '     2. Yes, manually approve edits',
  '     3. Tell Claude what to change'
]

describe('rejecting a Claude Code plan review with typed feedback', () => {
  it('sends the digit with Enter and nothing else when the comment is empty', async () => {
    const { client, calls } = fakeClient(() => ({ ok: true, result: { send: { accepted: true } } }))
    const outcome = await sendClaudePlanFeedback({
      client,
      terminal: 'term-1',
      deviceToken: null,
      optionSend: '3',
      comment: '   '
    })
    expect(outcome).toEqual({ kind: 'sent' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'terminal.send',
      params: { terminal: 'term-1', text: '3', enter: true }
    })
  })

  it('selects, verifies the highlight, then types the comment and submits it', async () => {
    const { client, calls } = fakeClient((method) => {
      if (method === 'terminal.read') {
        return { ok: true, result: { terminal: { lines: HIGHLIGHTED_OPTION_3_SCREEN, source: 'screen' } } }
      }
      return { ok: true, result: { send: { accepted: true } } }
    })
    const outcome = await sendClaudePlanFeedback({
      client,
      terminal: 'term-1',
      deviceToken: 'dev-1',
      optionSend: '3',
      comment: 'Use two sentences instead.'
    })
    expect(outcome).toEqual({ kind: 'sent' })
    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({
      method: 'terminal.send',
      params: { terminal: 'term-1', text: '3', enter: false }
    })
    expect(calls[1]).toMatchObject({
      method: 'terminal.read',
      params: { terminal: 'term-1', screen: true }
    })
    expect(calls[2]).toMatchObject({
      method: 'terminal.send',
      params: { terminal: 'term-1', text: 'Use two sentences instead.', enter: true }
    })
  })

  it('does not take an earlier prompt that began "3." for the highlighted row', async () => {
    // Claude Code paints an accepted prompt as "❯ <text>", so a user who
    // numbered their own message leaves a "❯ 3. …" row on screen above the
    // review. The review's row is the last one painted; only it decides.
    const promptAboveReview = [
      '❯ 3. Then wire the button up',
      '',
      ...STILL_ON_OPTION_1_SCREEN
    ]
    const { client, calls } = fakeClient((method) => {
      if (method === 'terminal.read') {
        return { ok: true, result: { terminal: { lines: promptAboveReview, source: 'screen' } } }
      }
      return { ok: true, result: { send: { accepted: true } } }
    })
    const outcome = await sendClaudePlanFeedback({
      client,
      terminal: 'term-1',
      deviceToken: null,
      optionSend: '3',
      comment: 'Use two sentences instead.'
    })
    expect(outcome).toEqual({ kind: 'refused', message: CLAUDE_PLAN_FEEDBACK_REFUSAL_MESSAGE })
    expect(calls).toHaveLength(2)
  })

  it('refuses rather than type over a screen that never shows the option highlighted', async () => {
    const { client, calls } = fakeClient((method) => {
      if (method === 'terminal.read') {
        return { ok: true, result: { terminal: { lines: STILL_ON_OPTION_1_SCREEN, source: 'screen' } } }
      }
      return { ok: true, result: { send: { accepted: true } } }
    })
    const outcome = await sendClaudePlanFeedback({
      client,
      terminal: 'term-1',
      deviceToken: null,
      optionSend: '3',
      comment: 'Use two sentences instead.'
    })
    expect(outcome).toEqual({ kind: 'refused', message: CLAUDE_PLAN_FEEDBACK_REFUSAL_MESSAGE })
    // Only the navigate write and the verifying read — never the comment.
    expect(calls).toHaveLength(2)
    expect(calls.some((call) => call.method === 'terminal.send' && (call.params as { enter?: boolean }).enter === true)).toBe(false)
  })

  it('refuses on a stream-fallback read instead of trusting stale scrollback', async () => {
    const { client, calls } = fakeClient((method) => {
      if (method === 'terminal.read') {
        return {
          ok: true,
          result: { terminal: { lines: HIGHLIGHTED_OPTION_3_SCREEN, source: 'stream' } }
        }
      }
      return { ok: true, result: { send: { accepted: true } } }
    })
    const outcome = await sendClaudePlanFeedback({
      client,
      terminal: 'term-1',
      deviceToken: null,
      optionSend: '3',
      comment: 'Use two sentences instead.'
    })
    expect(outcome).toEqual({ kind: 'refused', message: CLAUDE_PLAN_FEEDBACK_REFUSAL_MESSAGE })
    expect(calls).toHaveLength(2)
  })

  it('fails without typing the comment when the select write is declined', async () => {
    const { client, calls } = fakeClient(() => ({ ok: true, result: { send: { accepted: false } } }))
    const outcome = await sendClaudePlanFeedback({
      client,
      terminal: 'term-1',
      deviceToken: null,
      optionSend: '3',
      comment: 'Use two sentences instead.'
    })
    expect(outcome).toEqual({ kind: 'failed' })
    expect(calls).toHaveLength(1)
  })

  it('reports failure rather than throwing when the host refuses', async () => {
    const client = {
      getState: () => 'connected',
      sendRequest: vi.fn(async () => {
        throw new Error('socket closed')
      })
    } as unknown as RpcClient
    await expect(
      sendClaudePlanFeedback({
        client,
        terminal: 'term-1',
        deviceToken: null,
        optionSend: '3',
        comment: 'Use two sentences instead.'
      })
    ).resolves.toEqual({ kind: 'failed' })
  })

  it('does not write over a link that is down', async () => {
    const { client, calls } = fakeClient(() => ({ ok: true, result: { send: { accepted: true } } }), 'connecting')
    const outcome = await sendClaudePlanFeedback({
      client,
      terminal: 'term-1',
      deviceToken: null,
      optionSend: '3',
      comment: 'Use two sentences instead.'
    })
    expect(outcome).toEqual({ kind: 'failed' })
    expect(calls).toHaveLength(0)
  })
})
