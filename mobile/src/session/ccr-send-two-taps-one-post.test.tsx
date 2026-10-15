import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calls, io, postedTexts, render, resetCcrComposerHarness, state, unmount, hook } from './ccr-composer-send.test-support'
import { CCR_SEND_IN_FLIGHT } from './use-ccr-composer-send'

/**
 * Two sends tapped while the first was still reading the session's connection status both passed
 * the in-flight check, which ran before that read: both were posted. The guard is taken before
 * the read now, so the second is refused with the in-flight words.
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

describe('two sends tapped together', () => {
  it('posts the first and refuses the second while the first reads the connection status', async () => {
    state.connectionStatus = null
    render()
    const reads: ((status: string) => void)[] = []
    io.readStatus = () => new Promise<string>((resolve) => reads.push(resolve))
    let first: Promise<string> | null = null
    let second: Promise<string> | null = null
    await act(async () => {
      first = hook.api.sendWithOutcome('one')
      second = hook.api.sendWithOutcome('two')
      await Promise.resolve()
    })
    await act(async () => {
      for (const read of reads) {
        read('connected')
      }
      await first
      await second
    })
    expect(postedTexts().map((post) => post.text)).toEqual(['one'])
    expect(await second).toBe('rejected')
    expect(calls.error).toHaveBeenCalledWith(CCR_SEND_IN_FLIGHT)
  })

  it('lets the next send through once the first has finished', async () => {
    state.connectionStatus = null
    render()
    await act(async () => {
      await hook.api.sendWithOutcome('one')
    })
    await act(async () => {
      await hook.api.sendWithOutcome('two')
    })
    expect(postedTexts().map((post) => post.text)).toEqual(['one', 'two'])
  })
})
