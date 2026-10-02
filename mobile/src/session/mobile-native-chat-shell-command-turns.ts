import { isTextBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'

/** A turn that is exactly one `<bash-input>` envelope (Claude Code writes a `!` command so, one
 *  turn each; the output is the next turn). Anything around the tags is not this shape. */
const BASH_INPUT = /^<bash-input>([\s\S]*)<\/bash-input>$/

/**
 * A `!` command the user ran is the user's turn, and the phone draws it as one:
 * `!ls -la`, the text the phone sent for it (or `! git status` as typed).
 *
 * Orca's noise filter (vendored, never edited here) hides every harness tag
 * (harness-injected-user-turns.ts), `<bash-input>` among them, so a confirmed command was in
 * the chat nowhere, and the send's own copy of it could never be seen to land
 * (mobile-native-chat-shell-command-turns.test.ts). Only the `<bash-input>` turn is surfaced:
 * its output turn (`<bash-stdout>`, `<bash-stderr>`) stays hidden, since a bubble carrying the
 * output would no longer match the text the phone sent and its own copy would draw twice. The
 * command is kept as stored, a leading space included, so the words match what was typed.
 * Like surfaceCommandTurns, it runs before the noise filter. It runs in the chat lane (use-mobile-
 * native-chat-session-lane.ts), so the render and every reconciler that retires the phone's own
 * copy of a send read the same `!cmd` turn; the render's own call finds nothing left to surface.
 */
export function surfaceShellCommandTurns(
  messages: readonly NativeChatMessage[]
): NativeChatMessage[] {
  let out: NativeChatMessage[] | null = null
  messages.forEach((message, index) => {
    const surfaced = message.role === 'user' ? surfacedCommand(message) : null
    if (surfaced) {
      out ??= messages.slice(0, index)
      out.push(surfaced)
    } else {
      out?.push(message)
    }
  })
  return out ?? (messages as NativeChatMessage[])
}

function surfacedCommand(message: NativeChatMessage): NativeChatMessage | null {
  const texts = message.blocks.filter(isTextBlock)
  if (texts.length !== 1 || message.blocks.length !== 1) {
    return null
  }
  const command = BASH_INPUT.exec(texts[0]!.text.trim())?.[1]
  if (command === undefined || command.trim() === '') {
    return null
  }
  return { ...message, blocks: [{ ...texts[0]!, text: `!${command}` }] }
}
