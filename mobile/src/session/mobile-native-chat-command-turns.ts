import { isTextBlock, type NativeChatBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { parseNativeChatCommandEnvelope } from '../../../src/shared/native-chat-command-envelope'

/**
 * A slash command the AGENT answered is the user's turn, and the phone draws
 * it as one: `/loop and check job 2888`, where the transcript has it.
 *
 * Claude Code writes a slash input as a command envelope
 * (`<command-name>/loop</command-name><command-args>…`), which the shared
 * noise filter hides. The desktop can afford that: it draws a local `Ran /x`
 * line for the commands it sent itself. The phone has no such line, and it
 * was drawing the turn anyway — from the hook-fed prompt echo, anchored by
 * the tab status's clock, which is not the prompt's time. A `/loop` wake-up
 * fired at 21:41 landed above the reply written at 21:27 (device,
 * 2026-09-19). The transcript row is in order by construction, and once it
 * is a user turn the echo retires against it and the tool fold breaks at it,
 * as the Claude app shows ("/loop", then "Ran Check job 2888 now").
 *
 * Not every envelope is a turn. `/model opus` and `/effort xhigh` are
 * answered by the CLI itself, and the transcript says so: the row after the
 * envelope is its `<local-command-stdout>` ("Set model to `Opus 5` …").
 * Surfacing those left three bubbles in the chat after a picker change
 * (device, 2026-09-20). So an envelope is drawn only when it carries
 * arguments and no CLI output follows: a prompt to the agent. A bare one is
 * never drawn. `/clear` and `/reload-plugins` write their output as a
 * `system` row that Orca's reader drops, so a bare local command issued
 * mid-turn is followed, on the phone, by the agent's next row and cannot be
 * told from a bare skill the agent answered; the hook echo still shows a
 * bare skill, as it did before. (Row shapes surveyed independently by a
 * second agent across 20 envelopes in 5 sessions, Claude Code
 * 2.1.228–2.1.278; the hook fires for skills and never for local commands,
 * 140 envelopes across this machine's sessions, 2026-09-20.) Upstream's catalog rule is not
 * used: `/loop` is in the catalog, and it is the turn this exists for.
 *
 * The `isMeta` row that carries a skill's own text never reaches the phone —
 * Orca's reader drops it — and the other harness rows stay hidden.
 */
export function surfaceCommandTurns(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
  let out: NativeChatMessage[] | null = null
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    const surfaced = message.role === 'user' ? surfacedTurn(message, messages[index + 1]) : null
    if (surfaced) {
      out ??= messages.slice(0, index)
      out.push(surfaced)
    } else {
      out?.push(message)
    }
  }
  return out ?? (messages as NativeChatMessage[])
}

const LOCAL_COMMAND_OUTPUT = /^\s*<local-command-(?:stdout|stderr)\b/i

function surfacedTurn(
  message: NativeChatMessage,
  next: NativeChatMessage | undefined
): NativeChatMessage | null {
  const texts = message.blocks.filter(isTextBlock)
  if (texts.length === 0) {
    return null
  }
  const envelope = parseNativeChatCommandEnvelope(texts.map((block) => block.text).join('\n'))
  if (!envelope) {
    return null
  }
  // The output row is a user row for most commands and a `system` row
  // (subtype local_command) for `/clear` (Claude Code 2.1.278).
  const nextText =
    next?.role === 'user' || next?.role === 'system'
      ? next.blocks
          .filter(isTextBlock)
          .map((block) => block.text)
          .join('')
      : ''
  if (LOCAL_COMMAND_OUTPUT.test(nextText) || envelope.args.length === 0) {
    return null
  }
  // The token the user sent: a plugin skill is canonicalised to
  // `/plugin:name`, but the picker and the hook carry the short name.
  const token = `/${envelope.name.replace(/^\//, '').split(':').at(-1) ?? ''}`
  const surfacedText = envelope.args ? `${token} ${envelope.args}` : token
  // The envelope text is rewritten in place and any other block — a photo
  // sent with the command — is kept (review, 2026-09-19).
  let replaced = false
  const blocks: NativeChatBlock[] = []
  for (const block of message.blocks) {
    if (!isTextBlock(block)) {
      blocks.push(block)
    } else if (!replaced) {
      replaced = true
      blocks.push({ ...block, text: surfacedText })
    }
  }
  return { ...message, blocks }
}

/** A leading plugin-qualified skill token as the surfaced turn spells it:
 *  `/codex:rescue look…` → `/rescue look…`. The hook echo carries the prompt
 *  as typed, the surfaced row the short token (upstream's rule, since the
 *  picker sends the short name), and compared verbatim a skill typed in full
 *  on the desktop drew twice (review, 2026-09-19). */
export function withShortSkillToken(text: string): string {
  return text.replace(/^(\s*)\/[^\s:/]+:([^\s:]+)/, '$1/$2')
}
