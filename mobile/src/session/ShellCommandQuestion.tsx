import { ConfirmModal } from '../components/ConfirmModal'

/** The most of a command the question shows; the whole of it is still what is sent. */
const SHOWN_COMMAND_CHARS = 400

const shown = (command: string): string =>
  command.length > SHOWN_COMMAND_CHARS ? `${command.slice(0, SHOWN_COMMAND_CHARS)}…` : command

/**
 * "Run on the desktop?" for a chat message that starts with `!`. Drawn by
 * ConfirmModal, so every colour comes from the live theme in both schemes; this
 * file sets none. It is a default export because the hook loads it lazily
 * (use-mobile-native-chat-shell-command-confirm.tsx): the sheet and its button
 * chain are only pulled in the first time a `!` message is sent.
 */
export default function ShellCommandQuestion({
  visible,
  command,
  onRun,
  onCancel
}: {
  /** False while the sheet closes: it stays mounted so its exit is drawn. */
  visible: boolean
  command: string
  onRun: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <ConfirmModal
      visible={visible}
      title="Run on the desktop?"
      message={`This message starts with !, so it runs as a shell command on the desktop, in the session's folder:\n\n${shown(command)}`}
      confirmLabel="Run"
      cancelLabel="Cancel"
      destructive
      onConfirm={onRun}
      onCancel={onCancel}
    />
  )
}
