import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CcrEvent } from './ccr-session-api'
import { calls, composer, CSE_A, hook, io, logs, postedTexts, render, resetCcrComposerHarness, send, settle, state, unmount } from './ccr-composer-send.test-support'

/**
 * Reported 2026-10-16: with one message queued while Claude worked on an Anthropic-lane Claude tab,
 * a second send joined the first ("message one and message two are in the same queue as a single
 * message") instead of becoming queued message two, as the user sees in the Claude app. The phone
 * now keeps one entry per send, draws a card per entry, and sends them one turn each, in order.
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

async function turnEnds(): Promise<void> {
  state.working = false
  render()
  await settle()
  await settle()
}

async function nextTurnRunsAndEnds(): Promise<void> {
  state.working = true
  render()
  await settle()
  await turnEnds()
}

describe('messages sent while Claude works on an Anthropic-lane tab', () => {
  it('a second message sent while one is queued becomes queue entry two, not part of entry one', async () => {
    await queueWhileWorking('add a test', 'then run it')
    expect(hook.api.queue).toEqual(['add a test', 'then run it'])
    expect(postedTexts()).toEqual([])
  })

  it('sends the queued messages one turn each, in order', async () => {
    await queueWhileWorking('first', 'second', 'third')
    await turnEnds()
    expect(postedTexts().map((post) => post.text)).toEqual(['first'])
    expect(hook.api.queue).toEqual(['second', 'third'])
    // More renders with no new turn send nothing more: the first one's turn has not run yet.
    render()
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['first'])
    await nextTurnRunsAndEnds()
    expect(postedTexts().map((post) => post.text)).toEqual(['first', 'second'])
    expect(hook.api.queue).toEqual(['third'])
    await nextTurnRunsAndEnds()
    expect(postedTexts().map((post) => post.text)).toEqual(['first', 'second', 'third'])
    expect(hook.api.queue).toEqual([])
    // Each one is an ordinary send: no priority.
    expect(postedTexts().map((post) => post.priority)).toEqual([undefined, undefined, undefined])
  })

  it('goes on to the next entry when the stream shows the sent one taken and its turn finished, even unseen working', async () => {
    await queueWhileWorking('first', 'second')
    await turnEnds()
    expect(postedTexts().map((post) => post.text)).toEqual(['first'])
    const echo: CcrEvent = { eventId: 'uuid-1', payload: { type: 'user', uuid: 'uuid-1', message: { role: 'user', content: 'first' } } }
    const result: CcrEvent = { eventId: 'r-1', payload: { type: 'result', subtype: 'success' } }
    state.events = [echo]
    render()
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['first'])
    state.events = [echo, result]
    render()
    await settle()
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['first', 'second'])
  })

  it('removing entry two leaves entry one queued', async () => {
    await queueWhileWorking('one', 'two', 'three')
    act(() => hook.api.editQueue(1))
    expect(composer.text).toBe('two')
    expect(hook.api.queue).toEqual(['one', 'three'])
  })

  it('an entry tapped while the composer holds words goes in ahead of them, and neither is lost', async () => {
    await queueWhileWorking('queued words')
    composer.text = 'half typed'
    act(() => hook.api.editQueue(0))
    expect(composer.text).toBe('queued words\n\nhalf typed')
    expect(hook.api.queue).toEqual([])
  })

  it('with one entry, a tap empties the queue; with none, or past the end, a tap changes nothing', async () => {
    state.working = true
    render()
    act(() => hook.api.editQueue(0))
    expect(composer.text).toBe('')
    expect(hook.api.queue).toEqual([])
    await send('only')
    act(() => hook.api.editQueue(1))
    expect(hook.api.queue).toEqual(['only'])
    expect(composer.text).toBe('')
    act(() => hook.api.editQueue(0))
    expect(composer.text).toBe('only')
    expect(hook.api.queue).toEqual([])
  })

  it('keeps a queued message that fails to send queued, in its place, and says why and that it is still queued', async () => {
    await queueWhileWorking('first', 'second')
    io.post = async () => {
      throw new Error('HTTP 503')
    }
    await turnEnds()
    expect(postedTexts().map((post) => post.text)).toEqual(['first'])
    expect(hook.api.queue).toEqual(['first', 'second'])
    expect(composer.text).toBe('')
    const [message, details] = calls.error.mock.calls.at(-1) ?? []
    expect(message).toContain('HTTP 503')
    expect(message).toContain('still queued')
    // Its words are not in the composer, so the banner offers no Retry that would send the composer.
    expect(details).toBeUndefined()
    expect(logs.some((line) => line.includes('kept queued') && line.includes('HTTP 503'))).toBe(true)
    // No retry loop: renders alone post nothing more.
    render()
    await settle()
    render()
    await settle()
    expect(postedTexts()).toHaveLength(1)
    // The user's next send resumes it: the queue goes first, the new words wait behind it.
    io.post = async () => undefined
    expect(await send('third')).toBe('accepted')
    await settle()
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['first', 'first'])
    expect(hook.api.queue).toEqual(['second', 'third'])
  })

  it('posts the entries left behind as one post-later message, in order, when the chat closes', async () => {
    await queueWhileWorking('first', 'second')
    unmount()
    await settle()
    expect(postedTexts()).toEqual([{ sessionId: CSE_A, text: 'first\n\nsecond', priority: 'later' }])
  })
})
