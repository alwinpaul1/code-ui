import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_CHAT_FOCUS_VIEW,
  loadChatFocusView,
  peekChatFocusView,
  saveChatFocusView,
  subscribeChatFocusView
} from '../storage/session-view-preferences'

/** Whether Focus view is on, live: an open chat follows the Settings toggle
 *  without a remount. Before the first read it answers the default (off), and
 *  asks storage once so the answer corrects itself. */
export function useMobileChatFocusView(): boolean {
  const value = useSyncExternalStore(subscribeChatFocusView, peekChatFocusView, peekChatFocusView)
  useEffect(() => {
    if (value === null) {
      void loadChatFocusView()
    }
  }, [value])
  return value ?? DEFAULT_CHAT_FOCUS_VIEW
}

export type MobileChatFocusViewPreference = {
  focusView: boolean
  setFocusView: (enabled: boolean) => void
}

/** The Settings switch: optimistic in memory, ordered on disk, and put back
 *  to what storage holds if the write fails. */
export function useMobileChatFocusViewPreference(): MobileChatFocusViewPreference {
  const focusView = useMobileChatFocusView()
  const setFocusView = useCallback((enabled: boolean) => {
    void saveChatFocusView(enabled).catch(() => loadChatFocusView())
  }, [])
  return { focusView, setFocusView }
}
