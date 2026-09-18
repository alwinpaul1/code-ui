import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { mobileNativeChatScopeKey } from './mobile-native-chat-scope-key'
import { appendMentionToDraftText } from './mobile-native-chat-draft-append-mention'
import { MobileNativeChatDraftEditGenerations } from './mobile-native-chat-draft-edit-generations'

/**
 * Appends `mention` to `tabId`'s draft — which need not be the currently
 * active tab. `drafts` is keyed by every tab a `useMobileNativeChatDrafts`
 * instance has ever seen, not just the current one, so this lets the file
 * reader's "Ask about lines" write into the chat tab it is about to switch
 * back to before that switch has rendered a new active `tabId`.
 *
 * A tab whose on-disk draft was never hydrated into memory this session gets
 * that draft overwritten rather than merged with it — the same "whatever's
 * already in memory wins" trade `useMobileNativeChatDraftPersistence` already
 * makes for a live edit that races its own hydration read.
 *
 * Extracted so use-mobile-native-chat-drafts.ts (already at its max-lines
 * budget) stays under it; see clearDraftAtSendStartWith beside it for the
 * same shape.
 */
export function appendComposerMentionWith(
  deps: {
    hostId: string
    worktreeId: string
    setDrafts: Dispatch<SetStateAction<Record<string, string>>>
    draftEditGenerationsRef: MutableRefObject<MobileNativeChatDraftEditGenerations>
  },
  tabId: string,
  mention: string
): void {
  const key = mobileNativeChatScopeKey(deps.hostId, deps.worktreeId, tabId)
  if (!key) {
    return
  }
  deps.draftEditGenerationsRef.current.advance(key)
  deps.setDrafts((previous) => ({
    ...previous,
    [key]: appendMentionToDraftText(previous[key] ?? '', mention)
  }))
}
