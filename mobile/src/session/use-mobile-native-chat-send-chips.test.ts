import { afterEach, describe, expect, it } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import {
  mobileNativeChatSendChipsRefusalMessage,
  settleMobileNativeChatSendChips
} from './use-mobile-native-chat-send-chips'

const SCOPE = 'h\0w\0tab'
const BATCH = 'batch-1'

function setExtracting(active: boolean, total: number | null = 20): void {
  useNativeChatImageAttachmentsStore.getState().updateVideoFrameExtraction((prev) =>
    active ? { ...prev, [SCOPE]: { batch: BATCH, done: 1, total } } : (() => {
      const next = { ...prev }
      delete next[SCOPE]
      return next
    })()
  )
}

// 2026-09-27 review: a video's frames are read one at a time, ahead of any
// chip — `chips.some((chip) => chip.uploading)` sees nothing to wait for
// while that runs, so a send tapped mid-extraction used to go out with none
// of the frames at all. `settleMobileNativeChatSendChips` (and the fast-path
// check in `useMobileNativeChatSendChips`) now wait on the extraction store
// slice too, the same way they already wait on an uploading chip — but only
// when the tap's own `readingBatch` names that same extraction; a send with
// nothing to do with it (`readingBatch: null`) must never wait on it.
describe('settleMobileNativeChatSendChips and a video still being read', () => {
  afterEach(() => {
    useNativeChatImageAttachmentsStore.getState().reset()
  })

  it('waits while a video is being read, with no chip yet to name', async () => {
    setExtracting(true)
    const settled = settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: [],
      readingBatch: BATCH,
      deadline: Date.now() + 5000,
      abandoned: () => false
    })
    let resolved = false
    void settled.then(() => {
      resolved = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)

    setExtracting(false)
    const result = await settled
    expect(Array.isArray(result)).toBe(true)
  })

  it('refuses with reason "extracting", naming no chip, once the deadline passes', async () => {
    setExtracting(true)
    const result = await settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: [],
      readingBatch: BATCH,
      deadline: Date.now() - 1,
      abandoned: () => false
    })
    expect(result).toEqual({ reason: 'extracting', chip: null })
  })

  it('gives up as abandoned before ever checking extraction, when the session already has', async () => {
    setExtracting(true)
    const result = await settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: [],
      readingBatch: BATCH,
      deadline: Date.now() + 5000,
      abandoned: () => true
    })
    expect(result).toEqual({ reason: 'session', chip: null })
  })

  it('falls through to the ordinary chip check once extraction has cleared', async () => {
    setExtracting(false)
    const result = await settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: [],
      readingBatch: BATCH,
      deadline: Date.now() + 5000,
      abandoned: () => false
    })
    expect(result).toEqual([])
  })

  // 2026-09-27 review: this send's own tap-time chips had nothing to do with
  // whatever is reading — a video attached moments later, say — so it must
  // not wait on it, even while it is genuinely active.
  it('does not wait on an extraction the tap had nothing to do with', async () => {
    setExtracting(true)
    const result = await settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: [],
      readingBatch: null,
      deadline: Date.now() - 1,
      abandoned: () => false
    })
    expect(result).toEqual([])
  })

  // 2026-09-27 review: this was the actual reported bug — a send tapped
  // beside frame img-1 waited correctly, but img-2 and img-3, which landed
  // DURING the wait, still had ids the tap never knew, and used to be
  // dropped from the gathered result outright.
  it('gathers every frame the reading batch produces, not just the ids the tap already knew', async () => {
    setExtracting(true)
    useNativeChatImageAttachmentsStore.getState().update(() => ({
      [SCOPE]: [{ id: 'img-1', path: '/tmp/f1.png', previewUri: 'p1', batch: BATCH }]
    }))
    const settled = settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: ['img-1'],
      readingBatch: BATCH,
      deadline: Date.now() + 5000,
      abandoned: () => false
    })

    // Two more frames of the SAME batch land while the send waits.
    await Promise.resolve()
    useNativeChatImageAttachmentsStore.getState().update((prev) => ({
      ...prev,
      [SCOPE]: [
        ...(prev[SCOPE] ?? []),
        { id: 'img-2', path: '/tmp/f2.png', previewUri: 'p2', batch: BATCH },
        { id: 'img-3', path: '/tmp/f3.png', previewUri: 'p3', batch: BATCH }
      ]
    }))
    setExtracting(false)

    const result = await settled
    expect(Array.isArray(result)).toBe(true)
    expect((result as { id: string }[]).map((chip) => chip.id)).toEqual(['img-1', 'img-2', 'img-3'])
  })

  it('has its own one-line refusal message, distinct from "was still uploading"', () => {
    expect(mobileNativeChatSendChipsRefusalMessage({ reason: 'extracting', chip: null })).toBe(
      'Message not sent: a video is still being read'
    )
  })
})
