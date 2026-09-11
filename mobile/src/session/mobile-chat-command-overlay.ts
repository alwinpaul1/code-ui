import { slashCommandOpensOverlay } from '../../../src/shared/native-chat-slash-commands'

/**
 * Claude Code commands that draw a TUI picker, prompt or wizard the chat view
 * cannot show, so the phone shows the terminal for them. Verified on Claude
 * Code 2.1.267 (2026-09-11). Everything else — /btw, /clear, /compact, /copy,
 * /goal, /fast, /brief, /focus, /rename, /recap, /export, /init, /review,
 * /simplify, /code-review, /autofix-pr, /fork, /exit, /bug, /diff, /run, /cd,
 * /loop … — acts and answers in the transcript, so chat stays.
 *
 * Kept here rather than in the vendored catalog (src/shared is Orca's, never
 * edited in this repo), which flags overlays for Codex only.
 */
const CLAUDE_OVERLAY_COMMANDS = new Set([
  'model',
  'config',
  'resume',
  'permissions',
  'agents',
  'mcp',
  'hooks',
  'memory',
  'effort',
  'rewind',
  'branch',
  'plan',
  'login',
  'doctor',
  'context',
  'status',
  'help',
  'release-notes',
  'insights',
  'skills',
  'artifacts',
  'color',
  'statusline',
  'chrome',
  'ide',
  'passes',
  'loops',
  'privacy-settings',
  'remote-env',
  'sandbox',
  'schedule',
  'setup-bedrock',
  'setup-vertex',
  'import',
  'powerup',
  'fewer-permission-prompts',
  'auto-mode-setup',
  'add-dir',
  'advisor',
  'autocompact',
  'daemon',
  'design',
  'desktop',
  'feedback',
  'install-github-app',
  'remote-control',
  'reload-plugins',
  'reload-skills',
  'scroll-speed',
  'skill-doctor',
  'terminal-setup',
  'theme',
  'usage',
  'vim',
  'output-style',
  'workflows',
  'tasks'
])

/** A Claude command the catalog lists but does not flag: overlay or not, by this list. */
const CLAUDE_TRANSCRIPT_COMMANDS = new Set([
  'btw',
  'clear',
  'compact',
  'copy',
  'goal',
  'fast',
  'brief',
  'focus',
  'rename',
  'recap',
  'export',
  'init',
  'review',
  'simplify',
  'code-review',
  'autofix-pr',
  'fork',
  'exit',
  'bug',
  'diff',
  'run',
  'cd',
  'loop',
  'security-review',
  'stats'
])

export function chatCommandOpensOverlay(agent: string, commandText: string): boolean {
  if (agent === 'claude' || agent === 'claude-agent-teams') {
    const name = commandText.trim().split(/\s/, 1)[0]?.replace(/^\//, '').toLowerCase() ?? ''
    if (CLAUDE_OVERLAY_COMMANDS.has(name)) {
      return true
    }
    if (CLAUDE_TRANSCRIPT_COMMANDS.has(name)) {
      return false
    }
    // Unknown to both lists (a skill, a plugin command): assume an overlay,
    // as the shared rule does — we cannot tell, and the terminal is safe.
    return true
  }
  return slashCommandOpensOverlay(agent as Parameters<typeof slashCommandOpensOverlay>[0], commandText)
}
