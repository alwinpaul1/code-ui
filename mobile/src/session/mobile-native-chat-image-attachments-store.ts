import { create } from 'zustand'
import type { MobileNativeChatImagesByScope } from './mobile-native-chat-image-scope-state'

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
  reset: () => set({ byScope: {} })
}))
