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
 * Whether text here may be selected where it is drawn. A chat message row sets it false and turns
 * it back on around a reply's words only (MobileNativeChatMessage's ProseRun), as the Claude app
 * (1.261013.20) wraps each text block of a message in its SelectionContainer (gy30.j, t8i.o) and
 * nothing else in the row: a hold on Claude's words selects in place, a hold on the user's own
 * bubble opens its menu (Copy, Select text; mobile-native-chat-message-menu.ts), and tool rows and
 * thoughts select nothing. A scroll still keeps a hold from starting a selection
 * (ChatTextHoldSelectsContext). Every other surface keeps its in-place selection (the default).
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
 * Both are off on a chat message row outside a reply's words (ChatTextInPlaceSelectionContext).
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

/** `selectable` of useChatDocumentSelection where the native root guards holds: in-place selection
 *  alone. It reads neither scroll flag, so a document that only asks this is not re-rendered when
 *  a drag starts or the list settles. */
function useRootGuardedDocumentSelectable(): boolean {
  return useChatTextInPlaceSelection()
}

/** `selectable` of useChatDocumentSelection where nothing but the Texts can stop a hold. */
function useScrollGatedDocumentSelectable(): boolean {
  return useChatDocumentSelection(false).selectable
}

/**
 * The hook a Markdown document reads its Texts' `selectable` through, picked once per platform.
 *
 * With a root that guards holds (Android), the scroll's flags reach the root alone
 * (useChatDocumentSelection(true).holdSelects, read by a component around the document), and the
 * document itself never re-renders for a scroll. It used to read both flags at its top, so every
 * reply mounted in the chat list rebuilt its whole document on the JS thread when a drag started
 * and again when the list settled, the moment FlashList needs that thread to mount the rows the
 * drag exposes (the user's "stuttering while scrolling", 2026-10-16). The Claude app 1.261013.20
 * recomposes no transcript item for a scroll: Compose cancels the selection long press once the
 * LazyColumn's drag passes the touch slop.
 */
export function chatDocumentSelectableHook(rootGuardsHolds: boolean): () => boolean {
  return rootGuardsHolds ? useRootGuardedDocumentSelectable : useScrollGatedDocumentSelectable
}
