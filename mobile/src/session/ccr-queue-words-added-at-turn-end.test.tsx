import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hook, composer, io, postedTexts, render, resetCcrComposerHarness, send, settle, state, unmount } from './ccr-composer-send.test-support'

/**
 * The turn-end send captured the queue, awaited the connection-status read, then emptied the
 * queue: words queued during that await were wiped without being sent (review of the send lane,
 * 2026-10-15). Only what was captured leaves the queue, and a queue goes out once.
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

describe('words queued while the turn-end send is checking the session', () => {
  it('keeps them queued while the turn-end status read is in flight', async () => {
    state.connectionStatus = null
    state.working = true
    render()
    await send('first')
    const reads: ((status: string) => void)[] = []
    io.readStatus = () => new Promise<string>((resolve) => reads.push(resolve))
    state.working = false
    render()
    await settle()
    // A new turn starts (the desktop sent one) and the user queues more behind it.
    state.working = true
    render()
    io.readStatus = async () => 'connected'
    await send('second')
    expect(hook.api.queue).toEqual(['first', 'second'])
    await act(async () => {
      reads[0]!('connected')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const everywhere = JSON.stringify(postedTexts()) + String(hook.api.queue) + composer.text
    expect(everywhere).toContain('second')
  })

  it('sends what was captured and keeps what was queued after it for the next turn end', async () => {
    state.connectionStatus = null
    state.working = true
    render()
    await send('first')
    const reads: ((status: string) => void)[] = []
    io.readStatus = () => new Promise<string>((resolve) => reads.push(resolve))
    state.working = false
    render()
    await settle()
    expect(reads).toHaveLength(1)
    // The send below goes behind the queue (it is being seen out) instead of ahead of it. The
    // delivery holds the flight from before its status read, so the send joins the queue at once,
    // with no read of its own (use-ccr-composer-send.ts, since 2026-10-15).
    io.readStatus = async () => 'connected'
    let outcome = ''
    await act(async () => {
      outcome = await hook.api.sendWithOutcome('second')
    })
    expect(outcome).toBe('accepted')
    expect(reads).toHaveLength(1)
    expect(hook.api.queue).toEqual(['first', 'second'])
    await act(async () => {
      reads[0]!('connected')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()
    // Since 2026-10-16 a queued message goes one turn each: the second waits for the turn the first
    // started to end.
    expect(postedTexts().map((post) => post.text)).toEqual(['first'])
    expect(hook.api.queue).toEqual(['second'])
    state.working = true
    render()
    await settle()
    state.working = false
    render()
    await settle()
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['first', 'second'])
    expect(hook.api.queue).toEqual([])
  })

  it('sends a queue once however many renders happen while its send is out', async () => {
    let release!: () => void
    io.post = () => new Promise<void>((resolve) => (release = resolve))
    state.working = true
    render()
    await send('only once')
    state.working = false
    render()
    await settle()
    render()
    render()
    await settle()
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    render()
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['only once'])
  })
})
