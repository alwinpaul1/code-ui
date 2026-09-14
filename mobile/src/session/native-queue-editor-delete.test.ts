import { expect, it, vi } from 'vitest'
import { finishNativeQueueEdit, type QueueScreen } from './native-queue-editor'

const screen = (draft = '', lines: string[] = []): QueueScreen => ({
  source: 'screen',
  draft,
  lines
})

// Deleting a queued message: the editor must confirm the entry actually left
// the agent's queue, and must not be fooled by a longer message that merely
// starts the same way. Split from native-queue-editor.test.ts for its line cap.

it('says so when a deleted message is still queued, instead of closing as if it worked', async () => {
  // 2026-09-14, reported from the phone: editing a queued message and then
  // deleting it left the message in the queue. Every other path confirms what
  // the agent actually did — typeAndSubmit checks the queue, submitInput checks
  // the draft — but the delete path returned the moment the composer was empty
  // and asserted nothing, so a recall that did not take the entry out of the
  // queue looked exactly like a successful delete.
  // The real shape: Orca republishes Claude's queue hint as the composer draft.
  const stillQueued = screen('Press up to edit queued messages', [
    '  ❯ original',
    '──────────',
    '❯',
    '──────────'
  ])
  const read = vi.fn().mockResolvedValueOnce(screen('original')).mockResolvedValue(stillQueued)
  await expect(
    finishNativeQueueEdit(
      { read, write: vi.fn().mockResolvedValue(undefined), pause: async () => {} },
      'claude',
      { text: 'original', draft: 'original', segments: null, index: 0 },
      null
    )
  ).rejects.toThrow(/still queued|could not be removed/i)
})

it('accepts a delete once the entry has left the queue', async () => {
  const read = vi.fn().mockResolvedValueOnce(screen('original')).mockResolvedValue(screen())
  await expect(
    finishNativeQueueEdit(
      { read, write: vi.fn().mockResolvedValue(undefined), pause: async () => {} },
      'claude',
      { text: 'original', draft: 'original', segments: null, index: 0 },
      null
    )
  ).resolves.toBeUndefined()
})

it('accepts a delete even while a longer message that starts the same way is queued', () => {
  // 2026-09-14 review: the confirmation matched both directions, so deleting
  // "ok do it" while "ok do it now" was queued reported a failure that had in
  // fact succeeded, leaving the sheet stuck on an already-cleared composer.
  const others = screen('Press up to edit queued messages', [
    '  ❯ ok do it now, carefully and slowly',
    '──────────',
    '❯',
    '──────────'
  ])
  const read = vi.fn().mockResolvedValueOnce(screen('ok do it')).mockResolvedValue(others)
  return expect(
    finishNativeQueueEdit(
      { read, write: vi.fn().mockResolvedValue(undefined), pause: async () => {} },
      'claude',
      { text: 'ok do it', draft: 'ok do it', segments: null, index: 0 },
      null
    )
  ).resolves.toBeUndefined()
})
