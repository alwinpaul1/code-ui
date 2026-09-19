import { describe, expect, it } from 'vitest'
import { mergeDesktopPrompts, mergeQueuedMessages } from './transcript-tail-merge'

describe('prompts from the transcript and the beacon', () => {
  it('shows a prompt the transcript carries once, even when the beacon carries it too', () => {
    const merged = mergeDesktopPrompts(
      [{ nonce: 'uuid-1', text: 'ship it', anchorId: 'row-9', at: 1 }],
      [{ nonce: 'pid-4', text: 'ship it' }]
    )
    expect(merged).toEqual([{ nonce: 'uuid-1', text: 'ship it', anchorId: 'row-9', at: 1 }])
  })

  it('keeps a beacon prompt the transcript has not shown', () => {
    const merged = mergeDesktopPrompts(
      [{ nonce: 'uuid-1', text: 'one', anchorId: null, at: null }],
      [{ nonce: 'pid-4', text: 'two', anchorId: 'row-2' }]
    )
    expect(merged).toEqual([
      { nonce: 'uuid-1', text: 'one' },
      { nonce: 'pid-4', text: 'two', anchorId: 'row-2' }
    ])
  })

  it('is empty when both are', () => {
    expect(mergeDesktopPrompts([], [])).toEqual([])
  })
})

describe('the queue from the transcript and the screen', () => {
  it('keeps the screen row Claude drew, so a tap on it still opens the editor', () => {
    // Review 2026-09-19: the editor checks the tapped text against the drawn
    // row, and the transcript's full text never equals a row with a `…`.
    const sent = 'please run the whole suite again and report every failure with its file'
    const drawn = 'please run the whole suite again and report every…'
    expect(mergeQueuedMessages([drawn], [sent])).toEqual([drawn])
  })

  it('appends an entry the screen has not drawn, after the drawn ones', () => {
    expect(mergeQueuedMessages(['drawn first'], ['drawn first', 'not yet painted'])).toEqual([
      'drawn first',
      'not yet painted'
    ])
  })

  it('is the screen alone before the tail is up, and the tail alone when the screen shows none', () => {
    expect(mergeQueuedMessages(['drawn'], [])).toEqual(['drawn'])
    expect(mergeQueuedMessages(undefined, ['from the transcript'])).toEqual(['from the transcript'])
    expect(mergeQueuedMessages(undefined, [])).toEqual([])
  })
})
