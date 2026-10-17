import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CCR_REMOTE_CONTROL_OFFLINE } from './ccr-send'
import { calls, composer, hook, io, posts, postedTexts, render, resetCcrComposerHarness, send, state, unmount } from './ccr-composer-send.test-support'

/**
 * A message sent from the composer of a Claude-app chat (the Anthropic lane) sat in the box, with
 * no bubble and no queued card, until the session's connection status came back: when the stream
 * had not yet delivered a `connection` frame, the send read the row from Anthropic first
 * (ccr-send-order.ts `ccrTargetOffline`) and only then emptied the box. The Claude app draws its
 * `pending_message` row in the frame of the tap and judges offline from state it already holds
 * (docs/claude-app-parity-gaps.md §1.1), so the phone's message "takes time to appear" there and
 * not in the app (reported 2026-10-17).
 *
 * The status read still runs before anything is posted, and an offline answer still refuses: the
 * bubble (or the queued card) comes down and the words go back, once.
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

/** A status read that answers only when the test says. */
function holdStatusRead(): { answer: (status: string) => Promise<void> } {
  const reads: ((status: string) => void)[] = []
  io.readStatus = () => new Promise<string>((resolve) => reads.push(resolve))
  return {
    answer: async (status) => {
      await act(async () => {
        for (const read of reads.splice(0)) {
          read(status)
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
}

async function tap(text: string): Promise<{ outcome: () => string | null }> {
  let result: string | null = null
  await act(async () => {
    void hook.api.sendWithOutcome(text).then((outcome) => (result = outcome))
    await Promise.resolve()
  })
  return { outcome: () => result }
}

describe('a message sent on a Claude-app chat before the stream has said whether its computer is online', () => {
  beforeEach(() => {
    state.connectionStatus = null
    render()
  })

  it('shows the message at the tap on a Claude-app chat before the status read answers (idle)', async () => {
    const read = holdStatusRead()
    const sent = await tap('run the tests')
    // The read is still out: the box is empty and the bubble is up, dimmed, with nothing posted.
    expect(calls.clear).toHaveBeenCalledTimes(1)
    expect(calls.accept).toHaveBeenCalledTimes(1)
    expect(hook.api.deliveries['row-1']).toBe('sending')
    expect(posts).toEqual([])
    await read.answer('connected')
    expect(postedTexts().map((post) => post.text)).toEqual(['run the tests'])
    expect(sent.outcome()).toBe('accepted')
    expect(calls.error).not.toHaveBeenCalled()
  })

  it('shows the message at the tap on a Claude-app chat before the status read answers (Claude working)', async () => {
    state.working = true
    render()
    const read = holdStatusRead()
    const sent = await tap('and then the lint')
    expect(calls.clear).toHaveBeenCalledTimes(1)
    expect(hook.api.queue).toEqual(['and then the lint'])
    await read.answer('connected')
    expect(hook.api.queue).toEqual(['and then the lint'])
    expect(sent.outcome()).toBe('accepted')
    expect(posts).toEqual([])
    expect(calls.error).not.toHaveBeenCalled()
  })

  it('takes the bubble down and gives the words back once when the status read then says the computer is offline', async () => {
    const read = holdStatusRead()
    const sent = await tap('run the tests')
    expect(calls.accept).toHaveBeenCalledTimes(1)
    await read.answer('disconnected')
    expect(sent.outcome()).toBe('rejected')
    expect(posts).toEqual([])
    expect(calls.remove).toHaveBeenCalledTimes(1)
    expect(calls.remove).toHaveBeenCalledWith('row-1')
    expect(calls.restore).toHaveBeenCalledTimes(1)
    expect(calls.restore.mock.calls[0]?.[1]).toBe('run the tests')
    expect(hook.api.deliveries['row-1']).toBeUndefined()
    expect(calls.error).toHaveBeenCalledTimes(1)
    expect(calls.error).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
  })

  it('takes the queued card down and gives the words back once when the status read then says the computer is offline', async () => {
    state.working = true
    render()
    const read = holdStatusRead()
    const sent = await tap('and then the lint')
    expect(hook.api.queue).toEqual(['and then the lint'])
    await read.answer('disconnected')
    expect(sent.outcome()).toBe('rejected')
    expect(hook.api.queue).toEqual([])
    expect(composer.text).toBe('and then the lint')
    expect(posts).toEqual([])
    expect(calls.error).toHaveBeenCalledTimes(1)
    expect(calls.error).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
  })

  it('keeps the words typed earlier ahead when two queued sends both hear the computer is offline', async () => {
    state.working = true
    render()
    const read = holdStatusRead()
    const first = await tap('first')
    const second = await tap('second')
    expect(hook.api.queue).toEqual(['first', 'second'])
    await read.answer('disconnected')
    expect(hook.api.queue).toEqual([])
    expect(composer.text).toBe('first\n\nsecond')
    expect(first.outcome()).toBe('rejected')
    expect(second.outcome()).toBe('rejected')
    expect(calls.error).toHaveBeenCalledTimes(1)
  })
})

describe('a message sent on a Claude-app chat whose stream already says the computer is offline', () => {
  it('is refused at the tap with its words left in the composer and no bubble drawn', async () => {
    state.connectionStatus = 'disconnected'
    render()
    expect(await send('run the tests')).toBe('rejected')
    expect(calls.clear).not.toHaveBeenCalled()
    expect(calls.accept).not.toHaveBeenCalled()
    expect(calls.error).toHaveBeenCalledWith(CCR_REMOTE_CONTROL_OFFLINE)
  })
})
