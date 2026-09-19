import { isTextBlock, type NativeChatBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  parseNativeChatCommandEnvelope,
  surfaceSkillInvocationUserTurns
} from '../../../src/shared/native-chat-command-envelope'

/**
 * A slash command the session ran is the user's turn, and the phone draws it
 * as one: `/loop and check job 2888`, where the transcript has it.
 *
 * Claude Code writes a slash input as a command envelope
 * (`<command-name>/loop</command-name><command-args>…`), which the shared
 * noise filter hides. The desktop can afford that: it draws a local `Ran /x`
 * line for the commands it sent itself. The phone has no such line, and it
 * was drawing the turn anyway — from the hook-fed prompt echo, anchored by the
 * tab status's clock, which is not the prompt's time. A `/loop` wake-up fired
 * at 21:41 landed above the reply written at 21:27 (device, 2026-09-19). The
 * transcript row is in order by construction, and once it is a user turn the
 * echo retires against it and the tool fold breaks at it, as the Claude app
 * shows ("/loop", then "Ran Check job 2888 now").
 *
 * Every envelope is surfaced, catalog commands included: upstream keeps those
 * for its `Ran` marker, which the phone does not have. The `isMeta` row that
 * carries the skill's own text never reaches the phone — Orca's reader drops
 * it — and the other harness rows (local-command output, reminders) stay
 * hidden.
 */
const NO_CATALOG: ReadonlySet<string> = new Set()

export function surfaceCommandTurns(messages: readonly NativeChatMessage[]): NativeChatMessage[] {
  return surfaceSkillInvocationUserTurns(messages.map(withEnvelopeBesideImages), NO_CATALOG)
}

/** Upstream surfaces an envelope only when every block is text, so a command
 *  sent with a photo stayed hidden and the photo went with it (review,
 *  2026-09-19). Rewrite the envelope text in place and keep the other blocks;
 *  the upstream pass then leaves the row alone, already surfaced. */
function withEnvelopeBesideImages(message: NativeChatMessage): NativeChatMessage {
  if (message.role !== 'user' || message.blocks.every(isTextBlock)) {
    return message
  }
  const envelope = parseNativeChatCommandEnvelope(
    message.blocks.filter(isTextBlock).map((block) => block.text).join('\n')
  )
  if (!envelope) {
    return message
  }
  const token = `/${envelope.name.replace(/^\//, '').split(':').at(-1) ?? ''}`
  const surfaced = envelope.args ? `${token} ${envelope.args}` : token
  let replaced = false
  const blocks: NativeChatBlock[] = []
  for (const block of message.blocks) {
    if (!isTextBlock(block)) {
      blocks.push(block)
    } else if (!replaced) {
      replaced = true
      blocks.push({ ...block, text: surfaced })
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
