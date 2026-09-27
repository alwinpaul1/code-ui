import { create } from 'zustand'
import type { MobileNativeChatImagesByScope } from './mobile-native-chat-image-scope-state'

/** Chip ids, counted beside the chips they name and not per composer mount:
 *  the chips outlive a mount here, and a remount counting from img-1 again
 *  gave a new photo the id of one already in the strip, or of one a failed
 *  send was about to put back, so one X took both away (2026-09-26 review). */
export const nativeChatChipIdCounter = { current: 0 }

/** A send waiting for an upload before it writes, and the text and chips it was tapped with. */
export type NativeChatWaitingSend = {
  readonly text: string
  readonly ids: readonly string[]
  readonly whole: Promise<boolean>
}

/** The sends waiting for an upload, by tab scope
 *  (use-mobile-native-chat-send-chips.ts). Here beside the chips so a reset
 *  clears them together: an entry a reset left behind was joined by every
 *  later send on that tab, text-only or not (2026-09-26 review). */
export const nativeChatWaitingSends = new Map<string, NativeChatWaitingSend>()

/** How many times the store has been reset. A reset starts the chip ids
 *  again, so a send waiting across one gives up rather than take the next
 *  photo to reuse its chip's id for its own (2026-09-26 review). */
export const nativeChatAttachmentsResets = { current: 0 }

/** A video's frames are read one at a time, which can take a while — the
 *  extraction progress a still-reading pick shows lives here, NOT in
 *  `byScope`, so it can never be seen by the send-chip settlement in
 *  `use-mobile-native-chat-send-chips.ts` reading `byScope` alone. A chip a
 *  send is watching must never disappear from that array; extraction
 *  progress is drawn beside the chips, not as one of them, so nothing there
 *  ever needs to be added and later removed. `use-mobile-native-chat-send-chips.ts`
 *  does read this one too, though: a send tapped mid-extraction waits for it
 *  the same way it waits for a chip still uploading (2026-09-27 review).
 *
 *  `batch` is the same tag `use-mobile-native-chat-image-upload.ts`'s
 *  `attachWith` already stamps on every chip a selection produces
 *  (`onImageStart`/`onImageUploaded`) — carried here too so a send waiting on
 *  this extraction can find every chip this SAME pick produces, including one
 *  that lands after the send started waiting (`use-mobile-native-chat-send-chips.ts`).
 *  `total` is `null` for the stretch between a video being recognized and its
 *  duration actually being read (up to `VIDEO_FRAME_READY_TIMEOUT_MS`) — there
 *  is something to show ("reading a video…") well before there is a count
 *  (2026-09-27 review: a send tapped during that wait used to see nothing set
 *  at all, since the slot used to start at the first frame's own progress). */
export type NativeChatVideoFrameExtractionState = {
  readonly batch: string
  readonly done: number
  readonly total: number | null
}

export type MobileNativeChatVideoFrameExtractionByScope = Record<
  string,
  NativeChatVideoFrameExtractionState | undefined
>

/** A scope's video-frame read's AbortController, registered only once
 *  extraction actually starts for a specific video — never merely because a
 *  document attach began, which may turn out to hold no video at all. Kept
 *  here, keyed by scope, rather than a `useRef` on the upload hook's own
 *  instance: a composer remount (a tab revisited mid-read) gets a fresh hook
 *  instance and a fresh ref, which could never reach a controller an earlier
 *  instance created — the cancel button would still be drawn (it reads the
 *  store's progress slice) but do nothing (2026-09-27 review). */
export const videoFrameExtractionControllers = new Map<string, AbortController>()

/** Registers `scope`'s active controller — called once extraction actually
 *  starts (`pickVideoFrames`'s `onStart`), never merely on an attach attempt. */
export function registerVideoFrameExtractionController(scope: string, controller: AbortController): void {
  videoFrameExtractionControllers.set(scope, controller)
}

/** Un-registers `controller` from `scope`, but only while it is still the
 *  current one: a later attach may already have installed its own by the
 *  time this one's whole attach settles, and that one must not be taken away
 *  out from under it (mirrors `nativeChatWaitingSends`'s own release guard). */
export function clearVideoFrameExtractionController(scope: string, controller: AbortController): void {
  if (videoFrameExtractionControllers.get(scope) === controller) {
    videoFrameExtractionControllers.delete(scope)
  }
}

/** Stops `scope`'s video-frame read in progress, if any — a no-op once it
 *  has already settled or was never reading a video in the first place. */
export function cancelVideoFrameExtractionFor(scope: string): void {
  videoFrameExtractionControllers.get(scope)?.abort()
}

/** Whether `scope` currently has a registered video-frame-read controller —
 *  set the moment extraction starts (`onStart`) and cleared once the whole
 *  attach settles, independent of the REACTIVE progress slice below (which a
 *  caller populates through its own `onVideoFrameExtractionProgress`
 *  callback — optional, and not every caller wires one up). The
 *  concurrent-attach guard (`use-mobile-native-chat-image-upload.ts`) reads
 *  this, not `isVideoFrameExtractionActive`, so it engages whether or not
 *  anything is listening for progress at all. */
export function hasVideoFrameExtractionController(scope: string): boolean {
  return videoFrameExtractionControllers.has(scope)
}

/** Pending composer images by tab scope, kept outside the session screen so
 *  leaving it (source control, another worktree) and coming back still shows
 *  the chips (2026-09-13: the text draft survived that trip from disk, the
 *  images did not). Never written to disk: the files live in the app cache
 *  and would not outlive the process anyway. */
export const useNativeChatImageAttachmentsStore = create<{
  byScope: MobileNativeChatImagesByScope
  videoFrameExtractionByScope: MobileNativeChatVideoFrameExtractionByScope
  update: (fn: (prev: MobileNativeChatImagesByScope) => MobileNativeChatImagesByScope) => void
  updateVideoFrameExtraction: (
    fn: (
      prev: MobileNativeChatVideoFrameExtractionByScope
    ) => MobileNativeChatVideoFrameExtractionByScope
  ) => void
  reset: () => void
}>((set) => ({
  byScope: {},
  videoFrameExtractionByScope: {},
  update: (fn) => set((state) => ({ byScope: fn(state.byScope) })),
  updateVideoFrameExtraction: (fn) =>
    set((state) => ({ videoFrameExtractionByScope: fn(state.videoFrameExtractionByScope) })),
  reset: () => {
    nativeChatChipIdCounter.current = 0
    nativeChatAttachmentsResets.current += 1
    nativeChatWaitingSends.clear()
    for (const controller of videoFrameExtractionControllers.values()) {
      controller.abort()
    }
    videoFrameExtractionControllers.clear()
    set({ byScope: {}, videoFrameExtractionByScope: {} })
  }
}))

/** `scope`'s current video-frame extraction record, or null while none is running. */
export function videoFrameExtractionState(scope: string): NativeChatVideoFrameExtractionState | null {
  return useNativeChatImageAttachmentsStore.getState().videoFrameExtractionByScope[scope] ?? null
}

/** Whether `scope`'s document attach is still reading a video's frames — for
 *  `batch` given, specifically THAT pick's, not merely some pick or other. */
export function isVideoFrameExtractionActive(scope: string, batch?: string): boolean {
  const active = videoFrameExtractionState(scope)
  if (!active) {
    return false
  }
  return batch === undefined || active.batch === batch
}
