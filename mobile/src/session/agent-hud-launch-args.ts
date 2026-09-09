import type { TuiAgent } from '../../../src/shared/tui-agent'

/**
 * The HUD's data source for agents the phone launches: the agents' own
 * status-line features, switched on for that one process by command-line
 * flags. Nothing is written to the host; the flags exist only in the launch.
 *
 *  - Claude Code accepts `--settings <json>`. Claude Code pipes its own state
 *    (model, effort, context tokens, rate limits) into the status-line
 *    command on every repaint and draws whatever the command prints.
 *  - Codex accepts `-c tui.status_line=[...]` and then paints model, reasoning
 *    effort and context remaining on its footer itself, no command involved.
 *
 * Verified live 2026-09-09 against Claude Code 2.1.266 and codex-cli 0.153.4.
 * The phone's screen parser (mobile-terminal-hud-parse.ts) reads both lines.
 */

/** POSIX sh, sed and printf only: no node, no jq. Prints one line such as
 *  "[Fable 5.1 medium] ctx 64% 649k/1.0M · 5h 37% · 7d 36%". The JSON that
 *  Claude Code pipes in is a single line, so anchored sed captures are safe;
 *  `used_percentage` is disambiguated by the `remaining_percentage` that only
 *  the context block has. No single quotes anywhere: the whole script travels
 *  inside a JSON string inside a single-quoted shell token. */
export const CLAUDE_HUD_STATUSLINE_SCRIPT = [
  'i=$(cat)',
  'g(){ printf %s "$i" | sed -nE "s/.*$1.*/\\\\1/p"; }',
  'm=$(g "\\"display_name\\":\\"([^\\"]*)\\"")',
  'e=$(g "\\"effort\\":\\{\\"level\\":\\"([^\\"]*)\\"")',
  'p=$(g "\\"used_percentage\\":([0-9.]+|null),\\"remaining_percentage\\"")',
  's=$(g "\\"context_window_size\\":([0-9]+)")',
  'a=$(g "\\"current_usage\\":\\{\\"input_tokens\\":([0-9]+)")',
  'b=$(g "\\"cache_creation_input_tokens\\":([0-9]+)")',
  'c=$(g "\\"cache_read_input_tokens\\":([0-9]+)")',
  'h=$(g "\\"five_hour\\":\\{\\"used_percentage\\":([0-9.]+)")',
  'w=$(g "\\"seven_day\\":\\{\\"used_percentage\\":([0-9.]+)")',
  'k(){ if [ "$1" -ge 1000000 ]; then printf "%d.%dM" $(($1/1000000)) $((($1%1000000)/100000)); else printf "%dk" $(($1/1000)); fi; }',
  'u=""; [ -n "$a" ] && u=$(k $((a+${b:-0}+${c:-0})))',
  'o="[$m ${e:-default}]"',
  'if [ -n "$p" ] && [ "$p" != null ]; then o="$o ctx ${p%.*}% ${u:-0}/$(k ${s:-0})"; else o="$o ctx 0% 0/$(k ${s:-0})"; fi',
  '[ -n "$h" ] && o="$o · 5h ${h%.*}%"',
  '[ -n "$w" ] && o="$o · 7d ${w%.*}%"',
  'printf "%s\\n" "$o"'
].join('; ')

export function buildClaudeHudSettingsJson(): string {
  return JSON.stringify({
    statusLine: { type: 'command', command: CLAUDE_HUD_STATUSLINE_SCRIPT }
  })
}

export const CODEX_HUD_STATUS_LINE_ITEMS = [
  'model-with-reasoning',
  'context-remaining',
  'five-hour-limit',
  'weekly-limit'
] as const

export function buildCodexHudConfigOverride(): string {
  return `tui.status_line=${JSON.stringify([...CODEX_HUD_STATUS_LINE_ITEMS])}`
}

/** Escape for a single-quoted POSIX token: Orca tokenizes agent args with the
 *  Unix grammar once and re-quotes each token for the host shell itself. */
function singleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildAgentHudLaunchArgs(args: {
  agent: TuiAgent
  /** The host's own default args for this agent, kept in front of ours. */
  hostDefaultArgs: string
  hostPlatform: NodeJS.Platform | null
}): string | null {
  const base = args.hostDefaultArgs.trim()
  const join = (extra: string) => (base ? `${base} ${extra}` : extra)
  if (args.agent === 'codex') {
    // A pure CLI flag: no shell runs the status line, so every host platform.
    return join(`-c ${singleQuoted(buildCodexHudConfigOverride())}`)
  }
  if (args.agent === 'claude') {
    // The status-line command is POSIX sh. On a Windows host Claude Code would
    // hand it to cmd or PowerShell, so it stays off there rather than erroring
    // on every repaint; model and mode still arrive from Orca and the footer.
    if (args.hostPlatform === 'win32') {
      return null
    }
    return join(`--settings ${singleQuoted(buildClaudeHudSettingsJson())}`)
  }
  return null
}
