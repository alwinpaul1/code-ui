import { isCommandToolName } from '../../../src/shared/native-chat-tool-activity'
import {
  nativeChatToolCategory,
  type NativeChatToolCategory
} from '../../../src/shared/native-chat-tool-icon'

/** What a tool call did to the reader, the unit the run sentence
 *  (mobile-native-chat-tool-sentence.ts) groups and counts by. */
export type ToolRunKind =
  | 'command'
  | 'read'
  | 'edit'
  | 'search'
  | 'agent'
  | 'web'
  | 'skill'
  | 'message'
  | 'other'

/** What Orca's own tool vocabulary (vendored `nativeChatToolCategory`) says a
 *  name did, for a name the phone's lists below do not know. */
const KIND_BY_CATEGORY: Record<NativeChatToolCategory, ToolRunKind> = {
  read: 'read',
  search: 'search',
  listFiles: 'search',
  unknown: 'command',
  fileChange: 'edit',
  webSearch: 'web',
  mcpToolCall: 'other',
  subAgentActivity: 'agent',
  todoList: 'other',
  other: 'other'
}

export function toolCallKind(name: string): ToolRunKind {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^.*[./]/, '')
  // Orca's own list of command tools as well (vendored COMMAND_TOOL_NAMES):
  // Codex runs commands as exec_command and shell_command, which read "Used 2
  // tools" beside a Bash run's "Ran 2 commands" while only these were known
  // (review, 2026-09-30). write_stdin writes to a running exec_command
  // session (codex-rs/core/src/tools/handlers/shell_spec.rs, rust-v0.153.4).
  if (/^(bash|shell|exec|run_command|terminal|command|powershell|write_stdin)$/.test(key) || isCommandToolName(key)) {
    return 'command'
  }
  // view_image is Codex's "View a local image file from the filesystem".
  if (/^(read|read_file|readfile|cat|view|notebookread|view_image)$/.test(key)) {
    return 'read'
  }
  if (/^(edit|write|multiedit|notebookedit|apply_patch|create_file|write_file|patch)$/.test(key)) {
    return 'edit'
  }
  if (/^(grep|glob|search|list|ls|find|rg|list_dir)$/.test(key)) {
    return 'search'
  }
  if (/^(agent|task|subagent|spawn_agent)$/.test(key)) {
    return 'agent'
  }
  if (/^(webfetch|websearch|fetch|browse|web_search|web_fetch)$/.test(key)) {
    return 'web'
  }
  if (/^skill$/.test(key)) {
    return 'skill'
  }
  if (/^(sendmessage|send_message)$/.test(key)) {
    return 'message'
  }
  // Then every name Orca's vocabulary knows, so the phone cannot miss one of
  // them one name at a time again: Codex's `local_shell` read "Used 2 tools"
  // and its `Diff` file changes "Used a tool" while the vendored code already
  // named them a shell call and a file change (review, 2026-09-30).
  const category = nativeChatToolCategory(key)
  return category ? KIND_BY_CATEGORY[category] : 'other'
}
