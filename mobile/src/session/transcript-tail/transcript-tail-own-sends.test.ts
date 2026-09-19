import { describe, expect, it } from 'vitest'
import { pendingTextsStillDrawn, pendingWithoutTranscriptTwins } from './transcript-tail-own-sends'

describe('a phone send the transcript has a record of', () => {
  // Device, 2026-09-19: "did you check the hold and copy scrolling issue on
  // phone" drew three turns under the reply that answered it. The phone's
  // echo guessed its place; the transcript's queued_command record knows it.
  it('steps aside for the record, so the record places the bubble', () => {
    const pending = [
      { id: 'pending-1', text: 'did you check the hold and copy scrolling issue on phone' },
      { id: 'pending-2', text: 'unrelated, still only ours' }
    ]
    const prompts = [
      {
        nonce: 'uuid-1',
        text: 'did you check the hold and copy scrolling issue on phone',
        anchorId: 'row',
        at: 1_000
      },
      { nonce: 'pid-9', text: 'unrelated, still only ours' } // a beacon, not the transcript
    ]
    expect(pendingWithoutTranscriptTwins(pending, prompts).map((p) => p.id)).toEqual(['pending-2'])
    // …and no longer hides the twin that replaced it.
    expect(pendingTextsStillDrawn(pending, prompts)).toEqual(['unrelated, still only ours'])
  })

  it('keeps an echo that carries photos: the record has no bytes for them', () => {
    const pending = [{ id: 'pending-1', text: 'look at this', images: ['file:///a.jpg'] }]
    const prompts = [{ nonce: 'uuid-1', text: 'look at this', at: 1 }]
    expect(pendingWithoutTranscriptTwins(pending, prompts)).toHaveLength(1)
  })

  it('matches on the normalised text, markers and all', () => {
    const pending = [{ id: 'pending-1', text: '[Image #4] Also see a message' }]
    const prompts = [{ nonce: 'uuid-1', text: '[Image #4]  Also see a message', at: 1 }]
    expect(pendingWithoutTranscriptTwins(pending, prompts)).toHaveLength(0)
  })

  it('changes nothing while the transcript has no records', () => {
    const pending = [{ id: 'pending-1', text: 'x' }]
    expect(pendingWithoutTranscriptTwins(pending, [])).toEqual(pending)
    expect(pendingWithoutTranscriptTwins([], [])).toEqual([])
  })
})
