import type { ComponentProps } from 'react'
import { MobileNativeChatView, type MobileNativeChatInputLockReason } from './MobileNativeChatView'
import { useMobileNativeChatShellCommandConfirm } from './use-mobile-native-chat-shell-command-confirm'

export type { MobileNativeChatInputLockReason }

const NO_ANSWER = (): Promise<boolean> => Promise.resolve(false)

/**
 * The chat view with its sends asking first when the text starts with `!`,
 * which the agent runs as a shell command on the desktop
 * (use-mobile-native-chat-shell-command-confirm.tsx). Two doors type text into
 * the composer and press Enter: the composer's own send and a plain-text
 * question's answer, so both are wrapped. A wrapper, so the overlay hands over
 * the same props it always did: the question's notice goes where the overlay
 * already sends the chat's own failures (`reportBackgroundTaskFailure` is the
 * overlay's `onSendFailure`).
 */
export function MobileNativeChatShellConfirmView(
  props: ComponentProps<typeof MobileNativeChatView>
): React.JSX.Element {
  // Asked only where `!` reaches an EMPTY agent input: a structured session's sends go to the
  // API, and a send with a photo or a file pastes it first, so the text is not at the start.
  const typedIntoEmptyInput = !props.structuredActivityUi && !props.attachments?.length
  const agent = typedIntoEmptyInput ? props.agent : null
  const send = useMobileNativeChatShellCommandConfirm(
    agent,
    props.onSend,
    props.reportBackgroundTaskFailure
  )
  const answer = useMobileNativeChatShellCommandConfirm(
    agent,
    props.onAnswerQuestion ?? NO_ANSWER,
    props.reportBackgroundTaskFailure
  )
  return (
    <>
      <MobileNativeChatView
        {...props}
        onSend={send.send}
        onAnswerQuestion={props.onAnswerQuestion ? answer.send : undefined}
      />
      {send.confirm}
      {answer.confirm}
    </>
  )
}
