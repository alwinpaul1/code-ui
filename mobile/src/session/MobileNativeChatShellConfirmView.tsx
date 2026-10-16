import { useCallback, useRef, type ComponentProps } from 'react'
import { MobileNativeChatView, type MobileNativeChatInputLockReason } from './MobileNativeChatView'
import { SHELL_COMMAND_ATTACHMENTS_REFUSAL } from './mobile-native-chat-shell-command'
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
  // Asked only where `!` reaches an agent's terminal input: a structured session's sends go to
  // the API, not a PTY.
  const agent = props.structuredActivityUi ? null : props.agent
  // A composer send with a photo or a file pastes it BEFORE the words, so its `!` lands in a box
  // that is not empty and goes to the model as text ("[Image #100]! node …", 2026-10-16). It
  // used to go out unasked, as a prompt; it is refused instead, with everything kept
  // (SHELL_COMMAND_ATTACHMENTS_REFUSAL says why not split it). Read live, on Run as well as on
  // Send: a chip that lands while the question is open must stop the Run.
  const attachments = useRef(props.attachments)
  attachments.current = props.attachments
  const refuseAttachments = useCallback(
    (): string | null => (attachments.current?.length ? SHELL_COMMAND_ATTACHMENTS_REFUSAL : null),
    []
  )
  const send = useMobileNativeChatShellCommandConfirm(
    agent,
    props.onSend,
    props.reportBackgroundTaskFailure,
    refuseAttachments
  )
  // An answer is typed alone (answerQuestion pastes no chips), so the composer's chips do not
  // change what its `!` does: it is asked about whatever the composer holds.
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
