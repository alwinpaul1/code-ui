import type { MobileChatPermission } from '../session/mobile-native-chat-permission'

/**
 * When a permission notification does not offer Approve.
 *
 * The Claude Android app builds the actions in i09.java (1.261009.20): Approve is drawn only when
 * `c(tool)` holds, and that is false for a request with no tool name, for AskUserQuestion and
 * ExitPlanMode (the set `i09.a`), and for the tools in `r45.b` (mcp__hearthbot__place_call,
 * delete_project, start_routine, delete_project_file), which are Anthropic's own. Deny and Deny
 * with comment are always there. The same idea here: a request that should not be one tap in the
 * shade, because there is a plan to read, a question to answer, or something that deletes or
 * cannot be undone. The banner's body still opens the session.
 *
 * Withholding is the cautious side of a heuristic. A request this does not recognise is approved
 * from the shade as it always was, and Claude Code's own dialog (and the in-app card) still ask
 * before anything runs; what the shade stops offering is the one-tap yes.
 */
export type ApproveWithheldReason = 'plan' | 'question' | 'destructive' | 'unknown-tool'

/** The tool a permission asks about, from the approval envelope's title ("Allow Bash?"), or null
 *  for a title that is not that. */
export function toolNameOfPermission(permission: Pick<MobileChatPermission, 'title'>): string | null {
  const match = /^Allow (\S+)\?$/.exec(permission.title.trim())
  return match ? match[1]! : null
}

/** An MCP tool whose action is a deletion or a call out into the world, by the verb in its own
 *  name: the shape of `r45.b` (place_call, delete_project, start_routine, delete_project_file). */
const DESTRUCTIVE_MCP_ACTION =
  /(?:^|_)(?:delete|destroy|remove|purge|wipe|erase|drop|place_call|start_routine)(?:_|$)/

/** A tool's own name as snake_case words, whatever it is written in: `delete_project`,
 *  `deleteRepository`, `notion-delete-page` all read as words joined by underscores. */
function actionWords(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase()
}

/** A shell tool: the only kind whose command can be read for what it does. */
const SHELL_TOOL = /^(?:bash|shell|powershell|exec|exec_command|local_shell)$/i

// A command is taken whole, chains and pipes included. A word counts at the start of the command
// or after a shell separator, with or without the path it is run by (`/bin/rm`), so `grep "rm"`,
// `echo firm` and `./rm-helper.sh` do not.
const AT_COMMAND = String.raw`(?:^|[\s;&|(\x60])(?:\S*/)?`
const DESTRUCTIVE_COMMANDS: readonly RegExp[] = [
  new RegExp(`${AT_COMMAND}(?:sudo|doas)(?=\\s)`),
  new RegExp(`${AT_COMMAND}(?:rm|rmdir|unlink|shred|dd|truncate|wipefs|mkfs(?:\\.\\w+)?|diskutil)(?=\\s|$)`),
  new RegExp(`${AT_COMMAND}(?:kill|pkill|killall)(?=\\s|$)`),
  // A push that overwrites or deletes: a force flag, --delete or -d, a `+ref`, a `:ref`.
  /\bgit\s+push\b[^;&|]*\s(?:--force(?:-with-lease)?\b|-f\b|--delete\b|-d\b|\+\S|:\S)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b/,
  // A checkout that overwrites the working tree: `.`, `-- <path>`, or forced.
  /\bgit\s+checkout\s+(?:[^;&|]*\s)?(?:--\s|-f\b|--force\b|\.(?=\s|$))/,
  /\bgit\s+branch\s+(?:\S+\s+)*(?:-[a-zA-Z]*[dD]\b|--delete\b)/,
  /\bgit\s+stash\s+(?:drop|clear)\b/,
  /\bfind\b[^;&|]*\s-delete\b/,
  /\b(?:chmod|chown)\s+-\S*R/,
  /\b(?:docker|podman)\s+(?:system\s+prune|container\s+prune|image\s+prune|volume\s+(?:rm|prune)|rm|rmi)\b/,
  /\bkubectl\s+delete\b/,
  /\bterraform\s+destroy\b/,
  /\bgh\s+\w+\s+delete\b/,
  /\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b/
]

/** SQL that drops or deletes counts only in a command that runs a SQL client: `grep "DELETE FROM"`
 *  over a migration, or an `echo`, deletes nothing. */
const SQL_CLIENT = /\b(?:psql|mysql|mariadb|sqlite3|sqlcmd|duckdb|clickhouse-client|mongosh|redis-cli)\b/
const DESTRUCTIVE_SQL = /\b(?:(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE|SCHEMA|INDEX)|DELETE\s+FROM)\b/i

/** `git restore` throws away changes in the working tree; `--staged` alone only unstages. */
function restoresWorkingTree(command: string): boolean {
  const restore = /\bgit\s+restore\b([^;&|]*)/.exec(command)
  if (!restore) {
    return false
  }
  const flags = restore[1]!
  const unstagesOnly = /(?:^|\s)(?:--staged|-S)\b/.test(flags) && !/(?:^|\s)(?:--worktree|-W)\b/.test(flags)
  return !unstagesOnly
}

/** Whether a request deletes or cannot be undone, by the tool's name (an MCP tool) or, for a
 *  shell, by its command. False when there is nothing to read: a request is not called
 *  destructive on a guess. */
export function isDestructiveToolRequest(tool: string, command: string | undefined): boolean {
  if (tool.startsWith('mcp__')) {
    return DESTRUCTIVE_MCP_ACTION.test(actionWords(tool.slice(tool.lastIndexOf('__') + 2)))
  }
  if (!SHELL_TOOL.test(tool) || !command) {
    return false
  }
  return (
    DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(command)) ||
    restoresWorkingTree(command) ||
    (SQL_CLIENT.test(command) && DESTRUCTIVE_SQL.test(command))
  )
}

/** Why Approve is not offered for this permission, or null when it is. */
export function approveWithheldReason(permission: MobileChatPermission): ApproveWithheldReason | null {
  const tool = toolNameOfPermission(permission)
  if (tool === null) {
    return 'unknown-tool'
  }
  if (tool === 'ExitPlanMode') {
    return 'plan'
  }
  if (tool === 'AskUserQuestion') {
    return 'question'
  }
  return isDestructiveToolRequest(tool, (permission.command ?? permission.detail)?.trim()) ? 'destructive' : null
}
