import type { MobileNativeChatSession } from './use-mobile-native-chat-session'

/** Whether the chat holds its own settled read of the whole session, from its
 *  first row: what a check needs before it may say no call in the session
 *  touched something (the created-file count, MobileNativeChatOverlay.tsx).
 *  Not a tail kept over an empty re-subscribe (`baseRetained`), and only what
 *  the host said reaches the first row (`wholeSession`). */
export function holdsWholeSession(
  session: Pick<MobileNativeChatSession, 'status' | 'baseRetained' | 'wholeSession'>
): boolean {
  return session.status === 'ready' && session.baseRetained !== true && session.wholeSession === true
}
