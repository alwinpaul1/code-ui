/**
 * The worktree-relative paths the three project-config screens read and
 * (attempt to) write. Every one of these is reachable through `files.read` —
 * jailed to the worktree, never an absolute path or a `..` segment — which is
 * why the user (`~/.claude/settings.json`, `~/.claude.json`, `~/.claude/CLAUDE.md`,
 * auto-memory) scope is out of reach from the phone and stays out of every
 * one of these screens.
 */
export const MCP_CONFIG_RELATIVE_PATH = '.mcp.json'

export type PermissionRuleDestination = 'project' | 'local'

export const PERMISSION_SETTINGS_RELATIVE_PATH: Record<PermissionRuleDestination, string> = {
  project: '.claude/settings.json',
  local: '.claude/settings.local.json'
}

/** In the order the extension's memory dialog lists them. */
export const PROJECT_MEMORY_RELATIVE_PATHS = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'CLAUDE.local.md'
] as const

export type ProjectMemoryRelativePath = (typeof PROJECT_MEMORY_RELATIVE_PATHS)[number]

/** Shown once, verbatim, on every one of the three screens. */
export const PROJECT_SCOPE_ONLY_NOTICE =
  'Project scope only. Your user-level Claude settings, ~/.claude.json and auto-memory live outside this worktree and are not reachable from the phone.'
