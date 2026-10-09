import { appAwayMsSince } from './app-foreground-clock'
import {
  MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS,
  MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS
} from './mobile-native-chat-send'

/** What the app says it was doing while a send's budget ran out (app-foreground-clock.ts). */
export const SEND_BUDGET_SPENT_AWAY =
  'the app was in the background before it reached your desktop. Send it again'

/**
 * Why a send that stopped with nothing more written stopped, when its budget is what
 * stopped it: `${action} not sent: …`, or null when it still had a write's worth left
 * (then the desktop refused it, and the caller says so as it always has).
 *
 * The budget is wall-clock time, and Android runs no JS timer while the app is out of the
 * foreground: a send left between the emptied composer and its body comes back with the
 * budget gone and writes nothing more (2026-10-09, "it shows the send and then after some
 * time when I go again it shows like message not send"). That is the app, not the desktop,
 * and the bare "Message not sent" it used to say named neither. The send's start is read
 * back from its deadline (openMobileNativeChatSendBudget), which a photo send's settle may
 * have pushed later; that start then falls later, never earlier, than the tap.
 */
export function spentSendBudgetRefusal(action: string, deadline: number, now = Date.now()): string | null {
  if (deadline - now >= MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS) {
    return null
  }
  return appWasAwayLongEnoughSince(deadline - MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS, now)
    ? `${action} not sent: ${SEND_BUDGET_SPENT_AWAY}`
    : `${action} not sent: your desktop did not answer within ${MOBILE_NATIVE_CHAT_SEND_TIMEOUT_MS / 1_000} s. Send it again`
}

/** Whether the app was away long enough since `since` to be what spent a send: at least
 *  a write's worth (MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS). A moment away while the link
 *  or the desktop was the slow one does not move the blame (review of 34c021948). */
export function appWasAwayLongEnoughSince(since: number, now = Date.now()): boolean {
  return appAwayMsSince(since, now) >= MOBILE_NATIVE_CHAT_MIN_WRITE_TIMEOUT_MS
}
