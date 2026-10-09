import { describeActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import type { NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { foldWhitespace, readString } from './mobile-background-task-transcript'

/** What a screen reader hears on the collapsed row of a call that still runs.
 *  The row draws only "Running" (the Claude app's own, 2026-10-09), so the
 *  words that tell WHAT runs live here: "Running command, <description>" for a
 *  shell call (Claude Code's Bash `description`, else the command), and
 *  "Running <tool>, <argument>" for any other. */
export function runningCallAccessibilityLabel(call: NativeChatToolCallBlock): string {
  const { toolName, preview, isCommand } = describeActiveToolCall(call)
  const description = readString(call.input, 'description')
  const detail = description ? foldWhitespace(description) : preview
  const subject = isCommand ? 'command' : toolName
  return detail ? `Running ${subject}, ${detail}` : `Running ${subject}`
}
