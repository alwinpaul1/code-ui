import type { ComponentProps } from 'react'
import { MobileNativeChatView, type MobileNativeChatInputLockReason } from './MobileNativeChatView'

export type { MobileNativeChatInputLockReason }
import { useMobileNativeChatShellCommandConfirm } from './use-mobile-native-chat-shell-command-confirm'

/**
 * The chat view with its send asking first when the message starts with `!`,
 * which the agent runs as a shell command on the desktop
 * (use-mobile-native-chat-shell-command-confirm.tsx). A wrapper, so the overlay
 * hands over the same props it always did: the question's notice goes where the
 * overlay already sends the chat's own failures (`reportBackgroundTaskFailure`
 * is the overlay's `onSendFailure`).
 */
export function MobileNativeChatShellConfirmView(
  props: ComponentProps<typeof MobileNativeChatView>
): React.JSX.Element {
  const shell = useMobileNativeChatShellCommandConfirm(
    props.agent,
    props.onSend,
    props.reportBackgroundTaskFailure
  )
  return (
    <>
      <MobileNativeChatView {...props} onSend={shell.send} />
      {shell.confirm}
    </>
  )
}
