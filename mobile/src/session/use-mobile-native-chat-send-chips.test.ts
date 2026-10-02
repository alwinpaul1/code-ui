import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import {
  mobileNativeChatSendChipsRefusalMessage,
  settleMobileNativeChatSendChips,
  useMobileNativeChatSendChips,
  type MobileNativeChatSendChipsTap
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
// for a batch in `tapBatches`, checked fresh every loop (not just once at
// the top): a send with none of its own tap-time chips in that batch
// (`tapBatches` empty of it) must never wait on it, but one that DOES must
// keep waiting even if that batch's extraction only starts after the tap.
describe('settleMobileNativeChatSendChips and a video still being read', () => {
  afterEach(() => {
    useNativeChatImageAttachmentsStore.getState().reset()
  })

  it('waits while a video is being read, with no chip yet to name', async () => {
    setExtracting(true)
    const settled = settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: [],
      tapBatches: new Set([BATCH]),
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
      tapBatches: new Set([BATCH]),
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
      tapBatches: new Set([BATCH]),
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
      tapBatches: new Set([BATCH]),
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
      tapBatches: new Set(),
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
      tapBatches: new Set([BATCH]),
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

  // P10 (2026-09-27 review, item 3): a [PDF, video] pick's PDF is already
  // uploading at tap time — the video hasn't even started reading yet, so
  // there is no active extraction to derive a watched batch from at that
  // instant. The PDF's OWN `.batch` (shared with the whole pick) is what
  // must keep this send watching, so that when the video's read starts a
  // moment later, still the same batch, this wait picks it up rather than
  // sending the PDF alone the instant it finishes uploading.
  it('picks up a video that starts reading mid-wait, from the same batch as an already-uploading PDF', async () => {
    useNativeChatImageAttachmentsStore.getState().update(() => ({
      [SCOPE]: [{ id: 'doc-1', path: '/tmp/a.pdf', previewUri: 'file:///a.pdf', kind: 'file', batch: BATCH, uploading: true }]
    }))
    const settled = settleMobileNativeChatSendChips({
      scope: SCOPE,
      ids: ['doc-1'],
      tapBatches: new Set([BATCH]),
      deadline: Date.now() + 5000,
      abandoned: () => false
    })
    let resolved = false
    void settled.then(() => {
      resolved = true
    })

    // The PDF's upload lands, but the video (same batch) starts reading
    // before the settled chips are gathered — the wait must not send the
    // PDF alone here.
    await Promise.resolve()
    useNativeChatImageAttachmentsStore.getState().update(() => ({
      [SCOPE]: [{ id: 'doc-1', path: '/tmp/a.pdf', previewUri: 'file:///a.pdf', kind: 'file', batch: BATCH }]
    }))
    setExtracting(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)

    useNativeChatImageAttachmentsStore.getState().update((prev) => ({
      ...prev,
      [SCOPE]: [...(prev[SCOPE] ?? []), { id: 'img-1', path: '/tmp/f1.png', previewUri: 'p1', batch: BATCH }]
    }))
    setExtracting(false)

    const result = await settled
    expect(Array.isArray(result)).toBe(true)
    expect((result as { id: string }[]).map((chip) => chip.id)).toEqual(['doc-1', 'img-1'])
  })

  it('has its own one-line refusal message, distinct from "was still uploading"', () => {
    expect(mobileNativeChatSendChipsRefusalMessage({ reason: 'extracting', chip: null })).toBe(
      'Message not sent: a video is still being read'
    )
  })
})

// P9 (2026-09-27 review, item 4): the join used to compare only the ORIGINAL
// tap's exact chip ids, so a video's later frames — landing between the
// first tap and a same-text second one — made the second tap's chips fail
// `chips.every(id in waiting.ids)`, refusing it as "busy" instead of joining
// the wait already in flight.
describe('useMobileNativeChatSendChips — joining a wait for a video still being read', () => {
  let renderer: ReactTestRenderer | null = null
  let bound: ((tap: MobileNativeChatSendChipsTap, send: (chips: PendingNativeChatImage[]) => Promise<boolean>) => Promise<boolean>) | null = null

  function Harness({ scopeKey, onSendError }: { scopeKey: string; onSendError: (message: string) => void }): null {
    bound = useMobileNativeChatSendChips({
      scopeKey,
      client: { getState: () => 'connected' as const },
      sendGate: { now: () => null },
      onSendError
    })
    return null
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    bound = null
    useNativeChatImageAttachmentsStore.getState().reset()
  })

  it('joins a second tap with the same text instead of refusing it "busy", once a video frame has landed since the first tap', async () => {
    const onSendError = vi.fn()
    act(() => {
      renderer = create(createElement(Harness, { scopeKey: SCOPE, onSendError }))
    })
    useNativeChatImageAttachmentsStore.getState().update(() => ({
      [SCOPE]: [{ id: 'img-1', path: '/tmp/f1.png', previewUri: 'p1', batch: BATCH, uploading: true }]
    }))
    setExtracting(true)

    const send = vi.fn().mockResolvedValue(true)
    const deadline = Date.now() + 5000
    let first: Promise<boolean> = Promise.resolve(false)
    act(() => {
      first = bound!({ scope: SCOPE, deadline, text: 'look at these' }, send)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // A second frame of the SAME batch lands before the second tap — the
    // second tap's chips now include an id the first tap never knew.
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update((prev) => ({
        ...prev,
        [SCOPE]: [...(prev[SCOPE] ?? []), { id: 'img-2', path: '/tmp/f2.png', previewUri: 'p2', batch: BATCH }]
      }))
    })

    let second: Promise<boolean> = Promise.resolve(false)
    act(() => {
      second = bound!({ scope: SCOPE, deadline, text: 'look at these' }, send)
    })

    act(() => {
      useNativeChatImageAttachmentsStore.getState().update((prev) => ({
        ...prev,
        [SCOPE]: (prev[SCOPE] ?? []).map((chip) => (chip.id === 'img-1' ? { ...chip, uploading: false } : chip))
      }))
      setExtracting(false)
    })

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledOnce()
  })

  // P10 (2026-09-27 review, item 3): at the tap, the PDF from a [PDF, video]
  // pick is already uploading, but the video (same pick, same batch) has not
  // started reading yet — there is no active extraction for the OUTER gate
  // to derive a watched batch from. The PDF's own `.batch` must still be
  // enough to keep this send watching that batch once the video does start.
  it('sends the video\'s frames too, not just the PDF, when the video only starts reading after the tap', async () => {
    const onSendError = vi.fn()
    act(() => {
      renderer = create(createElement(Harness, { scopeKey: SCOPE, onSendError }))
    })
    useNativeChatImageAttachmentsStore.getState().update(() => ({
      [SCOPE]: [
        { id: 'doc-1', path: '/tmp/a.pdf', previewUri: 'file:///a.pdf', kind: 'file', batch: BATCH, uploading: true }
      ]
    }))

    const send = vi.fn().mockResolvedValue(true)
    const deadline = Date.now() + 5000
    let tapped: Promise<boolean> = Promise.resolve(false)
    act(() => {
      tapped = bound!({ scope: SCOPE, deadline, text: 'these' }, send)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // The PDF's own upload lands, and the video (same batch) starts reading
    // only now — after the tap, with nothing active for the gate to have
    // seen at tap time.
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update(() => ({
        [SCOPE]: [{ id: 'doc-1', path: '/tmp/a.pdf', previewUri: 'file:///a.pdf', kind: 'file', batch: BATCH }]
      }))
      setExtracting(true)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(send).not.toHaveBeenCalled()

    act(() => {
      useNativeChatImageAttachmentsStore.getState().update((prev) => ({
        ...prev,
        [SCOPE]: [...(prev[SCOPE] ?? []), { id: 'img-1', path: '/tmp/f1.png', previewUri: 'p1', batch: BATCH }]
      }))
      setExtracting(false)
    })

    const accepted = await tapped
    expect(accepted).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({ id: 'img-1' })
    ])
  })
})

// Item 4 (2026-09-27 review): `tapBatches` covers EVERY batch among the
// tap's own chips, not just a reading video's — `.batch` is stamped on the
// chips of an ordinary multi-photo pick too (attachWith already tags every
// image a selection produces with the same value). So a send tapped while
// the FIRST photo of a multi-photo pick is still uploading now waits for,
// and gathers, the rest of that SAME pick's photos too, once they land —
// not just the one chip present at the tap. Before batch-aware gathering
// existed (round 4), the wait only ever re-checked the tap-time ids, so a
// send in this position took ph1 alone and silently left ph2/ph3 behind for
// the NEXT send. This is a genuine behaviour change, and the better one —
// pinned here as intended, not guarded against.
describe('useMobileNativeChatSendChips — a multi-photo pick rides together with a send tapped mid-upload', () => {
  let renderer: ReactTestRenderer | null = null
  let bound:
    | ((tap: MobileNativeChatSendChipsTap, send: (chips: PendingNativeChatImage[]) => Promise<boolean>) => Promise<boolean>)
    | null = null

  function Harness({ scopeKey, onSendError }: { scopeKey: string; onSendError: (message: string) => void }): null {
    bound = useMobileNativeChatSendChips({
      scopeKey,
      client: { getState: () => 'connected' as const },
      sendGate: { now: () => null },
      onSendError
    })
    return null
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    bound = null
    useNativeChatImageAttachmentsStore.getState().reset()
  })

  it('takes the whole selection, not just the first photo, when it was still uploading at the tap', async () => {
    const PHOTO_BATCH = 'batch-photos'
    const onSendError = vi.fn()
    act(() => {
      renderer = create(createElement(Harness, { scopeKey: SCOPE, onSendError }))
    })
    // ph1 is the only chip that exists yet — the same as any ordinary
    // send-tapped-beside-an-uploading-photo case, nothing video-related here.
    useNativeChatImageAttachmentsStore.getState().update(() => ({
      [SCOPE]: [{ id: 'ph-1', path: '', previewUri: 'file:///1.jpg', batch: PHOTO_BATCH, uploading: true }]
    }))

    const send = vi.fn().mockResolvedValue(true)
    const deadline = Date.now() + 5000
    let tapped: Promise<boolean> = Promise.resolve(false)
    act(() => {
      tapped = bound!({ scope: SCOPE, deadline, text: 'three photos' }, send)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // ph1 finishes uploading; ph2, from the SAME pick, lands and starts uploading.
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update(() => ({
        [SCOPE]: [
          { id: 'ph-1', path: '/tmp/1.jpg', previewUri: 'file:///1.jpg', batch: PHOTO_BATCH },
          { id: 'ph-2', path: '', previewUri: 'file:///2.jpg', batch: PHOTO_BATCH, uploading: true }
        ]
      }))
    })
    let resolved = false
    void tapped.then(() => {
      resolved = true
    })
    await act(async () => {
      await Promise.resolve()
    })
    // ph2 is still uploading — the wait must not have sent ph1 alone yet.
    expect(resolved).toBe(false)

    // ph2 finishes; ph3 lands and starts uploading.
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update((prev) => ({
        ...prev,
        [SCOPE]: [
          ...(prev[SCOPE] ?? []).map((chip) => (chip.id === 'ph-2' ? { ...chip, path: '/tmp/2.jpg', uploading: false } : chip)),
          { id: 'ph-3', path: '', previewUri: 'file:///3.jpg', batch: PHOTO_BATCH, uploading: true }
        ]
      }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(resolved).toBe(false)

    // ph3 finishes — the whole selection has landed now.
    act(() => {
      useNativeChatImageAttachmentsStore.getState().update((prev) => ({
        ...prev,
        [SCOPE]: (prev[SCOPE] ?? []).map((chip) =>
          chip.id === 'ph-3' ? { ...chip, path: '/tmp/3.jpg', uploading: false } : chip
        )
      }))
    })

    const accepted = await tapped
    expect(accepted).toBe(true)
    expect(onSendError).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ id: 'ph-1' }),
      expect.objectContaining({ id: 'ph-2' }),
      expect.objectContaining({ id: 'ph-3' })
    ])
  })
})
