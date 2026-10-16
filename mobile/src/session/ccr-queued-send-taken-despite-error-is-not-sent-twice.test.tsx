import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CcrEvent } from './ccr-session-api'
import { hook, io, posts, postedTexts, render, resetCcrComposerHarness, send, settle, state, unmount } from './ccr-composer-send.test-support'
/**
 * Second review of the queue-as-list change, 2026-10-16: a queued entry's turn-end POST threw on
 * the phone (a timeout) after the server had taken it. The entry was put back in the queue, the
 * taken message's turn ran, and at its end the same words were posted again under a new uuid, so
 * Claude got the message twice and "second" never went. The entry now keeps its first uuid: its
 * echo retires the card, and a retry goes under the same uuid.
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

async function queueWhileWorking(...texts: string[]): Promise<void> {
  state.working = true
  render()
  for (const text of texts) {
    expect(await send(text)).toBe('accepted')
  }
}

describe('a queued message whose POST failed on the phone but reached the server', () => {
  it('a queued send whose POST errors but which the server took is not posted a second time at the next turn end', async () => {
    await queueWhileWorking('first', 'second')
    // The POST times out on the phone, but the server took it (its echo arrives after).
    io.post = async () => { throw new Error('timeout') }
    state.working = false
    render()
    await settle()
    await settle()
    expect(postedTexts().map((p) => p.text)).toEqual(['first'])
    io.post = async () => undefined
    const echo: CcrEvent = { eventId: 'uuid-1', payload: { type: 'user', uuid: 'uuid-1', message: { role: 'user', content: 'first' } } }
    state.events = [echo]
    // The turn 'first' started runs and ends.
    state.working = true
    render()
    await settle()
    state.events = [echo, { eventId: 'r-1', payload: { type: 'result', subtype: 'success' } }]
    state.working = false
    render()
    await settle()
    await settle()
    expect(postedTexts().map((p) => p.text)).toEqual(['first', 'second'])
  })

  it('a retry of a queued message the server never took goes under its first uuid', async () => {
    await queueWhileWorking('first')
    io.post = async () => { throw new Error('HTTP 503') }
    state.working = false
    render()
    await settle()
    await settle()
    io.post = async () => undefined
    // The user's next send resumes the queue: the retry reuses uuid-1.
    expect(await send('later')).toBe('accepted')
    await settle()
    await settle()
    expect(postedTexts().map((p) => p.text)).toEqual(['first', 'first'])
    expect(posts.map((p) => p.body.events[0]!.payload.uuid)).toEqual(['uuid-1', 'uuid-1'])
    expect(hook.api.queue).toEqual(['later'])
  })
})
