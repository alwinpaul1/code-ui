import type { NativeChatToolCallBlock, NativeChatToolResultBlock } from '../../../src/shared/native-chat-types'
import { inputsOf, primitiveInput, stringInput, unreachable } from './claude-live-tool-inputs'
import { sendMessageKind, sendMessageSummary, sendMessageVerb } from './claude-live-tool-send-message'

// The live tool row's label (com.anthropic.claude 1.261013.20): the call's present-tense verb
// (`bw30.f`, single-bw30 bw30.java:688-881) and its detail (y07.java:879-903, `ei4.g`, `hqz.c`,
// `xpz.a`, `xpz.h`, `xpz.g`), by the app's tool category (`hqz.e`). claude-live-tool-row.ts has
// every line and what is not ported.

/** A Bash command longer than this reads its description instead (y07.java:893). */
export const CLAUDE_TOOL_ROW_COMMAND_MAX = 60

/** `gqz`, the app's tool categories (hqz.java:273, gqz.java:22-46). */
export type ClaudeToolCategory =
  | 'Read'
  | 'Edit'
  | 'NotebookEdit'
  | 'Write'
  | 'Bash'
  | 'Grep'
  | 'Glob'
  | 'Web'
  | 'Todo'
  | 'Task'
  | 'ExitPlanMode'
  | 'Other'

const CATEGORY: Record<string, ClaudeToolCategory> = {
  Read: 'Read',
  Edit: 'Edit',
  MultiEdit: 'Edit',
  str_replace: 'Edit',
  str_replace_based_edit_tool: 'Edit',
  NotebookEdit: 'NotebookEdit',
  Write: 'Write',
  Bash: 'Bash',
  repl: 'Bash',
  Grep: 'Grep',
  Glob: 'Glob',
  WebSearch: 'Web',
  web_search: 'Web',
  WebFetch: 'Web',
  web_fetch: 'Web',
  TodoWrite: 'Todo',
  Task: 'Task',
  Agent: 'Task',
  ExitPlanMode: 'ExitPlanMode'
}

/** `hqz.e`. */
export function claudeToolCategory(name: string): ClaudeToolCategory {
  return Object.hasOwn(CATEGORY, name) ? CATEGORY[name]! : 'Other'
}

/** `xpz.e`: a tool whose detail is a path, drawn as a file name with a middle ellipsis. */
export function claudeToolIsPathLike(name: string): boolean {
  const category = claudeToolCategory(name)
  return category === 'Read' || category === 'Edit' || category === 'NotebookEdit' || category === 'Write'
}

/** `xpz.a` (Task tools), xpz.java:14. */
export const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'])
/** `xpz.b`, xpz.java:15. */
const TOOL_SEARCH = new Set(['ToolSearch', 'tool_search'])

/** `xpz.g`: after the last / or \, or the whole when that leaves nothing. */
export function claudeToolFileName(path: string): string {
  const afterSlash = path.slice(path.lastIndexOf('/') + 1)
  const afterBackslash = afterSlash.slice(afterSlash.lastIndexOf('\\') + 1)
  return afterBackslash.length === 0 ? path : afterBackslash
}

/** `hqz.j` for a tool with no server name: "server: tool" for `mcp__server__tool`, else the name. */
function toolDisplayName(name: string): string {
  const parts = name.split('__')
  if (parts.length >= 3 && parts[0] === 'mcp' && parts[1]!.length > 0) {
    // `ssx.P0(.., limit 3)`: the tool is everything after the second "__".
    const tool = parts.slice(2).join('__')
    if (tool.length > 0) {
      const toolWords = tool.replaceAll('_', ' ')
      const server = parts[1]!
      return server === 'hearthbot' ? toolWords : `${server.replaceAll('_', ' ')}: ${toolWords}`
    }
  }
  return name
}

/** Whether a Write's result says it replaced a file (`hqz.i == "update"`, the result's type). Claude
 *  Code writes "The file … has been updated successfully." for one and "File created successfully
 *  at: …" for a new file. */
function writeWasUpdate(result: NativeChatToolResultBlock | undefined): boolean {
  return result !== undefined && /^The file .* has been updated/.test(result.output)
}

