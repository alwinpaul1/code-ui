// Why: import from 'buffer' (the npm polyfill), not 'node:buffer' because
// Metro cannot resolve Node builtins in a React Native bundle.
import { Buffer } from 'buffer'
import { resolveStartupShell, tokenizeStartupCommand } from '../../../src/shared/tui-agent-startup-shell'

/**
 * Which launch flags in an agent's saved arguments THIS APP wrote, and whether
 * the user has one of their own that ours would replace.
 *
 * Why not by shape: until 2026-09-30 the desktop sync took out every
 * `--settings '{"statusLine":{"type":"command",…}}'`, `-c 'notify=[…]'` and
 * `-c 'tui.status_line=[…]'` it found, the user's own included, switch on or
 * off, and turning the switch off never gave them back. So a flag is ours only
 * when it carries our signature or is the exact text an early build wrote:
 *
 *  - every beacon build (0.2.81 on) writes `CUIHUD` into its payload: plainly
 *    in Claude's sh script and in Codex's PowerShell notify, inside the
 *    `-EncodedCommand` base64 (UTF-16LE) of Claude's Windows command, and as
 *    the `"cuihud"` argv0 closing Codex's sh notify (its script is base64);
 *  - 0.2.77 wrote two flags with no signature, recognised by their exact text.
 *
 * Every distinct flag the desktop sync ever wrote (55 of them, replayed from
 * the source at each commit, 2026-09-30) is one of these; the oldest of each
 * shape is in fixtures/agent-hud-desktop-flags-history.json. None carries a
 * backtick or a single quote inside its quotes, so Orca's POSIX and
 * PowerShell grammars split each one the same way.
 *
 * The args are split the way Orca splits them for that host's shell
 * (`tokenizeStartupCommand`), so a flag is found by its words, however the
 * user quoted them, and a cut takes out exactly our words.
 */

export type HudFlagAgent = 'claude' | 'codex'

export type HudLaunchFlags =
  | { readable: false; reason: string }
  | {
      readable: true
      /** Where each flag of ours sits, as [start, end) offsets into the args. */
      ours: readonly { start: number; end: number }[]
      /** The user's own flag ours would replace, or null. */
      usersOwn: string | null
    }

const SIGNATURE = 'CUIHUD'
const CLAUDE_ENVELOPE = '{"statusLine":{"type":"command","command":"'

// 0.2.77's (6b255d84) visible status line, exactly as that build wrote it.
const CLAUDE_0277_SCRIPT = [
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
const CLAUDE_0277_SETTINGS = JSON.stringify({ statusLine: { type: 'command', command: CLAUDE_0277_SCRIPT } })
// 0.2.77's visible Codex footer: four items, not the two a user may pick.
const CODEX_0277_FOOTER = 'tui.status_line=["model-with-reasoning","context-remaining","five-hour-limit","weekly-limit"]'

/** The scripts a `powershell -EncodedCommand <base64>` inside `value` runs. */
function encodedScripts(value: string): string[] {
  return [...value.matchAll(/-EncodedCommand ([A-Za-z0-9+/]+={0,2})/g)].map((match) =>
    Buffer.from(match[1]!, 'base64').toString('utf16le')
  )
}

function isOurClaudeSettings(value: string): boolean {
  if (value === CLAUDE_0277_SETTINGS) {
    return true
  }
  return (
    value.startsWith(CLAUDE_ENVELOPE) &&
    (value.includes(SIGNATURE) || encodedScripts(value).some((script) => script.includes(SIGNATURE)))
  )
}

function isOurCodexNotify(value: string): boolean {
  return (
    value.startsWith('notify=[') &&
    value.endsWith(']') &&
    (value.includes(SIGNATURE) || value.endsWith(',"cuihud"]'))
  )
}

/** A flag as Orca's tokens see it: its name, its value, and its span. */
type Found = { name: string; value: string | null; start: number; end: number }

/** Every `--settings` (Claude) or `-c`/`--config` (Codex) flag in the tokens,
 *  spaced or `=`-joined, with the value it takes. */
function flagsIn(agent: HudFlagAgent, tokens: readonly string[], spans: readonly { start: number; end: number }[]): Found[] {
  const long = agent === 'claude' ? '--settings' : '--config'
  const found: Found[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const span = spans[i]!
    if (token === long || (agent === 'codex' && token === '-c')) {
      const value = i + 1 < tokens.length ? tokens[i + 1]! : null
      found.push({ name: token, value, start: span.start, end: value === null ? span.end : spans[i + 1]!.end })
      if (value !== null) {
        i++
      }
    } else if (token.startsWith(`${long}=`)) {
      found.push({ name: long, value: token.slice(long.length + 1), start: span.start, end: span.end })
    } else if (agent === 'codex' && token.startsWith('-c') && !token.startsWith('--')) {
      // Clap's attached short form, `-ckey=value` (and `-c=key=value`).
      found.push({ name: '-c', value: token.slice(token[2] === '=' ? 3 : 2), start: span.start, end: span.end })
    }
  }
  return found
}

/** A Codex override's key, as Codex reads it: before the first `=`, trimmed. */
function overrideKey(value: string): string {
  const split = value.indexOf('=')
  return (split === -1 ? value : value.slice(0, split)).trim()
}

export function readHudLaunchFlags(
  agent: HudFlagAgent,
  args: string,
  hostPlatform: NodeJS.Platform | null
): HudLaunchFlags {
  const tokenized = tokenizeStartupCommand(args, resolveStartupShell(hostPlatform ?? 'linux'))
  if (!tokenized.ok) {
    return { readable: false, reason: tokenized.error }
  }
  const ours: { start: number; end: number }[] = []
  let usersOwn: string | null = null
  for (const flag of flagsIn(agent, tokenized.tokens, tokenized.spans)) {
    const value = flag.value ?? ''
    if (agent === 'claude') {
      if (isOurClaudeSettings(value)) {
        ours.push(flag)
      } else {
        // Claude Code 2.1.285 reads --settings as ONE value (`nKo` takes one
        // string), so ours after any of theirs would replace all of theirs.
        usersOwn ??= '--settings'
      }
      continue
    }
    const key = overrideKey(value)
    if (key === 'notify') {
      if (isOurCodexNotify(value)) {
        ours.push(flag)
      } else {
        // A later `-c notify=` replaces an earlier one, and our notify
        // delegates only to a notify in config.toml.
        usersOwn ??= `${flag.name} notify`
      }
    } else if (key === 'tui.status_line' && value === CODEX_0277_FOOTER) {
      ours.push(flag)
    }
  }
  return { readable: true, ours, usersOwn }
}

/** `args` less the given spans, each with the space before it; trimmed. */
export function withoutSpans(args: string, spans: readonly { start: number; end: number }[]): string {
  let out = ''
  let from = 0
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    out = (out + args.slice(from, span.start)).replace(/\s+$/, '')
    from = span.end
  }
  return (out + args.slice(from)).trim()
}

/** `args` with every flag of ours taken out and `flag` put last, so an upgrade replaces rather than
 *  stacks and a profile that already ends in `flag` comes back exactly as it was. Shared by the
 *  desktop sync and the phone's own launch: the phone once appended a second copy to a profile the
 *  sync had already flagged (agent-hud-phone-launch-over-saved-flag.test.ts). */
export function withOurFlagLast(args: string, ours: readonly { start: number; end: number }[], flag: string): string {
  const base = ours.length > 0 ? withoutSpans(args, ours) : args.trim()
  return base ? `${base} ${flag}` : flag
}
