import { useCallback, useState } from 'react'
import { createChatHeldSelections, useHeldMessageIds, type ChatHeldSelections } from '../components/chat-held-selection'
import { chatRowItemType } from './mobile-native-chat-list-extra-data'

/**
 * The chat list's side of a held selection: the store the documents report into, and the item
 * type that keeps the row holding a selection to its own message (chatRowItemType). `heldIds` goes
 * into the list's extraData, so FlashList re-reads the types when the selection moves.
 */
export function useChatHeldSelectionList(): {
  held: ChatHeldSelections
  heldIds: ReadonlySet<string>
  getItemType: (row: { id: string }) => string
} {
  const [held] = useState(createChatHeldSelections)
  const heldIds = useHeldMessageIds(held)
  const getItemType = useCallback((row: { id: string }) => chatRowItemType(row, heldIds), [heldIds])
  return { held, heldIds, getItemType }
}
