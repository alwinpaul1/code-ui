// Single source of truth for native chat slash-command behavior, shared by the
// desktop renderer and the mobile app. This is pure data + string helpers (no
// DOM, no RN-only imports), so both platforms import the SAME values — no
// mirrored copy to drift, unlike the agent-specific parsers in src/shared that
// Metro forces us to duplicate.

import type { AgentType } from './agent-status-types'

export type SlashCommandSuggestion = {
  /** The command token without its leading slash, e.g. `clear`. */
  name: string
  /** Optional one-line description for the suggestion row. */
  description?: string
}

// Best-effort, curated per-agent catalogs. The CLIs ship no machine-readable
// command list, so these track the common, stable commands each TUI documents.
// The composer treats commands as plain data, so this can grow freely.

const COMMON_COMMANDS: readonly SlashCommandSuggestion[] = [
  { name: 'clear', description: 'Clear the conversation' },
  { name: 'help', description: 'Show available commands' }
]

// Claude Code's built-in commands, taken from the CLI's own command table
// (2.1.261) so the `/` menu lists what the terminal lists. Frequently used
// entries lead; the rest follow alphabetically. Installed skills and plugin
// commands come from the host's skill scan at runtime, not from here.
const CLAUDE_COMMANDS: readonly SlashCommandSuggestion[] = [
  { name: 'clear', description: 'Start a new session with empty context' },
  { name: 'compact', description: 'Free up context by summarizing the conversation so far' },
  { name: 'model', description: 'Set the AI model for Claude Code' },
  { name: 'loop', description: 'Run a prompt or slash command on a recurring interval' },
  { name: 'plan', description: 'Enable plan mode or view the current session plan' },
  { name: 'resume', description: 'Resume a previous conversation' },
  { name: 'init', description: 'Initialize a CLAUDE.md with codebase documentation' },
  { name: 'review', description: 'Review the current changes' },
  { name: 'help', description: 'Show help and available commands' },
  { name: 'add-dir', description: 'Add a new working directory' },
  { name: 'advisor', description: 'Let Claude consult a stronger model at key moments' },
  { name: 'agents', description: 'Manage subagents' },
  { name: 'artifacts', description: 'Browse your published and shared artifacts' },
  { name: 'auto-mode-setup', description: 'Teach auto mode about your environment' },
  { name: 'autocompact', description: 'Set how full the context gets before auto-summarizing' },
  { name: 'autofix-pr', description: 'Monitor and autofix any issues with the current PR' },
  { name: 'branch', description: 'Create a branch of the current conversation at this point' },
  { name: 'brief', description: 'Toggle brief-only mode' },
  { name: 'btw', description: 'Ask a quick side question without interrupting the main conversation' },
  { name: 'bug', description: 'Report a bug or share your conversation' },
  { name: 'cd', description: 'Move this session to a new working directory' },
  { name: 'chrome', description: 'Open Claude in Chrome settings' },
  { name: 'code-review', description: 'Review the changes on the current branch' },
  { name: 'color', description: 'Set the prompt bar color for this session' },
  { name: 'config', description: 'Open settings' },
  { name: 'context', description: 'Visualize current context usage as a colored grid' },
  { name: 'copy', description: "Copy Claude's last response to clipboard" },
  { name: 'daemon', description: 'Manage background services and routines' },
  { name: 'design', description: 'Create a design canvas' },
  { name: 'desktop', description: 'Continue the current session in Claude Desktop' },
  { name: 'diff', description: 'Show the working diff' },
  { name: 'doctor', description: 'Diagnose and verify your Claude Code installation' },
  { name: 'effort', description: 'Set effort level for model usage' },
  { name: 'exit', description: 'Exit Claude Code' },
  { name: 'export', description: 'Export the current conversation to a file or clipboard' },
  { name: 'fast', description: 'Toggle fast mode' },
  { name: 'feedback', description: 'Send feedback to Anthropic or report a bug' },
  { name: 'fewer-permission-prompts', description: 'Add a prioritized allowlist to reduce permission prompts' },
  { name: 'focus', description: 'Toggle focus view: just your prompt, summary, and response' },
  { name: 'fork', description: 'Copy this conversation into a new background session' },
  { name: 'goal', description: 'Set a goal Claude checks before stopping' },
  { name: 'hooks', description: 'View hook configurations for tool events' },
  { name: 'ide', description: 'Manage IDE integrations and show status' },
  { name: 'import', description: 'Import config from another AI coding agent' },
  { name: 'insights', description: 'Generate a report analyzing your Claude Code sessions' },
  { name: 'install-github-app', description: 'Set up Claude GitHub Actions for a repository' },
  { name: 'install-slack-app', description: 'Install the Claude Slack app' },
  { name: 'keybindings', description: 'Open your keyboard shortcuts file' },
  { name: 'keybindings-help', description: 'Customize keyboard shortcuts' },
  { name: 'login', description: 'Sign in to your Anthropic account' },
  { name: 'logout', description: 'Sign out from your Anthropic account' },
  { name: 'loops', description: 'List, create, and delete loops' },
  { name: 'mcp', description: 'Manage MCP servers' },
  { name: 'memory', description: 'Edit CLAUDE.md files and memory settings' },
  { name: 'passes', description: 'Manage passes' },
  { name: 'permissions', description: 'Manage allow and deny tool permission rules' },
  { name: 'powerup', description: 'Discover Claude Code features through quick interactive lessons' },
  { name: 'privacy-settings', description: 'View and update your privacy settings' },
  { name: 'recap', description: 'Generate a one-line session recap now' },
  { name: 'release-notes', description: 'View release notes' },
  { name: 'reload-plugins', description: 'Activate pending plugin changes in the current session' },
  { name: 'reload-skills', description: 'Pick up skills added or changed on disk during this session' },
  { name: 'remote-control', description: 'Control this session from your phone or claude.ai/code' },
  { name: 'remote-env', description: 'Choose the default environment for cloud agents' },
  { name: 'rename', description: 'Rename the current conversation' },
  { name: 'rewind', description: 'Rewind the conversation and/or code to a previous point' },
  { name: 'run', description: 'Launch and drive this project\'s app to see a change working' },
  { name: 'sandbox', description: 'Manage sandbox settings' },
  { name: 'schedule', description: 'Create and manage scheduled remote Claude Code agents' },
  { name: 'scroll-speed', description: 'Adjust mouse wheel scroll speed' },
  { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch' },
  { name: 'setup-bedrock', description: 'Reconfigure Amazon Bedrock authentication, region, or model pins' },
  { name: 'setup-vertex', description: 'Reconfigure Google Vertex AI authentication, project, region, or model pins' },
  { name: 'simplify', description: 'Review the changed code for reuse, simplification, and efficiency' },
  { name: 'skill-doctor', description: 'Show which loaded skills are unused and costing context' },
  { name: 'skills', description: 'List available skills' },
  { name: 'statusline', description: 'Configure the status line' },
  { name: 'status', description: 'Show Claude Code status: version, model, account, connectivity' },
  { name: 'stop', description: 'Stop this background session; transcript and worktree are kept' },
  { name: 'subtask', description: 'Send a subagent off with your full context; its result comes back here' },
  { name: 'tasks', description: 'View and manage everything running in the background' },
  { name: 'team-onboarding', description: 'Help teammates ramp on Claude Code with a guide from your usage' },
  { name: 'teleport', description: 'Send this session to the cloud, or resume one from claude.ai' },
  { name: 'terminal-setup', description: 'Configure terminal key bindings' },
  { name: 'theme', description: 'Change the theme' },
  { name: 'todos', description: 'List current todo items' },
  { name: 'tui', description: 'Set the terminal UI renderer (default | fullscreen)' },
  { name: 'ultraplan', description: 'Claude Code on the web drafts a plan you can edit and approve' },
  { name: 'ultrareview', description: 'Find and verify bugs in your branch using Claude Code on the web' },
  { name: 'update-config', description: 'Configure Claude Code settings, hooks, and permissions' },
  { name: 'upgrade', description: 'Upgrade to Max for higher rate limits and more Opus' },
  { name: 'usage', description: 'Show plan usage limits' },
  { name: 'usage-credits', description: 'Configure usage credits or request them from your admin' },
  { name: 'version', description: 'Print the version this session is running' },
  { name: 'voice', description: 'Toggle voice mode' },
  { name: 'web-setup', description: 'Set up Claude Code on the web with your GitHub account' },
  { name: 'workflows', description: 'Browse running and completed workflows' }
]

const CODEX_COMMANDS: readonly SlashCommandSuggestion[] = [
  { name: 'model', description: 'Choose the model and reasoning effort' },
  { name: 'ide', description: 'Include IDE context' },
  { name: 'permissions', description: 'Choose what Codex is allowed to do' },
  { name: 'keymap', description: 'Remap TUI shortcuts' },
  { name: 'vim', description: 'Toggle Vim mode' },
  { name: 'experimental', description: 'Toggle experimental features' },
  { name: 'approve', description: 'Approve one auto-review retry' },
  { name: 'memories', description: 'Configure memory use' },
  { name: 'skills', description: 'Manage and use skills' },
  { name: 'import', description: 'Import setup from Claude Code' },
  { name: 'hooks', description: 'View lifecycle hooks' },
  { name: 'review', description: 'Review the current changes' },
  { name: 'rename', description: 'Rename the current thread' },
  { name: 'new', description: 'Start a new chat' },
  { name: 'archive', description: 'Archive this session and exit' },
  { name: 'delete', description: 'Delete this session and exit' },
  { name: 'resume', description: 'Resume a saved chat' },
  { name: 'fork', description: 'Fork the current chat' },
  { name: 'app', description: 'Continue in Codex Desktop' },
  { name: 'init', description: 'Create an AGENTS.md file' },
  { name: 'compact', description: 'Compact the conversation' },
  { name: 'plan', description: 'Switch to Plan mode' },
  { name: 'goal', description: 'Set or view the goal' },
  { name: 'agent', description: 'Switch the active agent thread' },
  { name: 'side', description: 'Start a side conversation' },
  { name: 'copy', description: 'Copy the last response as markdown' },
  { name: 'raw', description: 'Toggle raw scrollback mode' },
  { name: 'diff', description: 'Show the working diff' },
  { name: 'mention', description: 'Mention a file' },
  { name: 'status', description: 'Show session configuration and usage' },
  { name: 'usage', description: 'View account usage' },
  { name: 'title', description: 'Configure the terminal title' },
  { name: 'statusline', description: 'Configure the status line' },
  { name: 'theme', description: 'Choose a syntax highlighting theme' },
  { name: 'pets', description: 'Choose or hide the terminal pet' },
  { name: 'mcp', description: 'List configured MCP tools' },
  { name: 'plugins', description: 'Browse plugins' },
  { name: 'logout', description: 'Log out of Codex' },
  { name: 'exit', description: 'Exit Codex' },
  { name: 'feedback', description: 'Send logs to maintainers' },
  { name: 'ps', description: 'List background terminals' },
  { name: 'stop', description: 'Stop all background terminals' },
  { name: 'clear', description: 'Clear the terminal and start a new chat' },
  { name: 'personality', description: 'Choose a communication style' },
  { name: 'subagents', description: 'Switch the active agent thread' }
]

const COMMANDS_BY_AGENT: Partial<Record<AgentType, readonly SlashCommandSuggestion[]>> = {
  claude: CLAUDE_COMMANDS,
  openclaude: CLAUDE_COMMANDS,
  codex: CODEX_COMMANDS
}

/** Known slash commands for an agent, falling back to a small common set so the
 *  `/` menu is never empty for a recognized agent. */
export function getAgentSlashCommands(agent: AgentType): readonly SlashCommandSuggestion[] {
  return COMMANDS_BY_AGENT[agent] ?? COMMON_COMMANDS
}

/** Whether the draft is a slash command (leading `/`, ignoring leading space).
 *  Slash drafts dispatch to the agent's own TUI and must NOT render an optimistic
 *  user bubble — they are control actions, not chat turns. */
export function isSlashCommandDraft(draft: string): boolean {
  return isSlashCommandToken(draft.trimStart().split(/\s/, 1)[0] ?? '')
}

/** A command token is `/name` — letters, digits, `-`, `_`, `:` (plugin skills),
 *  `.` — with no further slash. A leading absolute path ("/var/folders/…/x.png",
 *  the text a desktop image paste puts first; "/usr/bin/python …") has more
 *  slashes and is prose: dispatching it as a command sent it raw to the TUI and
 *  flipped the tab to the terminal. */
export function isSlashCommandToken(token: string): boolean {
  return /^\/[A-Za-z][\w:.-]*$/.test(token)
}

/** Case-insensitive prefix filter over an agent's commands. An empty query
 *  returns all commands so a bare `/` shows the full menu. */
export function filterSlashCommands(
  commands: readonly SlashCommandSuggestion[],
  query: string
): SlashCommandSuggestion[] {
  const normalized = query.toLowerCase()
  if (normalized === '') {
    return [...commands]
  }
  return commands.filter((command) => command.name.toLowerCase().startsWith(normalized))
}

/** Replace the slash token with the chosen command plus a trailing space, so the
 *  user can type arguments. This is the Tab-completion path. */
export function applySlashSuggestion(command: SlashCommandSuggestion): string {
  return `/${command.name} `
}

/** Text to send when Enter accepts a slash command from the menu — no trailing
 *  space, because the TUI dispatches the command on Enter. */
export function slashCommandDispatchText(command: SlashCommandSuggestion): string {
  return `/${command.name}`
}

export type NativeChatSendClassification = 'chat' | 'command' | 'unknown-token'

export function classifyNativeChatSend(
  draft: string,
  commands: readonly SlashCommandSuggestion[],
  pickerSkillOriginToken: string | null,
  skillPrefix: '/' | '$' | null
): NativeChatSendClassification {
  // Why: the supported TUIs only treat a line-leading token as a command, so a
  // draft with leading whitespace is prose; trimming here would claim a "Ran"
  // line for text the agent never dispatched.
  const firstToken = draft.split(/\s/, 1)[0] ?? ''
  if (pickerSkillOriginToken && firstToken === pickerSkillOriginToken) {
    return 'chat'
  }
  if (commands.some((command) => firstToken === `/${command.name}`)) {
    return 'command'
  }
  if (isSlashCommandToken(firstToken)) {
    return 'unknown-token'
  }
  // Why: `$` is Codex grammar only. For other agents a leading `$PATH`-style
  // token is ordinary prose and must keep its bubble and attachments.
  if (skillPrefix === '$' && firstToken.startsWith('$')) {
    return 'unknown-token'
  }
  return 'chat'
}
