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

/** Pending composer images by tab scope, kept outside the session screen so
 *  leaving it (source control, another worktree) and coming back still shows
 *  the chips (2026-09-13: the text draft survived that trip from disk, the
 *  images did not). Never written to disk: the files live in the app cache
 *  and would not outlive the process anyway. */
export const useNativeChatImageAttachmentsStore = create<{
  byScope: MobileNativeChatImagesByScope
  update: (fn: (prev: MobileNativeChatImagesByScope) => MobileNativeChatImagesByScope) => void
  reset: () => void
}>((set) => ({
  byScope: {},
  update: (fn) => set((state) => ({ byScope: fn(state.byScope) })),
  reset: () => {
    nativeChatChipIdCounter.current = 0
    nativeChatAttachmentsResets.current += 1
    nativeChatWaitingSends.clear()
    set({ byScope: {} })
  }
}))
