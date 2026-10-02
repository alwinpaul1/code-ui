import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { shellCommandOfSend } from './mobile-native-chat-shell-command'

/** Said when a message is a bare `!`: it would switch the agent's desktop input to
 *  shell mode, run nothing, and leave it there. */
export const SHELL_COMMAND_EMPTY_NOTICE = 'Type a command after ! to run it on the desktop.'

type QuestionProps = {
  visible: boolean
  command: string
  onRun: () => void
  onCancel: () => void
}

/** Said when the question could not be loaded: the send is refused, nothing is written and
 *  the draft stays. */
export const SHELL_COMMAND_QUESTION_FAILED =
  'Could not open the question, so the command was not sent. Try again.'

// Loaded the first time a `!` message is sent, and BEFORE the send waits on it: the sheet
// pulls in the button and drawer chain, which a chat that never sends one has no use for
// (and which the many tests that mount the chat with a thin react-native mock do not
// provide). Loaded by hand, not with React.lazy: a failed lazy load throws at render, to
// the root error boundary, taking the whole screen with it.
const loadQuestion = async (): Promise<ComponentType<QuestionProps>> =>
  (await import('./ShellCommandQuestion')).default

type Pending = { text: string; command: string; resolve: (accepted: boolean | Promise<boolean>) => void }

/**
 * Asks before a chat message that starts with `!` is sent, because the agent
 * runs it as a shell command on the desktop (mobile-native-chat-shell-command.ts:
 * how that was read). Run sends the text exactly as typed; Cancel, and any
 * dismissal of the sheet, send nothing and hand back `false`, which leaves the
 * draft in the composer (the composer clears it only for an accepted send). A
 * bare `!` is refused with a notice instead of asked about. Any other message
 * goes straight to `send`.
 *
 * `confirm` is the sheet, to be rendered once beside the composer.
 */
export function useMobileNativeChatShellCommandConfirm(
  agent: string | null | undefined,
  send: (text: string) => Promise<boolean>,
  /** Where a refusal is said (the chat's send-error line); none says nothing. */
  report?: (message: string) => void
): { send: (text: string) => Promise<boolean>; confirm: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null)
  // The sheet stays mounted once it has been asked, so it can draw its exit.
  const [lastCommand, setLastCommand] = useState<string | null>(null)
  const [Question, setQuestion] = useState<ComponentType<QuestionProps> | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const loadingRef = useRef(false)
  const settle = useCallback((accepted: boolean | Promise<boolean>): void => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    // `resolve` takes the promise itself: the question's answer is the send's.
    current?.resolve(accepted)
  }, [])
  useEffect(
    () => () => {
      // The sheet went away with its screen: nothing was confirmed.
      pendingRef.current?.resolve(false)
      pendingRef.current = null
    },
    []
  )

  const guarded = useCallback(
    (text: string): Promise<boolean> => {
      const command = shellCommandOfSend(text, agent)
      if (command === null) {
        return send(text)
      }
      if (command === '') {
        report?.(SHELL_COMMAND_EMPTY_NOTICE)
        return Promise.resolve(false)
      }
      // A second send while one is being asked about replaces nothing: the first stays.
      if (pendingRef.current || loadingRef.current) {
        return Promise.resolve(false)
      }
      loadingRef.current = true
      return loadQuestion().then(
        (loaded) =>
          new Promise<boolean>((resolve) => {
            loadingRef.current = false
            const next = { text, command, resolve }
            pendingRef.current = next
            setQuestion(() => loaded)
            setLastCommand(command)
            setPending(next)
          }),
        () => {
          loadingRef.current = false
          report?.(SHELL_COMMAND_QUESTION_FAILED)
          return false
        }
      )
    },
    [agent, report, send]
  )

  const confirm =
    Question === null || lastCommand === null ? null : (
      <Question
        visible={pending !== null}
        command={lastCommand}
        onRun={() => {
          if (pendingRef.current) {
            settle(send(pendingRef.current.text))
          }
        }}
        onCancel={() => settle(false)}
      />
    )
  return { send: guarded, confirm }
}
