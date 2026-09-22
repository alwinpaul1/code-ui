import type { SlashCommandSuggestion } from '../../../src/shared/native-chat-slash-commands'

/**
 * Grok Build's own `/` menu.
 *
 * Verified against Grok Build 1.0.40, `~/.grok/docs/user-guide/04-slash-commands.md`
 * (the headings, plus the aliases that page says the menu also lists). The
 * shared catalog leaves Grok empty on purpose. Skills the user enabled live
 * under `~/.grok/skills` and are scanned separately; a missing directory adds
 * nothing here.
 */
const GROK_COMMANDS: readonly (readonly [string, string])[] = [
  ['new', 'Start a fresh session'],
  ['clear', 'Start a fresh session'],
  ['resume', 'Open the session picker'],
  ['dashboard', 'Open the agent dashboard'],
  ['agents-dashboard', 'Open the agent dashboard'],
  ['sessions', 'Open the agent dashboard'],
  ['compact', 'Compress conversation history'],
  ['context', 'Show the context window split'],
  ['session-info', 'Show session details'],
  ['status', 'Show session details'],
  ['info', 'Show session details'],
  ['fork', 'Branch the current session'],
  ['rewind', 'Roll the conversation back'],
  ['undo', 'Roll the conversation back'],
  ['copy', 'Copy the most recent response'],
  ['export', 'Export the conversation'],
  ['quit', 'Quit Grok'],
  ['exit', 'Quit Grok'],
  ['home', 'Return to the welcome screen'],
  ['welcome', 'Return to the welcome screen'],
  ['delete', 'Delete the current session history'],
  ['rename', 'Rename the current session'],
  ['title', 'Rename the current session'],
  ['model', 'Switch models'],
  ['m', 'Switch models'],
  ['effort', 'Set reasoning effort on the current model'],
  ['always-approve', 'Skip all permission prompts'],
  ['auto', 'Let the classifier approve safe tools'],
  ['multiline', 'Toggle multiline input'],
  ['ml', 'Toggle multiline input'],
  ['history', 'Search this session\'s prompts'],
  ['compact-mode', 'Toggle compact display'],
  ['vim-mode', 'Toggle vim-style scrollback keys'],
  ['edit-prompt', 'Open the prompt in an external editor'],
  ['minimal', 'Switch this session to minimal mode'],
  ['fullscreen', 'Switch this session to fullscreen mode'],
  ['full', 'Switch this session to fullscreen mode'],
  ['plan', 'Enter plan mode'],
  ['view-plan', 'Preview the current plan'],
  ['memory', 'Browse saved memories'],
  ['flush', 'Save this session to memory'],
  ['dream', 'Consolidate memories'],
  ['remember', 'Save a note to memory'],
  ['hooks', 'Open hooks'],
  ['plugins', 'Open plugins'],
  ['marketplace', 'Open the plugin marketplace'],
  ['skills', 'Open skills'],
  ['imagine', 'Generate an image'],
  ['imagine-video', 'Generate a video'],
  ['loop', 'Run a prompt on an interval'],
  ['goal', 'Set or check an autonomous goal'],
  ['deep-research', 'Start a background research workflow'],
  ['workflow', 'Launch or manage a workflow'],
  ['workflows', 'List workflows'],
  ['theme', 'Choose a theme'],
  ['feedback', 'Send feedback'],
  ['btw', 'Ask a side question'],
  ['mcps', 'Show MCP servers'],
  ['doctor', 'Check this session for terminal and sandbox issues'],
  ['release-notes', 'Show release notes'],
  ['docs', 'Open the docs'],
  ['tutorial', 'Open the tutorial'],
  ['import-claude', 'Import a Claude setup'],
  ['config-agents', 'Manage agent definitions'],
  ['agents', 'Manage agent definitions'],
  ['personas', 'Manage personas'],
  ['login', 'Log in or re-authenticate'],
  ['logout', 'Log out'],
  ['usage', 'View credit usage'],
  ['privacy', 'Show privacy settings'],
  ['settings', 'Open settings'],
  ['config', 'Open settings'],
  ['preferences', 'Open settings'],
  ['prefs', 'Open settings'],
  ['timestamps', 'Toggle message timestamps']
]

export const GROK_SLASH_COMMANDS: readonly SlashCommandSuggestion[] = GROK_COMMANDS.map(
  ([name, description]) => ({ name, description })
)
