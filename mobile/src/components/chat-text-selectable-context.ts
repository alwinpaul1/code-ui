import { createContext, useContext } from 'react'

/**
 * Whether chat text should accept a press-and-hold right now.
 *
 * Android starts text selection on a long-press over any `selectable` Text
 * and plays its own haptic when it does. While the list is moving, a finger
 * put down to stop a fling and held for the long-press timeout arms that
 * detector: a buzz out of nowhere and a stray selection (reported
 * 2026-09-12). The chat view flips this off while a scroll is in flight and
 * back on when it settles; outside a scroll — the case where the person means
 * to select — nothing changes.
 *
 * Except while a reply holds a selection: turning `selectable` off is what
 * ends a selection on Android (setTextIsSelectable(false) re-sets the text
 * with none), so the first scroll after a hold wiped what the reader was
 * copying (reported 2026-10-14; the Claude app keeps it). On Android, with the
 * document's native root in the tree, the Texts therefore stay selectable and
 * the root is told to stop a hold starting a selection by
 * ChatTextHoldSelectsContext below, which a live selection does not hold open
 * (MobileMarkdown.tsx, SelectionCopyRootView.kt). False here still keeps holds
 * out of a document that never takes one (the user's own bubble). Elsewhere it
 * switches `selectable`, and while any document reports a selection open
 * (ChatTextSelectionReportContext) a scroll leaves it on.
 */
export const ChatTextSelectableContext = createContext(true)

export function useChatTextSelectable(): boolean {
  return useContext(ChatTextSelectableContext)
}

/**
 * Whether a hold may START a selection right now: false while the chat list
 * scrolls, whether or not a selection is open somewhere. This is what the
 * document's native root hears (MobileMarkdown's `holdSelects`).
 *
 * It is not ChatTextSelectableContext. That one stays true through a scroll
 * while any reply holds a selection, because switching `selectable` off would
 * end it. Handed to the root, it switched the scroll's guard off for every
 * reply from the first hold on, so a finger that caught a fling or rested on a
 * reply before it moved started a new selection, and the one being copied gave
 * way to it: the highlight jumped to other words (the user, 2026-10-15,
 * 0.9.147). An open selection needs its Texts selectable, not holds let
 * through.
 */
export const ChatTextHoldSelectsContext = createContext(true)

export function useChatTextHoldSelects(): boolean {
  return useContext(ChatTextHoldSelectsContext)
}

/**
 * Called by a Markdown document when a selection opens (`live` true) or
 * closes in it. `owner` names the document: the chat counts documents, not
 * events, so one that unmounts with a selection open releases only its own.
 */
export type ChatTextSelectionReport = (owner: object, live: boolean) => void

/** The chat's selection report; null outside the chat, where no scroll turns selection off. */
export const ChatTextSelectionReportContext = createContext<ChatTextSelectionReport | null>(null)

export function useChatTextSelectionReport(): ChatTextSelectionReport | null {
  return useContext(ChatTextSelectionReportContext)
}

/**
 * Whether text here may be selected where it is drawn. False on a chat message row: there, as in
 * the Claude app's Code timeline, a hold opens the message's menu and its Select text sheet is
 * where words are selected (MobileNativeChatMessage, mobile-native-chat-message-menu.ts). Nothing
 * in the row is a selectable Text, so a finger that stops a fling or rests before a scroll has no
 * selection to start, and the list has no selection to keep through a recycle. Every other surface
 * keeps its in-place selection (the default).
 */
export const ChatTextInPlaceSelectionContext = createContext(true)

export function useChatTextInPlaceSelection(): boolean {
  return useContext(ChatTextInPlaceSelectionContext)
}

/**
 * What a Markdown document (MobileMarkdown) does with selection here.
 *
 * `selectable`: whether its Texts select. Off through a scroll, except where the document's
 * native root guards holds (Android, `rootGuardsHolds`): there the Texts stay selectable and only
 * the root hears the scroll, because switching a Text's `selectable` off ends the selection in
 * it, and the user lost a held selection to a drag of the transcript (2026-10-14, 0.9.139).
 *
 * `holdSelects`: whether the root lets a hold start a selection. The scroll's own flag, not the
 * one held open by a live selection: that let a scrolling finger start a new selection over the
 * copied one (2026-10-15, 0.9.147). A document that never takes a hold says so through
 * ChatTextSelectableContext.
 *
 * Both are off on a chat message row (ChatTextInPlaceSelectionContext).
 */
export function useChatDocumentSelection(rootGuardsHolds: boolean): { selectable: boolean; holdSelects: boolean } {
  const selectableNow = useChatTextSelectable()
  const holdsSelect = useChatTextHoldSelects()
  const inPlace = useChatTextInPlaceSelection()
  return {
    selectable: inPlace && (rootGuardsHolds || selectableNow),
    holdSelects: inPlace && selectableNow && holdsSelect
  }
}
