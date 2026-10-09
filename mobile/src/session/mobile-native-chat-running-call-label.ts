import { describeActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { mcpToolIdentity } from '../../../src/shared/native-chat-tool-identity'
import type { NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { agentTitle, foldWhitespace, readString } from './mobile-background-task-transcript'
import { isAgentToolName } from './mobile-native-chat-agent-run'

/** What a screen reader hears on the collapsed row of a call that still runs.
 *  The row draws only "Running" (the Claude app's own, 2026-10-09), so the
 *  words that tell WHAT runs live here, in the words the rows use and never a
 *  raw call name: "Running command, <description>" for a shell call (Claude
 *  Code's Bash `description`, else the command), "Running agent, <description>"
 *  for an Agent or Task call (as the agent row's "Running agent: …"),
 *  "Running get file metadata, <argument>" for an MCP tool, and "Running <tool>,
 *  <argument>" for any other. */
export function runningCallAccessibilityLabel(call: NativeChatToolCallBlock): string {
  const { toolName, preview, isCommand } = describeActiveToolCall(call)
  if (isAgentToolName(call.name)) {
    const named =
      readString(call.input, 'description') ?? readString(call.input, 'name') ?? readString(call.input, 'subagent_type')
    return named ? `Running agent, ${agentTitle(call.input)}` : 'Running agent'
  }
  const description = readString(call.input, 'description')
  const detail = description ? foldWhitespace(description) : preview
  const subject = isCommand ? 'command' : (mcpToolIdentity(call.name)?.tool ?? toolName)
  return detail ? `Running ${subject}, ${detail}` : `Running ${subject}`
}
