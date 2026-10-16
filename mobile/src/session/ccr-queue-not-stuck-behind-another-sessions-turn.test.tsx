import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CCR_QUEUE_TURN_UNSEEN_MS, ccrQueuedTurnEnded } from './use-ccr-queue-delivery'
import { composer, hook, logs, postedTexts, render, resetCcrComposerHarness, send, settle, state, targetOf, unmount } from './ccr-composer-send.test-support'
/**
 * Second review of the queue-as-list change, 2026-10-16: the wait for a queued message's turn was
 * kept per tab only. When the tab was matched to another session after the first entry went out,
 * the phone waited for that entry's turn in the NEW session, where it never comes, and the tab
 * being idle, every later send queued behind it for good. The wait belongs to the session the
 * entry went to, and it can never block for ever (CCR_QUEUE_TURN_UNSEEN_MS).
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

describe('a queue on a tab whose session changed', () => {
  it('a message queued for the session a tab now sends to is not stuck behind a turn of the session it used to send to', async () => {
    await queueWhileWorking('first', 'second')
    state.working = false
    render()
    await settle()
    await settle()
    expect(postedTexts().map((p) => p.text)).toEqual(['first'])
    // Before the phone sees 'first''s turn, the tab's chat is matched to another session (idle).
    state.targets['tab-a'] = targetOf('cse_01NewSessionForTabAAAAA')
    state.events = []
    render()
    await settle()
    composer.text = ''
    expect(await send('hello')).toBe('accepted')
    for (let i = 0; i < 4; i++) { render(); await settle() }
    // Either posted to the new session or handed back to the composer: never left queued on an idle tab.
    expect(hook.api.queue).toEqual([])
    expect(logs.some((line) => line.includes('stopped waiting'))).toBe(true)
  })
})

describe('the wait for a queued message\'s turn never blocks for good', () => {
  const turn = { uuid: 'uuid-1', sessionId: 'cse_A', sentAt: 1_000, sawWorking: false }
  it('waits while the turn is not seen and the bound is not up', () => {
    expect(ccrQueuedTurnEnded(turn, false, [], 'cse_A', 1_000 + CCR_QUEUE_TURN_UNSEEN_MS - 1)).toBe('wait')
  })
  it('stops waiting once the bound is up with the tab idle and the turn never seen', () => {
    expect(ccrQueuedTurnEnded(turn, false, [], 'cse_A', 1_000 + CCR_QUEUE_TURN_UNSEEN_MS)).toBe('unseen')
  })
  it('keeps waiting past the bound while the tab is working', () => {
    expect(ccrQueuedTurnEnded(turn, true, [], 'cse_A', 1_000 + CCR_QUEUE_TURN_UNSEEN_MS * 5)).toBe('wait')
  })
  it('stops waiting at once when the tab sends to another session', () => {
    expect(ccrQueuedTurnEnded(turn, true, [], 'cse_B', 1_000)).toBe('other-session')
  })
})
