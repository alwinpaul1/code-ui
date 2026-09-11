import { useCallback, type MutableRefObject } from 'react'
import { chatCommandOpensOverlay } from './mobile-chat-command-overlay'

/**
 * Show the terminal for a slash command only when the command draws a TUI
 * overlay the chat view cannot show; never change the saved chat preference.
 *
 * Every agent goes through a catalog. Until 2026-09-11 only Codex did, and a
 * Claude tab left chat for the terminal on every command — /btw, /clear,
 * /help — with nothing there to watch.
 */
export function useMobileChatCommandPeek(
  agentRef: MutableRefObject<string | null>,
  tabId: string | null,
  peek: (tabId: string) => void
): (command: string) => void {
  return useCallback(
    (command: string) => {
      const agent = agentRef.current
      if (agent && !chatCommandOpensOverlay(agent, command)) {
        return
      }
      if (tabId) {
        peek(tabId)
      }
    },
    [agentRef, tabId, peek]
  )
}
