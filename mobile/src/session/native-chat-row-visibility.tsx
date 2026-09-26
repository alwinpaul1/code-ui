import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { ViewToken } from '@shopify/flash-list'
import { useNativeChatScreenFocus } from './use-native-chat-screen-focus'

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
 *
 * A covered screen counts too: while a pushed route sits over the session
 * screen, no row is on screen, whatever FlashList last reported.
 */
export type ChatRowVisibility = {
  /** Hand straight to FlashList's `onViewableItemsChanged`. */
  onViewableItemsChanged: (info: {
    viewableItems: readonly ViewToken<unknown>[]
    changed: readonly ViewToken<unknown>[]
  }) => void
  /** Whether the screen holding the list has navigation focus. */
  setScreenFocused: (focused: boolean) => void
  isOnScreen: (index: number) => boolean
  subscribe: (listener: () => void) => () => void
}

export function createChatRowVisibility(): ChatRowVisibility {
  // Null until the list first reports: every row counts as on screen, so a
  // late or missing report costs some motion, never a still "Running".
  let onScreen: ReadonlySet<number> | null = null
  // Focused until the navigator says otherwise, for the same reason.
  let screenFocused = true
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }
  return {
    onViewableItemsChanged: ({ viewableItems }) => {
      onScreen = new Set(
        viewableItems.flatMap((token) => (typeof token.index === 'number' ? [token.index] : []))
      )
      notify()
    },
    setScreenFocused: (focused) => {
      if (focused !== screenFocused) {
        screenFocused = focused
        notify()
      }
    },
    isOnScreen: (index) => screenFocused && (onScreen === null || onScreen.has(index)),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

/** The chat list's store, fed by its screen's navigation focus. */
export function useChatRowVisibility(): ChatRowVisibility {
  const [visibility] = useState(createChatRowVisibility)
  useNativeChatScreenFocus(visibility.setScreenFocused)
  return visibility
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
