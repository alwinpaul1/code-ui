import type { TuiAgent } from '../../../src/shared/tui-agent'
import { resolveStartupShell, tokenizeStartupCommand } from '../../../src/shared/tui-agent-startup-shell'
import { hostTakesAgentHudFlag } from './agent-hud-launch-args'
import type { MobileSessionTab } from './mobile-session-route-types'

/**
 * Every Claude Code session the phone starts starts in Claude Code's `auto`
 * permission mode (asked for 2026-10-15: "must always start with auto mode
 * permission no matter what").
 *
 * Verified against Claude Code 2.1.300, read from the installed binary
 * (`~/.local/share/claude/versions/2.1.300`), not by running it:
 * `--permission-mode <mode>` "Permission mode to use for the session", modes
 * `acceptEdits`, `auto`, `bypassPermissions`, `default`, `dontAsk`, `plan`.
 * A plan without auto mode is Claude Code's own problem to report ("Auto mode
 * is unavailable for your plan"); the flag itself is accepted.
 *
 * Only the launch line changes. Nothing is written to the host: no settings
 * file, no `defaultMode`, nothing drawn in the terminal.
 */
export const CLAUDE_AUTO_PERMISSION_MODE_FLAG = '--permission-mode auto'

/** Orca's two launchers that end in the real `claude` binary. Agent Teams is
 *  `orca claude-teams [claude args...]`, which passes every argument through
 *  to `claude` (Orca 1.4.224, `out/cli/handlers/core.js`). */
function launchesClaudeCode(agent: TuiAgent): boolean {
  return agent === 'claude' || agent === 'claude-agent-teams'
}

/** Flags that choose the starting permission mode. `--allow-dangerously-skip-permissions`
 *  is not one: it only adds bypass to the Shift+Tab cycle. */
function isPermissionModeToken(token: string): boolean {
  return (
    token === '--permission-mode' ||
    token.startsWith('--permission-mode=') ||
    token === '--dangerously-skip-permissions'
  )
}

/**
 * New Tab → Claude / Claude Agent Teams (and a Claude resume the phone opens):
 * the args the host would launch with, starting in auto mode.
 *
 * "No matter what" means auto wins over the host's saved args: a
 * `--permission-mode <other>` there is replaced, and `--dangerously-skip-permissions`
 * is taken out. That one matters: it is Orca's own default for both Claude agents
 * (`YOLO_TUI_AGENT_ARGS`), so without this a phone tab started in bypass mode.
 *
 * Where it goes: in place of the host's own permission flag when there is one,
 * else FIRST. The flag takes a required value, so it is safe in front of
 * anything, and the order never leaves a flag with an optional value last (see
 * below).
 *
 * A Windows host, and one that will not say what it is, get nothing new
 * (`hostTakesAgentHudFlag`): nothing new reaches a Windows launch until a launch
 * encoding is proven there.
 */
export function withClaudeAutoPermissionMode(args: {
  agent: TuiAgent
  agentArgs: string
  hostPlatform: NodeJS.Platform | null
}): string {
  const { agent, agentArgs, hostPlatform } = args
  if (!launchesClaudeCode(agent) || !hostTakesAgentHudFlag(hostPlatform)) {
    return agentArgs
  }
  const tokenized = tokenizeStartupCommand(agentArgs, resolveStartupShell(hostPlatform ?? 'linux'))
  if (!tokenized.ok) {
    console.warn(`[auto-permission-args] ${agent}: no --permission-mode auto, the args do not split (${tokenized.error})`)
    return agentArgs
  }
  const { tokens, spans } = tokenized
  const terminator = tokens.indexOf('--')
  const optionEnd = terminator === -1 ? tokens.length : terminator
  // Each permission flag of the host's (with its value) is one group, replaced where it stands.
  const groups: Array<{ start: number; end: number }> = []
  for (let index = 0; index < optionEnd; index += 1) {
    const token = tokens[index]
    if (!isPermissionModeToken(token)) {
      continue
    }
    const value = tokens[index + 1]
    const takesValue =
      token === '--permission-mode' && index + 1 < optionEnd && value !== undefined && !value.startsWith('-')
    const end = takesValue ? index + 1 : index
    const previous = groups.at(-1)
    if (previous && previous.end === index - 1) {
      // Adjacent groups are one: `--dangerously-skip-permissions --permission-mode plan` -> one flag.
      previous.end = end
    } else {
      groups.push({ start: index, end })
    }
    if (takesValue) {
      index += 1
    }
  }
  if (groups.length === 0) {
    const rest = agentArgs.trim()
    return rest.length > 0 ? `${CLAUDE_AUTO_PERMISSION_MODE_FLAG} ${rest}` : CLAUDE_AUTO_PERMISSION_MODE_FLAG
  }
  // Why in place and not moved to the front: a group is a flag (and its value), and so is
  // `--permission-mode auto`, so every neighbour keeps the shape it had. Taking a group out
  // instead could leave a flag with an OPTIONAL value (`--remote-control [name]`,
  // `--debug [filter]`, `--resume [value]`, ...) last, where Orca's appended prompt would
  // become its value, or next to a bare word it would swallow. Two groups give the flag
  // twice; Claude Code takes the last, and both say auto.
  // Each kept token keeps its own quoting: the args can hold the beacon's quoted `--settings` JSON.
  const pieces: string[] = []
  let groupIndex = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const group = groups[groupIndex]
    if (group && index === group.start) {
      pieces.push(CLAUDE_AUTO_PERMISSION_MODE_FLAG)
      index = group.end
      groupIndex += 1
      continue
    }
    pieces.push(agentArgs.slice(spans[index].start, spans[index].end))
  }
  const rewritten = pieces.join(' ')
  return rewritten === agentArgs.trim() ? agentArgs : rewritten
}

