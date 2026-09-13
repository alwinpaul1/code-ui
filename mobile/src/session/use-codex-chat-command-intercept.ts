// In Codex chat, `/model` is the phone's own sheet: typed into the TUI it would
// open a picker the chat cannot show. Bare `/model` opens the sheet; `/model
// <slug>` applies through the picker driver exactly like a sheet tap.
import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import type { MobileNativeChatSendOutcome } from './mobile-native-chat-send'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import type { MobileNativeChatSessionOptionPickersProps } from './MobileNativeChatSessionOptionPickers'

export function useCodexChatCommandIntercept(args: {
  agentRef: MutableRefObject<string | null>
  sessionOptions: MobileNativeChatSessionOptionPickersProps | null
  /** The composer seam. An intercepted command never reaches the send that
   *  normally empties the box, so `/model` stayed there and glued itself to
   *  the front of the next message (2026-09-13). */
  captureSendOrigin: (text: string) => MobileNativeChatSendOrigin | null
  clearDraftForSend: (origin: MobileNativeChatSendOrigin, text: string) => void
  rawSendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number
  ) => Promise<MobileNativeChatSendOutcome>
}): {
  modelSheetRequest: number
  handleNativeChatSend: (text: string, images?: string[]) => Promise<boolean>
  handleNativeChatSendWithOutcome: (
    text: string,
    images?: string[],
    deadline?: number
  ) => Promise<MobileNativeChatSendOutcome>
} {
  const { agentRef, captureSendOrigin, clearDraftForSend, sessionOptions, rawSendWithOutcome } =
    args
  const clearComposer = useCallback(
    (text: string) => {
      const origin = captureSendOrigin(text)
      if (origin) {
        clearDraftForSend(origin, text)
      }
    },
    [captureSendOrigin, clearDraftForSend]
  )
  const [modelSheetRequest, setModelSheetRequest] = useState(0)
  const sessionOptionsRef = useRef(sessionOptions)
  useLayoutEffect(() => {
    sessionOptionsRef.current = sessionOptions
  })

  const intercept = useCallback(
    async (text: string): Promise<MobileNativeChatSendOutcome | null> => {
      const match = /^\s*\/model(?:\s+(\S+))?\s*$/i.exec(text)
      if (agentRef.current !== 'codex' || !match) {
        return null
      }
      const slug = match[1]
      if (!slug) {
        clearComposer(text)
        setModelSheetRequest((current) => current + 1)
        return 'accepted'
      }
      const applied = await sessionOptionsRef.current?.controller.setOption('model', slug)
      if (applied) {
        clearComposer(text)
      }
      return applied ? 'accepted' : 'rejected'
    },
    [agentRef, clearComposer]
  )
  const handleNativeChatSendWithOutcome = useCallback(
    async (
      text: string,
      images?: string[],
      deadline?: number
    ): Promise<MobileNativeChatSendOutcome> => {
      const intercepted = images?.length ? null : await intercept(text)
      if (intercepted !== null) {
        return intercepted
      }
      return deadline === undefined
        ? rawSendWithOutcome(text, images)
        : rawSendWithOutcome(text, images, deadline)
    },
    [intercept, rawSendWithOutcome]
  )
  const handleNativeChatSend = useCallback(
    async (text: string, images?: string[]): Promise<boolean> =>
      // Same contract as the raw send: an ack-lost ('unknown') send is held for
      // transcript verification, not reported as a failure.
      (await handleNativeChatSendWithOutcome(text, images)) !== 'rejected',
    [handleNativeChatSendWithOutcome]
  )
  return { modelSheetRequest, handleNativeChatSend, handleNativeChatSendWithOutcome }
}
