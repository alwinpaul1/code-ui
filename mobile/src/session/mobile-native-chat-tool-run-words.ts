import { soleCallCreatedFile, type ToolRunPair } from './mobile-native-chat-edited-files'
import { toolCallKind } from './mobile-native-chat-tool-kind'
import { editFilesForToolCall } from './mobile-native-chat-tool-run-diff-stat'
import { toolCallPath } from './tool-call-path-keys'

// ─── The Claude app's words for a run of tool calls ──────────────────────────
//
// Claude Android 1.261013.20 (decompiled 2026-10-15; class names are that
// build's R8 names). A run's sentence counts its calls by the app's twelve
// categories (enum `gqz`, chosen by tool name in `hqz.e`): Read, Edit,
// NotebookEdit, Write, Bash, Grep, Glob, Web (WebFetch and WebSearch), Todo
// (TodoWrite), Task (Agent, Task), ExitPlanMode, and Other for everything else,
// a Skill or a SendMessage included. Each category is one plural of
// plurals.xml (`nw30.h`): `ccr_summary_read` "Read a file" / "Read ^1 files",
// `ccr_summary_grep` "Searched code" for one and for many, and so on, below.
// A run of ONE call reads instead as a verb and that call's own target
// (`hqz.c` → `xpz.a`): an Edit's file, a Grep's pattern, "/skill", an agent's
// description, a task's subject.

/** The app's categories, in its enum's order. */
export type ToolSummaryKind =
  | 'read'
  | 'edit'
  | 'notebook'
  | 'write'
  | 'command'
  | 'grep'
  | 'glob'
  | 'web'
  | 'todo'
  | 'task'
  | 'plan'
  | 'other'

/** `ccr_summary_*`, lower-cased as every part after the first is drawn; `#`
 *  is the count. Grep, Glob, Web, Todo and the plan say the same for one call
 *  and for many. */
export const TOOL_SUMMARY_WORDS: Record<ToolSummaryKind, { one: string; many: string }> = {
  read: { one: 'read a file', many: 'read # files' },
  edit: { one: 'edited a file', many: 'edited # files' },
  notebook: { one: 'edited a notebook', many: 'edited # notebooks' },
  write: { one: 'created a file', many: 'created # files' },
  command: { one: 'ran a command', many: 'ran # commands' },
  grep: { one: 'searched code', many: 'searched code' },
  glob: { one: 'found files', many: 'found files' },
  web: { one: 'browsed the web', many: 'browsed the web' },
  todo: { one: 'updated todos', many: 'updated todos' },
  task: { one: 'ran an agent', many: 'ran # agents' },
  plan: { one: 'proposed a plan', many: 'proposed a plan' },
  other: { one: 'used a tool', many: 'used # tools' }
}

function bareName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^.*[./]/, '')
}

/** Which of the app's categories a call counts under. Built on the phone's
 *  own `toolCallKind`, so Codex's names land where their nearest Claude
 *  tool does: a `list_dir` with Glob, an `apply_patch` with Edit. */
export function toolSummaryKind(name: string): ToolSummaryKind {
  const key = bareName(name)
  const kind = toolCallKind(name)
  switch (kind) {
    case 'command':
      return 'command'
    case 'read':
      return 'read'
    case 'edit':
      if (key === 'notebookedit') {
        return 'notebook'
      }
      return /^(write|create_file|write_file)$/.test(key) ? 'write' : 'edit'
    case 'search':
      return /^(glob|ls|list|list_dir|find)$/.test(key) ? 'glob' : 'grep'
    case 'agent':
      return 'task'
    case 'web':
    case 'webSearch':
      return 'web'
    case 'skill':
    case 'message':
      return 'other'
    case 'other':
      if (key === 'todowrite') {
        return 'todo'
      }
      return key === 'exitplanmode' ? 'plan' : 'other'
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** A string input with more than whitespace in it, on one line. */
function oneLine(input: Record<string, unknown> | null, key: string): string | null {
  const value = input?.[key]
  if (typeof value !== 'string') {
    return null
  }
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length > 0 ? line : null
}

function fileName(path: string | null): string | null {
  const name = path?.split(/[/\\]/).pop()?.trim()
  return name ? name : null
}

/** The one file an edit changed, by name: from its own path, else from the
 *  files its patch names (a Codex `apply_patch` carries no path field); null
 *  for a patch of several files. */
function editedFileName(pair: ToolRunPair): string | null {
  const own = fileName(toolCallPath(pair.call.input))
  if (own) {
    return own
  }
  const files = editFilesForToolCall(pair.call, pair.result)
  return files?.length === 1 ? fileName(files[0]!.path) : null
}

/** The first question's `header` of an AskUserQuestion (`hqz.c`). */
function firstQuestionHeader(input: Record<string, unknown> | null): string | null {
  const questions = input?.questions
  const first = Array.isArray(questions) ? record(questions[0]) : null
  return oneLine(first, 'header')
}

/**
 * What a run of exactly one call says, verb and target, or null when the call
 * names nothing the app would read and the category's words stand. A file is
 * named by its name, not its path: a phone row has room for the one and
 * ellipsizes the other into the directory. A SendMessage is the sentence's own
 * (its recipient is drawn in a tone of its own).
 */
export function soleCallWords(pair: ToolRunPair): string | null {
  const { call } = pair
  const input = record(call.input)
  const key = bareName(call.name)
  const target = (verb: string, value: string | null): string | null => (value ? `${verb} ${value}` : null)
  if (key === 'exitplanmode') {
    return 'Proposed plan'
  }
  if (key === 'askuserquestion') {
    return target('Asked', firstQuestionHeader(input))
  }
  if (key === 'taskcreate' || key === 'taskupdate') {
    return target(`Used ${call.name.trim()}`, oneLine(input, 'subject'))
  }
  if (key === 'ls') {
    return target('Listed', oneLine(input, 'path'))
  }
  const kind = toolSummaryKind(call.name)
  switch (kind) {
    case 'command':
      // A Claude Bash call by its description, else by the command itself;
      // Codex's argv-shaped commands keep "Ran a command".
      return target('Ran', oneLine(input, 'description') ?? (key === 'bash' ? oneLine(input, 'command') : null))
    case 'read':
      return target('Read', fileName(toolCallPath(input)))
    case 'edit':
    case 'write':
    case 'notebook':
      // A whole-file write that overwrote is an edit: only a result that says
      // it made the file is taken as a creation (soleCallCreatedFile).
      if (soleCallCreatedFile(pair)) {
        return target('Created', editedFileName(pair)) ?? 'Created a file'
      }
      return target('Edited', editedFileName(pair))
    case 'grep':
    case 'glob':
      return target('Searched', oneLine(input, 'pattern'))
    case 'web':
      return /search/.test(key)
        ? target('Searched web', oneLine(input, 'query'))
        : target('Fetched', oneLine(input, 'url'))
    case 'task':
      return target('Ran agent', oneLine(input, 'description'))
    case 'other': {
      if (key !== 'skill') {
        return null
      }
      const skill = oneLine(input, 'skill')
      // The app names the skill after its last `/` (`xpz.a`).
      return skill ? `Ran skill /${skill.slice(skill.lastIndexOf('/') + 1)}` : 'Ran skill'
    }
    case 'todo':
    case 'plan':
      return null
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}
