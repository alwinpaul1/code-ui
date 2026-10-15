import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CSE_A, CSE_B, io, logs, postedTexts, render, resetCcrComposerHarness, restored, send, settle, state, targetOf, unmount } from './ccr-composer-send.test-support'

/**
 * A message queued while Claude worked was dropped without a word when the chat controller
 * unmounted after the Anthropic lane had gone off (the terminal view toggled, a Codex tab shown):
 * the unmount only posted a queue while the lane was on (review of the send lane, 2026-10-15).
 * Leaving now posts each held queue as `priority: "later"` into the session it was queued for,
 * when its tab still sends there, and otherwise puts it back in that tab's composer draft.
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

async function queueOn(tabId: string, text: string): Promise<void> {
  state.tabId = tabId
  state.working = true
  render()
  expect(await send(text)).toBe('accepted')
}

describe('a queued message when the chat goes away', () => {
  it('is posted as post-later into its session even after the chat lane went off', async () => {
    await queueOn('tab-a', 'do not lose me')
    state.active = false
    render()
    unmount()
    await settle()
    expect(postedTexts()).toEqual([{ sessionId: CSE_A, text: 'do not lose me', priority: 'later' }])
  })

  it("posts another tab's queue into that tab's own session", async () => {
    await queueOn('tab-a', 'for A')
    state.tabId = 'tab-b'
    state.working = true
    render()
    unmount()
    await settle()
    expect(postedTexts()).toEqual([{ sessionId: CSE_A, text: 'for A', priority: 'later' }])
  })

  it("goes back to its tab's composer draft, with a log line, when its tab no longer resolves to that session", async () => {
    await queueOn('tab-a', 'keep me')
    state.targets['tab-a'] = targetOf(CSE_B)
    unmount()
    await settle()
    expect(postedTexts()).toEqual([])
    expect(restored).toEqual([{ draftKey: 'draft:tab-a', text: 'keep me' }])
    expect(logs.some((line) => line.startsWith('[ccr-send] queued message') && line.includes('composer draft'))).toBe(true)
  })

  it("goes back to its tab's composer draft when the post-later POST fails", async () => {
    await queueOn('tab-a', 'keep me too')
    io.post = async () => {
      throw new Error('network down')
    }
    unmount()
    await settle()
    expect(restored).toEqual([{ draftKey: 'draft:tab-a', text: 'keep me too' }])
    expect(logs.some((line) => line.includes('network down'))).toBe(true)
  })

  it('posts nothing and restores nothing with no queue held', async () => {
    unmount()
    await settle()
    expect(postedTexts()).toEqual([])
    expect(restored).toEqual([])
  })
})
