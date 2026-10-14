import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * The chat's selection, held outside the rows that draw it, as the Claude app holds its
 * SelectionState outside the LazyColumn's items (a SelectionContainer around the list, its state
 * remembered and saved: sla.java:1136, a230.java:836, ayt.java:28). A row that draws a message can
 * go (a scroll past the draw window, a list update that moves it) while the reader still means
 * the words they selected; this keeps where those words were so the row that draws the message
 * again puts the selection back (SelectionCopyRootView.restoreSelection), and tells the list which
 * message holds one so its row is never handed to another message (chatRowItemType).
 *
 * One selection at a time, as on Android: holding a new one forgets the last.
 */
export type HeldSelection = {
  /** Which Text of the document, in the order the native root walks them. */
  run: number
  start: number
  end: number
  /** The selected words, so a restore never lands on other words. */
  words: string
}

export type ChatHeldSelections = {
  /** A document's selection opened or moved (the native root's onSelectionChange). */
  hold(document: string, selection: HeldSelection): void
  /** The selection in a mounted document ended: a tap away, a Copy, its words changed. */
  release(document: string): void
  /** What to put back in `document` when it draws again; undefined if nothing is held there. */
  heldFor(document: string): HeldSelection | undefined
  /** The messages holding a selection, for the list's item type. */
  heldMessageIds(): ReadonlySet<string>
  subscribe(listener: () => void): () => void
}

const NONE: ReadonlySet<string> = new Set()

/**
 * The message a chat document belongs to. MobileNativeChatMessage names each document
 * `${message.id}:${segment}:${index}`, so the message is everything before the last two parts (a
 * message id may hold a colon itself). A document named any other way is its own message.
 */
export function messageIdOfDocument(document: string): string {
  const parts = document.split(':')
  return parts.length >= 3 ? parts.slice(0, -2).join(':') : document
}

export function createChatHeldSelections(): ChatHeldSelections {
  let held: { document: string; selection: HeldSelection } | null = null
  let messages: ReadonlySet<string> = NONE
  const listeners = new Set<() => void>()
  const set = (next: typeof held) => {
    const before = held
    held = next
    const message = next ? messageIdOfDocument(next.document) : null
    const changedMessage = (before ? messageIdOfDocument(before.document) : null) !== message
    if (changedMessage) {
      messages = message === null ? NONE : new Set([message])
    }
    for (const listener of listeners) {
      listener()
    }
  }
  return {
    hold(document, selection) {
      const same =
        held !== null &&
        held.document === document &&
        held.selection.run === selection.run &&
        held.selection.start === selection.start &&
        held.selection.end === selection.end &&
        held.selection.words === selection.words
      if (!same) {
        set({ document, selection })
      }
    },
    release(document) {
      if (held?.document === document) {
        set(null)
      }
    },
    heldFor(document) {
      return held?.document === document ? held.selection : undefined
    },
    heldMessageIds: () => messages,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/** The chat's held selection; null outside the chat, where no list moves a document away. */
export const ChatHeldSelectionContext = createContext<ChatHeldSelections | null>(null)

export function useChatHeldSelections(): ChatHeldSelections | null {
  return useContext(ChatHeldSelectionContext)
}

const noSubscription = () => () => {}

/** The messages holding a selection, re-rendering when that changes. */
export function useHeldMessageIds(store: ChatHeldSelections | null): ReadonlySet<string> {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.heldMessageIds() ?? NONE,
    () => store?.heldMessageIds() ?? NONE
  )
}

/** What `document` should restore, re-rendering when that changes. */
export function useHeldSelectionFor(
  store: ChatHeldSelections | null,
  document: string | undefined
): HeldSelection | undefined {
  const read = () => (store && document !== undefined ? store.heldFor(document) : undefined)
  return useSyncExternalStore(store?.subscribe ?? noSubscription, read, read)
}