/** The words that start a Claude Code session when typed at a shell. `claudeai`
 *  is this user's alias (`~/.zshrc`: `alias claudeai='CLAUDE_CONFIG_DIR=$HOME/.claude-work claude'`);
 *  an alias expands its first word only, so flags after it reach `claude`. */
const TYPED_CLAUDE_LAUNCHERS: ReadonlySet<string> = new Set(['claude', 'claudeai'])

/** Claude Code 2.1.300's top-level subcommands. A line that runs one is not a session. */
const CLAUDE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'agents',
  'auth',
  'auto-mode',
  'config',
  'critique',
  'doctor',
  'gateway',
  'help',
  'install',
  'login',
  'logout',
  'mcp',
  'migrate-installer',
  'plugin',
  'plugins',
  'project',
  'remote-control',
  'sandbox',
  'serve',
  'setup-token',
  'ultrareview',
  'uninstall',
  'update',
  'upgrade'
])

const NOT_A_SESSION_FLAGS: ReadonlySet<string> = new Set(['-h', '--help', '-v', '--version'])

/**
 * The line with `--permission-mode auto` appended when it is, beyond doubt, a
 * Claude Code launch; null otherwise. Strict on purpose: a wrong rewrite would
 * change a command the user typed, a missed one only starts in the default mode.
 *
 * A launch is: the first word exactly `claude` or `claudeai` (not a path, not
 * quoted, not `claude-sub`, no leading whitespace), one line, no shell operator,
 * no `--` terminator, no help/version flag, no subcommand, and no permission flag
 * of the user's own (theirs stands). A bare first argument that follows no flag
 * could be a subcommand this list does not know yet, so it is refused too; a
 * quoted prompt (`claude "fix the build"`) is not bare and is rewritten.
 *
 * Appended rather than put after the launcher so the live-input mirror, which
 * has already typed the line into the PTY, can send just the tail.
 */
export function withAutoPermissionModeForTypedClaudeLaunch(line: string): string | null {
  if (line.length === 0 || /^\s/.test(line) || /[\r\n;&|<>`$()]/.test(line)) {
    return null
  }
  const tokenized = tokenizeStartupCommand(line, 'posix')
  if (!tokenized.ok || tokenized.tokens.length === 0) {
    return null
  }
  const { tokens, spans } = tokenized
  const launcherRaw = line.slice(spans[0].start, spans[0].end)
  if (!TYPED_CLAUDE_LAUNCHERS.has(tokens[0]) || launcherRaw !== tokens[0]) {
    return null
  }
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--' || NOT_A_SESSION_FLAGS.has(token) || isPermissionModeToken(token)) {
      return null
    }
    if (token.startsWith('-')) {
      continue
    }
    if (CLAUDE_SUBCOMMANDS.has(token)) {
      return null
    }
    const raw = line.slice(spans[index].start, spans[index].end)
    const bare = raw === token
    const previous = tokens[index - 1]
    const followsFlag = index > 1 && previous.startsWith('-') && !previous.includes('=')
    if (bare && !followsFlag) {
      return null
    }
  }
  return /\s$/.test(line)
    ? `${line}${CLAUDE_AUTO_PERMISSION_MODE_FLAG}`
    : `${line} ${CLAUDE_AUTO_PERMISSION_MODE_FLAG}`
}

/**
 * A line the PHONE submits to a terminal, rewritten to start Claude Code in auto
 * mode, or null to send it as typed. Refused when the pane already names an
 * agent (Orca launched one there, or its live status names one): `claude` typed
 * to a running Claude Code is a prompt, and the phone cannot see whether that
 * agent has since exited, so a Claude tab whose Claude was quit is not rewritten.
 * A Windows host, or one that will not say what it is, is refused like the
 * New Tab flag.
 */
export function typedClaudeLaunchWithAutoPermissionMode(args: {
  line: string
  hostPlatform: NodeJS.Platform | null
  tab: MobileSessionTab | null
}): string | null {
  const { line, hostPlatform, tab } = args
  if (!hostTakesAgentHudFlag(hostPlatform) || tab?.type !== 'terminal') {
    return null
  }
  if (tab.launchAgent != null || tab.agentStatus != null) {
    return null
  }
  return withAutoPermissionModeForTypedClaudeLaunch(line)
}
