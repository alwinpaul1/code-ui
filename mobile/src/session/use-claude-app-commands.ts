import { useCallback, useLayoutEffect, useRef } from 'react'
import { claudeAppCommandOf } from './ccr-slash-commands'
import { openClaudeAppCommandSheet } from './claude-app-command-sheets'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

/**
 * The Claude app's own `/model`, `/diff` and `/workflows` on a Claude tab matched to its Anthropic
 * session: each opens a phone sheet and is never sent (1.261013.20, iu7.a and ay8.java:8650).
 * `/model` opens the model sheet; the other two open what their screens published
 * (claude-app-command-sheets.ts), and with nothing published the command goes as typed. A taken
 * command leaves the composer empty, as a send would. Undefined off that lane: every other tab,
 * Codex included, sends as before.
 */
export function useClaudeAppCommands(args: {
  active: boolean
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  openModelSheet: () => void
}): ((text: string) => boolean) | undefined {
  const latest = useRef(args)
  useLayoutEffect(() => {
    latest.current = args
  })
  const take = useCallback((text: string): boolean => {
    const command = claudeAppCommandOf(text)
    if (command === null) {
      return false
    }
    const now = latest.current
    if (command === 'model') {
      now.openModelSheet()
    } else if (!openClaudeAppCommandSheet(command)) {
      return false
    }
    const origin = now.captureSendOrigin(text)
    if (origin) {
      now.clearDraftForSend(origin, text)
    }
    return true
  }, [])
  return args.active ? take : undefined
}
