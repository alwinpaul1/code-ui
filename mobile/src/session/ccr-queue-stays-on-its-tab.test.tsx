import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hook, composer, CSE_A, CSE_B, logs, postedTexts, render, resetCcrComposerHarness, send, settle, state, targetOf, unmount } from './ccr-composer-send.test-support'

/**
 * The chat controller lives per worktree route and survives tab switches, so its one
 * useCcrComposerSend sees tab A's state, then tab B's. A message queued on tab A while Claude
 * worked there was posted into tab B's session the moment the user opened an idle tab B: the
 * switch read as A's turn ending (review of the send lane, 2026-10-15). A queue belongs to its tab
 * and to the session it was queued for.
 */

beforeEach(resetCcrComposerHarness)
afterEach(unmount)

async function queueOnWorkingTabA(text: string): Promise<void> {
  state.tabId = 'tab-a'
  state.working = true
  render()
  expect(await send(text)).toBe('accepted')
}

async function switchTo(tabId: string, working: boolean): Promise<void> {
  state.tabId = tabId
  state.working = working
  render()
  await settle()
}

describe("a message queued on one Claude tab", () => {
  it("is not posted into another tab's session when the user switches to an idle Claude tab", async () => {
    await queueOnWorkingTabA('only for tab A')
    await switchTo('tab-b', false)
    expect(postedTexts()).toEqual([])
  })

  it('is drawn only on the tab it was queued on', async () => {
    await queueOnWorkingTabA('only for tab A')
    expect(hook.api.queue).toEqual(['only for tab A'])
    await switchTo('tab-b', false)
    expect(hook.api.queue).toEqual([])
    await switchTo('tab-a', true)
    expect(hook.api.queue).toEqual(['only for tab A'])
  })

  it("is sent into its own tab's session when the user is back on that tab and its turn has ended", async () => {
    await queueOnWorkingTabA('only for tab A')
    await switchTo('tab-b', false)
    await switchTo('tab-a', false)
    expect(postedTexts()).toEqual([{ sessionId: CSE_A, text: 'only for tab A', priority: undefined }])
    expect(hook.api.queue).toEqual([])
  })

  it("does not join a message sent on the other tab, which goes to that tab's session at once", async () => {
    await queueOnWorkingTabA('only for tab A')
    await switchTo('tab-b', false)
    expect(await send('for tab B')).toBe('accepted')
    expect(postedTexts()).toEqual([{ sessionId: CSE_B, text: 'for tab B', priority: undefined }])
  })

  it('goes back to the composer, not into the new session, when its tab sends to another session by the turn end', async () => {
    await queueOnWorkingTabA('meant for the first session')
    state.targets['tab-a'] = targetOf(CSE_B)
    state.working = false
    render()
    await settle()
    expect(postedTexts()).toEqual([])
    expect(composer.text).toBe('meant for the first session')
    expect(logs.some((line) => line.includes('queued message moved back to the composer'))).toBe(true)
  })
})
