import type { RpcClient } from '../transport/rpc-client'
import { sendClaudeQueueNow } from './claude-send-queue-now'
import { readSendUnderDialogRefusal } from './mobile-native-chat-dialog-guard'
import { MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS } from './mobile-native-chat-send'
import {
  isMobileNativeChatTerminalWriteInFlight,
  whenMobileNativeChatTerminalWriteFree
} from './mobile-native-chat-terminal-write-lock'

/** How long "Send now" waits for a message still being typed into the terminal:
 *  the composer send's own budget, which bounds how long it holds the line. */
export const SEND_NOW_TYPING_WAIT_MS = MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS
/** Said when that wait runs out. The key is not pressed: Claude drops it,
 *  silently, over a queue that does not hold the message yet. */
export const SEND_NOW_WHILE_TYPING_REFUSAL =
  'Queued messages not sent (a message is still being typed into the terminal). Try again.'
/** Said when the chat is on another terminal by the time the typing finished. */
export const SEND_NOW_CHAT_MOVED_REFUSAL =
  'Queued messages not sent (the chat moved while a message was being typed)'

/** What the press reads, read again after every wait: the chat can move or
 *  drop its link while the tap waits. */
export type SendNowScope = {
  client: RpcClient | null
  enabled: boolean
  agent: string | null
  handleRef: { readonly current: string | null }
  deviceTokenRef: { readonly current: string | null }
}

/** A second tap while the first is still on its way joins it: one key. */
export function joinPressInFlight(
  inFlight: { current: Promise<boolean> | null },
  press: () => Promise<boolean>
): Promise<boolean> {
  if (inFlight.current) {
    return inFlight.current
  }
  const attempt = press().finally(() => {
    inFlight.current = null
  })
  inFlight.current = attempt
  return attempt
}

/**
 * Claude's send-now key (2.1.275) on `terminal`, once nothing is typing into it.
 *
 * A message sent mid-turn is in the queue box from the moment the composer
 * empties, before its words and Enter reach Claude (showSendingEcho runs ahead
 * of writeChatSend). Pressed in that window, the key found Claude's queue empty,
 * Claude 2.1.296 dropped it without a word (its handler's "nothing_to_send"),
 * and only a later tap sent the message (2026-10-14). So the press waits for
 * whatever holds the terminal's write lock, and waits again if something took
 * it during the look at the screen. It never takes the lock itself: holding it
 * through the look would refuse a composer send tapped meanwhile.
 */
export async function pressClaudeSendNowWhenTyped(
  terminal: string,
  scope: () => SendNowScope,
  onError: (message: string) => void
): Promise<boolean> {
  const deadline = Date.now() + SEND_NOW_TYPING_WAIT_MS
  for (;;) {
    if (!(await whenMobileNativeChatTerminalWriteFree(terminal, Math.max(0, deadline - Date.now())))) {
      onError(SEND_NOW_WHILE_TYPING_REFUSAL)
      return false
    }
    const now = scope()
    if (now.handleRef.current !== terminal || !now.client || !now.enabled) {
      onError(SEND_NOW_CHAT_MOVED_REFUSAL)
      return false
    }
    // The key is for the chat; a dialog on screen would take it (2026-09-27).
    const refusal = await readSendUnderDialogRefusal({ client: now.client, terminal, agent: now.agent })
    if (refusal) {
      onError(refusal)
      return false
    }
    if (isMobileNativeChatTerminalWriteInFlight(terminal)) {
      continue
    }
    const accepted = await sendClaudeQueueNow({ client: now.client, terminal, deviceToken: now.deviceTokenRef.current })
    if (!accepted) {
      onError('The agent did not take the send-now key. The queue is unchanged.')
    }
    return accepted
  }
}
