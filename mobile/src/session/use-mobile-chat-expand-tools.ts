import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_CHAT_EXPAND_TOOLS,
  loadChatExpandTools,
  peekChatExpandTools,
  saveChatExpandTools,
  subscribeChatExpandTools
} from '../storage/session-view-preferences'

/** Whether tool calls open with their details, live: an open chat follows the
 *  Settings switch without a remount. Before the first read it answers the
 *  default (off), and asks storage once so the answer corrects itself. */
export function useMobileChatExpandTools(): boolean {
  const value = useSyncExternalStore(subscribeChatExpandTools, peekChatExpandTools, peekChatExpandTools)
  useEffect(() => {
    if (value === null) {
      void loadChatExpandTools()
    }
  }, [value])
  return value ?? DEFAULT_CHAT_EXPAND_TOOLS
}

export type MobileChatExpandToolsPreference = {
  expandTools: boolean
  setExpandTools: (enabled: boolean) => void
}

/** The Settings switch: optimistic in memory, ordered on disk, and put back
 *  to what storage holds if the write fails. */
export function useMobileChatExpandToolsPreference(): MobileChatExpandToolsPreference {
  const expandTools = useMobileChatExpandTools()
  const setExpandTools = useCallback((enabled: boolean) => {
    void saveChatExpandTools(enabled).catch(() => loadChatExpandTools())
  }, [])
  return { expandTools, setExpandTools }
}
