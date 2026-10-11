import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { useNativeChatImageAttachmentsStore } from './mobile-native-chat-image-attachments-store'
import { withScopeAttachments } from './mobile-native-chat-image-scope-state'

/**
 * Moving a composer chip one place, as the Claude app does (`rs8.moveUpload`,
 * offered to a screen reader as "Move earlier" / "Move later",
 * com.anthropic.claude 1.261009.20). The strip's order is the order a send
 * pastes the photos in, so it is the order the agent reads them in. By chip
 * id, which is unique across the app, so the strip reaches it without a prop
 * through every composer layer (the same reason the retry is kept by id).
 */
export type NativeChatAttachmentMove = 'earlier' | 'later'

/** The list with the chip moved one place, or null when it cannot go that way. */
export function movedNativeChatAttachments(
  chips: readonly PendingNativeChatImage[],
  id: string,
  move: NativeChatAttachmentMove
): PendingNativeChatImage[] | null {
  const from = chips.findIndex((chip) => chip.id === id)
  const to = move === 'earlier' ? from - 1 : from + 1
  if (from === -1 || to < 0 || to >= chips.length) {
    return null
  }
  const next = [...chips]
  next[from] = chips[to]!
  next[to] = chips[from]!
  return next
}

/** Moves the chip in whichever tab's strip holds it; false when it could not. */
export function moveNativeChatAttachment(id: string, move: NativeChatAttachmentMove): boolean {
  const store = useNativeChatImageAttachmentsStore.getState()
  for (const [scope, chips] of Object.entries(store.byScope)) {
    if (!chips.some((chip) => chip.id === id)) {
      continue
    }
    const next = movedNativeChatAttachments(chips, id, move)
    if (!next) {
      return false
    }
    store.update((prev) => withScopeAttachments(prev, scope, next))
    return true
  }
  return false
}
