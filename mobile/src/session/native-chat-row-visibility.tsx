import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import type { ViewToken } from '@shopify/flash-list'

/**
 * Which chat rows are on screen, so a running row's shimmer runs only where
 * someone can see it (2026-09-26). The chat list keeps rows mounted a screen
 * beyond the viewport (its draw distance), and without this every running row
 * in that runway would animate for nothing.
 *
 * FlashList reports viewability by index, and so does this: a new message
 * shifts every index, and FlashList's report does not repeat when the set of
 * visible indices is unchanged, so a set of message ids would go stale while a
 * set of indices stays right.
 */
export type ChatRowVisibility = {
  /** Hand straight to FlashList's `onViewableItemsChanged`. */
  onViewableItemsChanged: (info: {
    viewableItems: readonly ViewToken<unknown>[]
    changed: readonly ViewToken<unknown>[]
  }) => void
  isOnScreen: (index: number) => boolean
  subscribe: (listener: () => void) => () => void
}

export function createChatRowVisibility(): ChatRowVisibility {
  // Null until the list first reports: every row counts as on screen, so a
  // late or missing report costs some motion, never a still "Running".
  let onScreen: ReadonlySet<number> | null = null
  const listeners = new Set<() => void>()
  return {
    onViewableItemsChanged: ({ viewableItems }) => {
      onScreen = new Set(
        viewableItems.flatMap((token) => (typeof token.index === 'number' ? [token.index] : []))
      )
      for (const listener of listeners) {
        listener()
      }
    },
    isOnScreen: (index) => onScreen === null || onScreen.has(index),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

type RowScope = { visibility: ChatRowVisibility; index: number }

const ChatRowScopeContext = createContext<RowScope | null>(null)

/** One chat list row: what the rows under it ask when they want to know
 *  whether they can be seen. */
export function ChatRowOnScreenScope({
  visibility,
  index,
  children
}: {
  visibility: ChatRowVisibility
  index: number
  children: ReactNode
}) {
  const scope = useMemo(() => ({ visibility, index }), [visibility, index])
  return <ChatRowScopeContext.Provider value={scope}>{children}</ChatRowScopeContext.Provider>
}

const noSubscription = () => () => {}

/** Whether the row this sits in is on screen. True outside a reporting list
 *  (the subagent viewer draws the same rows) and before its first report. */
export function useChatRowOnScreen(): boolean {
  const scope = useContext(ChatRowScopeContext)
  const read = useCallback(() => scope === null || scope.visibility.isOnScreen(scope.index), [scope])
  return useSyncExternalStore(scope?.visibility.subscribe ?? noSubscription, read, read)
}