/** `bw30.f` for a Pending call (bw30.java:688-881), the label's verb. */
export function claudeLiveToolVerb(call: NativeChatToolCallBlock, result?: NativeChatToolResultBlock): string {
  const name = call.name
  const map = inputsOf(call)
  if (name === 'SendMessage') {
    return sendMessageVerb(sendMessageKind(map))
  }
  if (name === 'WebFetch' || name === 'web_fetch') {
    return 'Fetching'
  }
  if (name === 'WebSearch' || name === 'web_search') {
    return 'Searching web'
  }
  if (name === 'LS') {
    return 'Listing'
  }
  if (name === 'Skill') {
    return 'Running skill'
  }
  if (TOOL_SEARCH.has(name)) {
    return 'Loading tools'
  }
  if (name === 'Workflow') {
    return 'Running workflow'
  }
  if (name === 'Monitor') {
    return 'Watching background command'
  }
  if (name === 'EnterPlanMode') {
    return 'Entering plan mode'
  }
  if (name === 'AskUserQuestion') {
    return 'Asking'
  }
  if (name === 'SendUserMessage' || name === 'SendUserFile') {
    return 'Sending'
  }
  if (TASK_TOOLS.has(name)) {
    return 'Updating todos'
  }
  const category = claudeToolCategory(name)
  switch (category) {
    case 'Read':
      return 'Reading'
    case 'Edit':
    case 'NotebookEdit':
      return 'Editing'
    case 'Write':
      // The Pending copy keeps the call's result (`opzVar.h`), so a Held Write that replaced a file
      // reads "Editing" (`ccr_write_updated` / `ccr_verb_editing`), a new one "Creating".
      return writeWasUpdate(result) ? 'Editing' : 'Creating'
    case 'Bash':
      return 'Running'
    case 'Grep':
    case 'Glob':
      return 'Searching'
    case 'Web':
      return 'Searching web'
    case 'Todo':
      return 'Updating todos'
    case 'Task':
      return 'Running agent'
    case 'ExitPlanMode':
      return 'Proposing plan'
    case 'Other':
      return `Using ${toolDisplayName(name)}`
    default:
      return unreachable(category)
  }
}

/** `xpz.a` (xpz.java:19-131) for the tools `ei4.g` lets through. */
function inputSummary(call: NativeChatToolCallBlock): string | null {
  const name = call.name
  const map = inputsOf(call)
  if (name === 'TaskCreate' || name === 'TaskUpdate') {
    return stringInput(map, 'subject')
  }
  if (name === 'TodoWrite' || name === 'ExitPlanMode' || TASK_TOOLS.has(name)) {
    return null
  }
  if (name === 'Task' || name === 'Agent') {
    return primitiveInput(map, 'description')
  }
  if (name === 'SendMessage') {
    return sendMessageSummary(sendMessageKind(map))
  }
  if (name === 'Grep' || name === 'Glob') {
    return primitiveInput(map, 'pattern')
  }
  if (claudeToolCategory(name) === 'Read' || claudeToolCategory(name) === 'Edit' || name === 'Write') {
    return primitiveInput(map, 'file_path') ?? primitiveInput(map, 'path')
  }
  if (name === 'NotebookEdit') {
    return primitiveInput(map, 'notebook_path')
  }
  if (name === 'WebSearch' || name === 'web_search') {
    return primitiveInput(map, 'query')
  }
  if (name === 'WebFetch' || name === 'web_fetch') {
    return primitiveInput(map, 'url')
  }
  if (name === 'Bash') {
    return primitiveInput(map, 'command')
  }
  // Every other input name, joined (`z69.B0(map.keySet(), ",")`).
  return Object.keys(map).join(',')
}

/** `hqz.c` (hqz.java:116-185) for the tools `ei4.g` lets through. */
function callSummary(call: NativeChatToolCallBlock): string | null {
  const map = inputsOf(call)
  if (call.name === 'Bash' || call.name === 'repl') {
    const description = primitiveInput(map, 'description')
    if (description !== null && description.trim().length > 0) {
      return description
    }
  }
  if (call.name === 'Workflow') {
    return stringInput(map, 'name') ?? stringInput(map, 'scriptPath')
  }
  return inputSummary(call)
}

/** `ei4.g` (ei4.java:1334-1342): the detail of a tool that is not a Bash command. */
function generalDetail(call: NativeChatToolCallBlock): string | null {
  const name = call.name
  if (claudeToolCategory(name) === 'Other' && name !== 'Workflow' && name !== 'SendMessage' && !TASK_TOOLS.has(name)) {
    return null
  }
  const summary = callSummary(call)
  return summary !== null && summary.length > 0 ? summary : null
}

/** What y07.java:879-903 appends after the verb, or null. */
export function claudeLiveToolDetail(call: NativeChatToolCallBlock): string | null {
  const map = inputsOf(call)
  if (claudeToolCategory(call.name) === 'Bash') {
    const command = stringInput(map, 'command')
    if (command !== null) {
      if (command.includes('\n') || command.length > CLAUDE_TOOL_ROW_COMMAND_MAX) {
        return stringInput(map, 'description') ?? command
      }
      return command
    }
  }
  const detail = generalDetail(call)
  if (detail === null) {
    return null
  }
  return claudeToolIsPathLike(call.name) ? claudeToolFileName(detail) : detail
}

/** The row's whole label: the verb and its detail, "Running pnpm test", "Reading file.ts". */
export function claudeLiveToolLabel(call: NativeChatToolCallBlock, result?: NativeChatToolResultBlock): string {
  const verb = claudeLiveToolVerb(call, result)
  const detail = claudeLiveToolDetail(call)
  return detail === null ? verb : `${verb} ${detail}`
}
