import { isShellActivityToolCall } from '../../../src/shared/native-chat-tool-icon'
import type { NativeChatToolCallBlock } from '../../../src/shared/native-chat-types'
import { sendMessageAddressee } from './mobile-native-chat-tool-sentence'
import { toolCallKind } from './mobile-native-chat-tool-kind'

// ─── The present-tense verb of a running run's row ──────────────────────────
//
// The Claude app's live row describes the LAST call still running, in the
// present tense, from a fixed table (1.261009.20, decompiled 2026-10-11;
// docs/claude-app-implementation-notes.md in the main checkout, "The live
// label"): "Running" for a command, "Reading", "Editing", "Creating",
// "Searching", "Searching web", "Fetching", "Running skill", "Loading tools",
// "Updating todos", "Asking", "Messaging @name", and "Using <tool>" for
// anything else. Agents are their own row ("Running agent: <description>").

const BY_NAME: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  NotebookEdit: 'Editing',
  Write: 'Creating',
  Grep: 'Searching',
  Glob: 'Searching',
  LS: 'Listing',
  WebSearch: 'Searching web',
  web_search: 'Searching web',
  WebFetch: 'Fetching',
  web_fetch: 'Fetching',
  Skill: 'Running skill',
  Workflow: 'Running workflow',
  Monitor: 'Watching background command',
  ToolSearch: 'Loading tools',
  TodoWrite: 'Updating todos',
  ExitPlanMode: 'Proposing plan',
  EnterPlanMode: 'Entering plan mode',
  AskUserQuestion: 'Asking',
  SendUserMessage: 'Sending',
  SendUserFile: 'Sending',
  Agent: 'Running agent',
  Task: 'Running agent'
}

/** What a running row says for `call`. */
export function runningCallVerb(call: NativeChatToolCallBlock): string {
  // The call's input, not its word: Codex names a classified shell row
  // `read`/`search`/`list` and keeps the command it ran, and that is a command
  // running; Claude's `Read` shares the word and ran none.
  if (isShellActivityToolCall(call)) {
    return 'Running'
  }
  const named = BY_NAME[call.name]
  if (named) {
    return named
  }
  const kind = toolCallKind(call.name)
  if (kind === 'command') {
    return 'Running'
  }
  if (kind === 'message') {
    const to = sendMessageAddressee(call.input)
    return to ? `Messaging ${to}` : 'Messaging agent'
  }
  return `Using ${call.name}`
}
