/**
 * Fourth review, 2026-10-17: a skip added so a stored give-back re-applied to a draft that already
 * holds it does not put the queue in twice also ran on every LIVE give-back (use-ccr-tab-queues.ts,
 * ccr-send-order.ts, returnQueueToDraft). A queued message whose words equal the draft, or begin
 * it before a blank line, was dropped. The skip belongs only to re-applying a stored record.
 */
import { describe, expect, it } from 'vitest'
import { reapplyCcrQueueToComposer, returnCcrQueueToComposer } from './ccr-local-queue'

describe('a queued message given back to the composer', () => {
  it('still comes back when it is identical to the draft', () => {
    expect(returnCcrQueueToComposer('run the tests', 'run the tests')).toBe('run the tests\n\nrun the tests')
  })

  it('still comes back when the draft begins with it before a blank line', () => {
    expect(returnCcrQueueToComposer('run the tests', 'run the tests\n\nthen deploy')).toBe('run the tests\n\nrun the tests\n\nthen deploy')
  })

  it('goes in once when a stored give-back is re-applied to a draft that already holds it', () => {
    const once = returnCcrQueueToComposer('queued words', 'note')
    expect(reapplyCcrQueueToComposer('queued words', once)).toBe(once)
    expect(reapplyCcrQueueToComposer('queued words', 'note')).toBe(once)
  })
})
