import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hook, composer, CSE_A, io, postedTexts, render, resetCcrComposerHarness, send, settle, state, unmount } from './ccr-composer-send.test-support'

/**
 * A queue was stranded when Claude's turn ended while the Anthropic lane was off (the terminal
 * view shown, the match re-settling): the turn-end edge was consumed before the lane check, so
 * when the lane came back nothing sent the queue (review of the send lane, 2026-10-15).
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

async function queueThenEndTurnWithLaneOff(text: string): Promise<void> {
  state.working = true
  render()
  expect(await send(text)).toBe('accepted')
  state.active = false
  render()
  state.working = false
  render()
  await settle()
}

describe('a turn that ended while the chat lane was off', () => {
  it('sends the queue once the lane is back', async () => {
    await queueThenEndTurnWithLaneOff('waiting')
    expect(postedTexts()).toEqual([])
    state.active = true
    render()
    await settle()
    expect(postedTexts()).toEqual([{ sessionId: CSE_A, text: 'waiting', priority: undefined }])
    expect(hook.api.queue).toBeNull()
  })

  it('moves the queue back to the composer when the lane is back with a prompt waiting', async () => {
    await queueThenEndTurnWithLaneOff('waiting')
    state.active = true
    state.promptUp = true
    render()
    await settle()
    expect(postedTexts()).toEqual([])
    expect(composer.text).toBe('waiting')
  })

  it('keeps the queue ahead of a message sent while the lane is coming back', async () => {
    await queueThenEndTurnWithLaneOff('first')
    // The stream has not said whether the computer is online, so each send reads the row: the
    // queue's read is held open while the user sends again.
    state.connectionStatus = null
    const reads: ((status: string) => void)[] = []
    io.readStatus = () => new Promise<string>((resolve) => reads.push(resolve))
    state.active = true
    render()
    await settle()
    expect(reads).toHaveLength(1)
    let outcome: Promise<string> | null = null
    await act(async () => {
      outcome = hook.api.sendWithOutcome('second')
      await Promise.resolve()
    })
    expect(reads).toHaveLength(2)
    io.readStatus = async () => 'connected'
    await act(async () => {
      reads[1]!('connected')
      await outcome
    })
    await act(async () => {
      reads[0]!('connected')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()
    expect(postedTexts().map((post) => post.text)).toEqual(['first', 'second'])
  })
})
