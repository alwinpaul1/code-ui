import { formatNativeChatFileMentionToken } from './mobile-native-chat-file-mention'
import type { FileReaderLineRange } from './mobile-file-reader-line-selection'

/** Best-known agent for the composer the mention is going into. `null` means
 *  unresolved (no live status yet) — treated like Claude Code, the agent this
 *  gesture was ported from. `'codex'` is the one agent confirmed to differ. */
export type FileReaderMentionAgent = string | null

/**
 * The `@file` token VS Code's Alt+K inserts, reusing the composer's own
 * `@path` formatter (`formatNativeChatFileMentionToken`, also what
 * `composerSuggestionInsertText`'s `'file'` case calls) so this never drifts
 * from the format the `@`-autocomplete already produces, plus Claude Code's
 * `#L` line-range suffix: `@path` for the whole file, `@path#L10` for one
 * line, `@path#L10-L20` for a span — both ends carry their own `L`.
 *
 * Codex also resolves `@file` mentions, but `#L` ranges are a Claude Code
 * convention — Codex 0.153's own handling of them isn't documented in this
 * repo's docs/ or memory as of 2026-09-18. Rather than guess, an agent
 * identified as `'codex'` always gets the plain `@path`, range or not.
 */
export function buildFileReaderLineMention(
  relativePath: string,
  range: FileReaderLineRange | null,
  agent: FileReaderMentionAgent
): string {
  const base = formatNativeChatFileMentionToken(relativePath)
  if (!range || agent === 'codex') {
    return base
  }
  return range.start === range.end
    ? `${base}#L${range.start}`
    : `${base}#L${range.start}-L${range.end}`
}
