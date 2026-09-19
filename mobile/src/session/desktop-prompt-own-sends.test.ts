import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  pendingTextsStillDrawn,
  pendingWithoutTranscriptTwins,
  textsAlreadyShown
} from './desktop-prompt-own-sends'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'

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

// 2026-09-19, phone screenshot: "Ask jev to confirm these fixes and bugs…"
// drawn as a bubble AND listed in the queue box below it for the 19 s the
// agent took to absorb it (transcript: enqueue 22:38:47, absorbed 22:39:06).
// The own bubble had stepped aside for the hook's timed copy, and that copy
// knew nothing of the queue box.
describe('a send still in the agent queue box', () => {
  const typed =
    'Ask jev to confirm these fixes and bugs if no dig deeper and find the bugs and confirm it and then fix and bump the version to 0.9.4'
  // As the box paints it at the phone's width, joined by the parser.
  const painted = [
    'Ask jev to confirm these fixes and',
    'bugs if no dig deeper and find the',
    'bugs and confirm it and then fix and',
    'bump the version to 0.9.4'
  ].join('\n')
  const hook = [{ nonce: 'status:s:1789857527552:0', text: typed, at: 1789857527552 }]

  it('is not drawn as a desktop-prompt bubble while the queue box shows it', () => {
    const shown = textsAlreadyShown([{ text: typed }], hook, [painted])
    expect(withoutLandedDesktopPrompts(hook, [], shown)).toEqual([])
  })

  // The defect was one of STRUCTURE: the overlay excluded only the pending
  // texts, so the pure filter was right and never told the queue. Pin the
  // call site, on code not commentary.
  it('is what the overlay excludes, queue rows included', () => {
    const source = readFileSync(new URL('./MobileNativeChatOverlay.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(
      /withoutLandedDesktopPrompts\(\s*desktopPrompts,\s*baseFolded,\s*textsAlreadyShown\(controller\.chatPending, desktopPrompts, queuedMessages \?\? \[\]\)/
    )
  })

  it('is drawn once the row leaves the box (the own bubble has stepped aside for it)', () => {
    expect(pendingWithoutTranscriptTwins([{ text: typed }], hook)).toEqual([])
    const shown = textsAlreadyShown([{ text: typed }], hook, [])
    expect(withoutLandedDesktopPrompts(hook, [], shown)).toHaveLength(1)
  })
})
