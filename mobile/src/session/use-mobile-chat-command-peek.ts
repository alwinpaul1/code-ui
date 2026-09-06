import { useCallback, type MutableRefObject } from 'react'
import { slashCommandOpensOverlay } from '../../../src/shared/native-chat-slash-commands'

/** Show terminal-only command overlays without changing the saved chat preference. */
export function useMobileChatCommandPeek(
  agentRef: MutableRefObject<string | null>,
  tabId: string | null,
  peek: (tabId: string) => void
): (command: string) => void {
  return useCallback(
    (command: string) => {
      if (agentRef.current === 'codex' && !slashCommandOpensOverlay('codex', command)) {
        return
      }
      if (tabId) {
        peek(tabId)
      }
    },
    [agentRef, tabId, peek]
  )
}
