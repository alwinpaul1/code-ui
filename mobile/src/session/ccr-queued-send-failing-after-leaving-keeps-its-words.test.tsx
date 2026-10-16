import { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { io, postedTexts, render, resetCcrComposerHarness, restored, send, settle, state, unmount } from './ccr-composer-send.test-support'

/**
 * Second review of the queue-as-list change, 2026-10-16: a queued entry's turn-end POST failed
 * after the chat had closed (the user went to another tab, then left). The close had already
 * posted what was still queued, without the entry in flight, and the failure put the words back
 * into the queue of a hook that was gone: nowhere. Once the chat is gone, a queued message that
 * fails goes to its tab's STORED draft (the same writer the close uses), since a React draft
 * setter of an unmounted screen keeps nothing.
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

describe('a queued message whose send fails after the chat closed', () => {
  it("keeps its words in its tab's stored draft", async () => {
    state.working = true
    render()
    expect(await send('first')).toBe('accepted')
    let fail: (error: Error) => void = () => {}
    io.post = () => new Promise<void>((_resolve, reject) => { fail = reject })
    state.working = false
    render()
    await settle()
    await settle()
    expect(postedTexts().map((p) => p.text)).toEqual(['first'])
    // The user goes to tab B, then leaves the chat while the POST is still out.
    state.tabId = 'tab-b'
    render()
    unmount()
    await act(async () => { fail(new Error('HTTP 503')) })
    await settle()
    expect(restored).toEqual([{ draftKey: 'draft:tab-a', text: 'first' }])
  })
})
