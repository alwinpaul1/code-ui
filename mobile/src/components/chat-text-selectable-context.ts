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
 * copying (reported 2026-10-14; the Claude app keeps it). While any document
 * reports one open (ChatTextSelectionReportContext), a scroll leaves this on.
 */
export const ChatTextSelectableContext = createContext(true)

export function useChatTextSelectable(): boolean {
  return useContext(ChatTextSelectableContext)
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
