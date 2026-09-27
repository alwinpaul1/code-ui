import { afterEach, describe, expect, it } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import {
  mobileNativeChatSendChipsRefusalMessage,
  settleMobileNativeChatSendChips
} from './use-mobile-native-chat-send-chips'

const SCOPE = 'h\0w\0tab'

function setExtracting(active: boolean): void {
  useNativeChatImageAttachmentsStore.getState().updateVideoFrameExtraction((prev) =>
    active ? { ...prev, [SCOPE]: { done: 1, total: 20 } } : (() => {
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
// slice too, the same way they already wait on an uploading chip.
describe('settleMobileNativeChatSendChips and a video still being read', () => {
  afterEach(() => {
    useNativeChatImageAttachmentsStore.getState().reset()
  })

  it('waits while a video is being read, with no chip yet to name', async () => {
    setExtracting(true)
    const settled = settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: [],
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
      deadline: Date.now() + 5000,
      abandoned: () => false
    })
    expect(result).toEqual([])
  })

  it('has its own one-line refusal message, distinct from "was still uploading"', () => {
    expect(mobileNativeChatSendChipsRefusalMessage({ reason: 'extracting', chip: null })).toBe(
      'Message not sent: a video is still being read'
    )
  })
})
