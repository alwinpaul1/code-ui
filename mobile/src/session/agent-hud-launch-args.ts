// Why: import from 'buffer' (the npm polyfill), not 'node:buffer' because
// Metro cannot resolve Node builtins in a React Native bundle.
import { Buffer } from 'buffer'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import { readHudLaunchFlags, withOurFlagLast } from './agent-hud-launch-flag-owner'
import { CLAUDE_HUD_SESSION_START_HOOK_SCRIPT } from './agent-hud-session-start-hook-script'
import { AGENT_HUD_TTY_WRITE, ENCODE_FN } from './agent-hud-tty-write'
import { CLAUDE_HUD_PROMPT_HOOK_SCRIPT } from './agent-hud-prompt-hook-script'

export { CLAUDE_HUD_PROMPT_HOOK_SCRIPT }

/**
 * The HUD's data source: the agents' own live state, carried to the phone on
 * INVISIBLE control bytes written straight to the PTY. Nothing is drawn
 * in the user's terminal, nothing is written to their disk, and no terminal is
 * opened on the host.
 *
 * How it works, verified live 2026-09-09 on macOS against Claude Code 2.1.266
 * and codex-cli 0.153.4:
 *
 *  - Claude Code takes `--settings '{"statusLine":{"type":"command",…}}'` on
 *    the command line and pipes its own state (model, effort, context tokens,
 *    rate limits) to that command's stdin on every repaint. When the command
 *    prints NOTHING, Claude Code draws no status row at all — so the user's
 *    terminal is unchanged.
 *  - Codex takes `-c 'notify=["sh","-c",…]'` and runs that command after each
 *    turn with one JSON argument. Codex draws nothing for it.
 *  - Claude Code STRIPS OSC escapes from a status-line command's stdout, so
 *    the payload cannot ride on stdout. Instead each script finds the agent's
 *    own PTY by walking its parent processes (`ps -o tty= -p <pid>`, which
 *    gives `ttys003` on macOS and `pts/3` on Linux) and writes one frame of
 *    the C0 channel (`agent-hud-channel.ts`) to `/dev/<tty>`: four control
 *    bytes xterm.js and Ghostty (the second parser they were checked against) ignore in every state, so nothing is drawn
 *    even when the kernel splices the frame into the middle of the agent's
 *    own escapes, which an `ESC ] 7777 ; … BEL` did not survive (2026-09-25).
 *    The phone already receives the raw PTY byte stream and takes the frame
 *    out of it (`agent-hud-beacon.ts`).
 *  - Windows has no PTY device path to walk to, so both halves take a
 *    different route there. Claude Code runs its status-line command through
 *    Git Bash, so the same sh script detects MSYS from `uname -s` and writes
 *    to `/dev/tty` (MSYS's name for the attached console, which is Claude's
 *    own under ConPTY), then `/dev/conout`, still as the OSC: ConPTY's
 *    handling of the C0 channel is unknown. Codex spawns notify with NO shell
 *    and Git for Windows puts no `sh.exe` on PATH, so a win32 host gets a
 *    PowerShell notify command instead (`CODEX_HUD_NOTIFY_POWERSHELL`).
 *    **The whole Windows path is untested on a real Windows machine.**
 *
 * The POSIX scripts use `sed`, `printf`, `tail`, `tr`, `ps`, `od` and `cksum`
 * only (`od` and `cksum` are POSIX, for the channel's frame): no node,
 * no jq, no python for the payload itself. (Claude's DELEGATION step below
 * does reach for node/python3/jq, but only to read the user's own settings
 * file, and Claude Code is itself a Node program.)
 *
 * Every POSIX script ends in the one writer, `AGENT_HUD_TTY_WRITE`, and
 * encodes its values with `q()` (`ENCODE_FN`); both are in
 * agent-hud-tty-write.ts.
 */

/**
 * How often Claude Code re-runs the status-line command on a timer, in
 * seconds: `statusLine.refreshInterval` (2.1.276 binary: seconds, `min(1)`,
 * "Re-run the status line command every N seconds in addition to
 * event-driven updates"; an invalid value is dropped, not fatal).
 *
 * Why the phone asks for it: without it the command runs only on an
 * event — a new assistant message, /compact, a mode change — and NOT while a
 * tool executes. So a tab that had run a phone-launched agent could not be
 * told from one running the same session by hand once the agent went quiet,
 * and a rule that tried (working silence, 93e3cc5) blanked a live session's
 * pill 30 s into any long tool call. With the timer the beacon is a
 * heartbeat, and working silence means what it says. Verified live on
 * 2.1.276: a beat every 2 s through a 25 s foreground `python3 time.sleep`
 * and through idle time on both sides — but none under a permission prompt,
 * an AskUserQuestion card or `/model`, which unmount the status line, so the
 * phone times it only while Orca says the agent is working.
 *
 * Why 5 s: the phone writes a beacon off after six missed beats (30 s;
 * `agent-hud-beacon-liveness.ts`). The command itself costs ~10 ms of CPU a
 * run with no user status line (measured 2026-09-18, 38 MB transcript), and
 * the C0 channel's writer adds about 7 ms of wall time to it (`cksum`, `od`,
 * `sed` and two `tr`: 72 ms median against 65 ms for the OSC `printf`, the
 * whole script over the 2.1.266 fixture, 2026-09-25); a
 * user who keeps their own bar pays that bar's cost on the same beat, as
 * they would with the same setting in their own settings.json. The beacon
 * carries the value (`hb=`), so the phone knows what beat to expect and sizes
 * its window from it.
 *
 * Why 15 s on Windows: each beat there is a `powershell -EncodedCommand`
 * process start (Windows PowerShell 5.1), a JSON parse and a transcript
 * tail, measured on nothing — the path has not run on a Windows machine —
 * and Claude Code cancels a status-line run that is still going when the
 * next trigger fires, so a beat slower than the interval would never write.
 * Three times the room, and a 90 s window on the phone (six beats).
 */
export const CLAUDE_HUD_HEARTBEAT_SECONDS = 5
export const CLAUDE_HUD_HEARTBEAT_SECONDS_WIN32 = 15

/**
 * Claude Code's status-line command.
 *
 * The JSON Claude Code pipes in is a SINGLE line, so anchored `sed` captures
 * are safe; the greedy `.*` prefix takes the last match of each pattern, and
 * `used_percentage` is disambiguated by the `remaining_percentage` that only
 * the context block carries. `current_usage` and `used_percentage` are null
 * before the first reply, in which case those keys are simply left off the
 * payload — the phone shows what is known and nothing else. Claude Code 2.1.283
 * builds the payload, and runs the command, with 2.1.282's code, so every key
 * and its order is unchanged (binaries compared 2026-09-26).
 *
 * NO SINGLE QUOTES ANYWHERE: the whole script travels inside a JSON string
 * inside a single-quoted shell token. Orca tokenizes agent args with the Unix
 * grammar once and re-quotes per shell (`tokenizeStartupCommand`), and a
 * single quote would end the token. A test asserts their absence.
 */
export const CLAUDE_HUD_STATUSLINE_SCRIPT = [
  'i=$(cat)',
  'g(){ printf %s "$i" | sed -nE "s/.*$1.*/\\1/p"; }',
  ENCODE_FN,
  // `sid`: the session this beacon speaks for. A beacon is keyed by terminal
  // handle on the phone, and a handle outlives the process that emitted into
  // it — on 2026-09-18 a hand-started `claude -c` in a terminal that had run a
  // phone-launched agent inherited that agent's last beacon, and the pill said
  // Fable on an Opus session. The quote before `session_id` keeps
  // `caller_session_id` from matching; a copy quoted inside a JSON string is
  // escaped (`\"session_id\":`) and cannot match either.
  'si=$(g "\\"session_id\\":\\"([^\\"]*)\\"")',
  'mi=$(g "\\"model\\":\\{\\"id\\":\\"([^\\"]*)\\"")',
  'mn=$(g "\\"display_name\\":\\"([^\\"]*)\\"")',
  'ef=$(g "\\"effort\\":\\{\\"level\\":\\"([^\\"]*)\\"")',
  'pc=$(g "\\"used_percentage\\":([0-9.]+),\\"remaining_percentage\\"")',
  'cw=$(g "\\"context_window_size\\":([0-9]+)")',
  'ta=$(g "\\"current_usage\\":\\{\\"input_tokens\\":([0-9]+)")',
  'tb=$(g "\\"cache_creation_input_tokens\\":([0-9]+)")',
  'tc=$(g "\\"cache_read_input_tokens\\":([0-9]+)")',
  'ha=$(g "\\"five_hour\\":\\{\\"used_percentage\\":([0-9.]+)")',
  'hr=$(g "\\"five_hour\\":\\{\\"used_percentage\\":[0-9.]+,\\"resets_at\\":([0-9]+)")',
  'wa=$(g "\\"seven_day\\":\\{\\"used_percentage\\":([0-9.]+)")',
  'wb=$(g "\\"seven_day\\":\\{\\"used_percentage\\":[0-9.]+,\\"resets_at\\":([0-9]+)")',
  'wd=$(g "\\"cwd\\":\\"([^\\"]*)\\"")',
  // Finished background tasks. Claude appends a `<task-notification>` carrying
  // `<task-id>` to its own transcript the moment a task ends — as a user turn
  // when idle, as a queue-operation record when mid-turn. The phone never sees
  // the mid-turn kind through Orca, so the ids ride the beacon: the newest 32,
  // deduplicated, from the last 256 KB of the file. Ids are [A-Za-z0-9_-].
  'tp=$(g "\\"transcript_path\\":\\"([^\\"]*)\\"")',
  // Windows: the path arrives JSON-escaped (C:\\Users\\me\\...), and Claude Code
  // runs this command through Git Bash, which cannot open a backslash path —
  // its own /statusline agent warns about exactly this. Slashes work on all
  // three platforms (repeated ones collapse), and a POSIX transcript path
  // never contains a backslash, so the conversion is a no-op there.
  '[ -n "$tp" ] && tp=$(printf %s "$tp" | tr "\\\\\\\\" /)',
  'dn=""',
  // Only records that carry a <status>: a Monitor emits a <task-id> with no
  // status for every EVENT while it is still running. Assistant records are
  // skipped — prose or a command that quotes a notification is not one.
  // The whole file, not a byte tail: on 2026-09-13 a 182 MB transcript put a
  // 4 MiB tail seven minutes back, so a shell that finished eight minutes ago
  // stayed "running" on the phone. Its completion is an attachment record the
  // desktop's reader drops, so this scan is the phone's only way to learn of
  // it. `grep -F` on the marker first keeps it to ~50 ms at 182 MB.
    // Every shell Claude has started, from its own tool results: a tool_result
  // whose content STARTS with "Command running in background with ID: <id>"
  // or "Command did not complete … moved to the background (ID: <id>)", or
  // "Command was manually backgrounded by user with ID: <id>" (ctrl+b), or
  // "Command was moved to the background (ID: <id>) so that a message …"
  // (a message queued while it ran; `qMn` in 2.1.280–2.1.283).
  // Anchored to the start of the content and skipping assistant records,
  // because the transcript also holds every command and every line of prose
  // that merely QUOTES those strings — a grep for them, a test fixture — and
  // on 2026-09-11 those read as launches (an empty id, one called "b").
  // Claude Code 2.1.283's flag-gated JSON task result is not read here either
  // (mobile-background-task-transcript.ts says why).
  // The tail is 4 MiB, not 1: a busy session writes several MB an hour, and a
  // completion that scrolled out while its launch was still in the phone's
  // window stayed "running". Same tail, same tools. Launched minus done is what is still running, and
  // it is right mid-turn — the Stop hook's `run=` list is only as fresh as the
  // last turn end, and a 858k-token session's launches sit far above the
  // window the phone loads. Measured 2026-09-11: the desk read "3 shells",
  // the phone "1".
  'bg=""',
  'ba=""',
  'lv=""',
  // The last 4 MiB, both scans. This runs on every status-line repaint, on
  // the machine the user types on, so it must be cheap: the whole file cost
  // 1.9 s per repaint on a 213 MB transcript and 16 MiB still cost 1.4 s,
  // both felt as keystroke lag (2026-09-13). 4 MiB reads in about 0.3 s and
  // covers what changed this turn; the Stop hook's whole-file `run=` is the
  // authoritative list at turn end, so a shell launched far back is corrected
  // there rather than carried on every keystroke.
  '[ -n "$tp" ] && [ -r "$tp" ] && ba=$(tail -c 4194304 "$tp" 2>/dev/null | grep -F "\\"content\\":\\"Command " 2>/dev/null | grep -v "\\"type\\":\\"assistant\\"" 2>/dev/null | grep -o -e "\\"content\\":\\"Command running in background with ID: [A-Za-z0-9_-]\\{3,\\}" -e "\\"content\\":\\"Command did not complete[^\\"]*moved to the background (ID: [A-Za-z0-9_-]\\{3,\\}" -e "\\"content\\":\\"Command was manually backgrounded by user with ID: [A-Za-z0-9_-]\\{3,\\}" -e "\\"content\\":\\"Command was moved to the background (ID: [A-Za-z0-9_-]\\{3,\\}" 2>/dev/null | sed -e "s/.*ID: //" | awk "!s[\\$0]++")',
  '[ -n "$ba" ] && bg=$(printf "%s\\n" "$ba" | tail -n 64 | tr "\\n" ",")',
  '[ -n "$tp" ] && [ -r "$tp" ] && da=$(tail -c 4194304 "$tp" 2>/dev/null | grep -F "<status>" 2>/dev/null | grep -v "\\"type\\":\\"assistant\\"" 2>/dev/null | grep -o "<task-id>[A-Za-z0-9_-]\\{3,\\}</task-id>" 2>/dev/null | sed -e "s/<task-id>//" -e "s#</task-id>##" | awk "!s[\\$0]++")',
  'dc=","',
  '[ -n "$da" ] && dc=",$(printf "%s\\n" "$da" | tr "\\n" ",")"',
  // `live` is the answer the phone actually needs: launched and not yet
  // finished, computed over the whole transcript on every status refresh.
  // `done`/`bg` stay for readers that retire launches they found themselves
  // (2026-09-13: capped lists left a 12:28 shell running all evening).
  '[ -n "$ba" ] && lv=$(printf "%s\\n" "$ba" | awk -v d="$dc" "index(d, \\",\\"\\$0\\",\\")==0" | tr "\\n" ",")',
  '[ -n "$da" ] && dn=$(printf "%s\\n" "$da" | awk -v b=",$bg," "{a[NR]=\\$0} END{for(i=1;i<=NR;i++) if (index(b, \\",\\"a[i]\\",\\")>0 || i>NR-32) print a[i]}" | tr "\\n" ",")',
  // `hk` says this tab was launched with the prompt hook. Claude Code reads
  // --settings once at launch (its hot reload watches settings FILES, which
  // Code UI must not write), so a tab started before the hook existed can
  // never gain it — the phone says so rather than silently dropping the
  // desktop's messages (2026-09-13).
  `o="CUIHUD1 agent=claude hk=1 hb=${CLAUDE_HUD_HEARTBEAT_SECONDS}"`,
  '[ -n "$si" ] && o="$o sid=$(q "$si")"',
  '[ -n "$mi" ] && o="$o model=$(q "$mi")"',
  '[ -n "$mn" ] && o="$o name=$(q "$mn")"',
  '[ -n "$ef" ] && o="$o effort=$(q "$ef")"',
  '[ -n "$ta" ] && o="$o used=$((ta+${tb:-0}+${tc:-0}))"',
  '[ -n "$cw" ] && o="$o win=$cw"',
  '[ -n "$pc" ] && o="$o pct=${pc%.*}"',
  '[ -n "$ha" ] && o="$o h5=${ha%.*}:${hr:-0}"',
  '[ -n "$wa" ] && o="$o d7=${wa%.*}:${wb:-0}"',
  '[ -n "$dn" ] && o="$o done=${dn%,}"',
  '[ -n "$bg" ] && o="$o bg=${bg%,}"',
  // Sent whenever the transcript was readable, EMPTY included: left out when
  // nothing is running, the phone kept the previous list and its count until
  // the turn ended (2026-09-13).
  '[ -n "$tp" ] && [ -r "$tp" ] && o="$o live=${lv%,}"',
  ...AGENT_HUD_TTY_WRITE,
  // Delegation: a user who already runs their own status line must keep seeing
  // exactly their bar. settings.json is multi-line JSON. Each reader is tried
  // in turn and the first non-empty answer wins: node, python3, jq, and last a
  // pure-sed reader that needs no runtime at all — Claude Code's native
  // install is a single binary, so a Windows (or minimal Linux) host may have
  // none of the first three, and the user's bar must not vanish because of it.
  // The sed reader joins the file into one line, takes the `command` string
  // inside the `statusLine` object, then undoes the two JSON escapes a shell
  // command can carry (\" and \\). Found nothing anywhere: print nothing,
  // and Claude Code draws no row.
  'xn(){ node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(process.argv[1],\\"utf8\\"));const c=s.statusLine&&s.statusLine.type===\\"command\\"&&s.statusLine.command;if(c)process.stdout.write(c)" "$1" 2>/dev/null; }',
  'xp(){ python3 -c "import json,sys;s=json.load(open(sys.argv[1])).get(\\"statusLine\\") or {};c=s.get(\\"command\\") if s.get(\\"type\\")==\\"command\\" else None;sys.stdout.write(c or \\"\\")" "$1" 2>/dev/null; }',
  'xj(){ jq -r ".statusLine.command // empty" "$1" 2>/dev/null; }',
  'xs(){ tr -d "\\n\\r" < "$1" 2>/dev/null | sed -nE "s/.*\\"statusLine\\"[[:space:]]*:[[:space:]]*\\{[^}]*\\"command\\"[[:space:]]*:[[:space:]]*\\"((\\\\\\\\.|[^\\"\\\\\\\\])*)\\".*/\\1/p" | sed -e "s/\\\\\\\\\\"/\\"/g" -e "s/\\\\\\\\\\\\\\\\/\\\\\\\\/g"; }',
  'x(){ [ -r "$1" ] || return 1; c=""; if command -v node >/dev/null 2>&1; then c=$(xn "$1"); fi; if [ -z "$c" ] && command -v python3 >/dev/null 2>&1; then c=$(xp "$1"); fi; if [ -z "$c" ] && command -v jq >/dev/null 2>&1; then c=$(xj "$1"); fi; if [ -z "$c" ]; then c=$(xs "$1"); fi; printf %s "$c"; }',
  'y=""',
  'for f in "$wd/.claude/settings.local.json" "$wd/.claude/settings.json" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.local.json" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"; do y=$(x "$f" 2>/dev/null); [ -n "$y" ] && break; done',
  'if [ -n "$y" ] && ! printf %s "$y" | grep -q CUIHUD; then printf %s "$i" | sh -c "$y" 2>/dev/null; fi',
  'exit 0'
].join('; ')

/**
 * Codex's notify command.
 *
 * Codex appends one JSON argument (`{"type":"agent-turn-complete","thread-id":
 * "01a08736-…","cwd":…}`). `sh -c <script> <argv0> <argv1>` makes the first
 * trailing word `$0`, so the flag passes a dummy `$0` and the JSON lands in
 * `$1`; the `case` still falls back to `$0` if a future Codex appends
 * differently.
 *
 * The figures live in the rollout Codex writes for itself, under
 * `${CODEX_HOME:-$HOME/.codex}/sessions/YYYY/MM/DD/rollout-*-<thread-id>.jsonl`:
 * `event_msg` records with `payload.type=="token_count"` carry
 * `payload.info.last_token_usage.total_tokens` (the CURRENT context, not the
 * running total) and `payload.info.model_context_window`; `turn_context`
 * records carry `payload.model` and `payload.effort`. Shapes read from real
 * rollouts on 2026-09-09 (codex-cli 0.153.4, `model_context_window` 258400).
 *
 * `"effort":"` cannot match `"reasoning_effort":"` — the byte before `effort`
 * must be a quote — so the greedy prefix lands on the real one either way.
 */
export const CODEX_HUD_NOTIFY_SCRIPT = [
  'j=$1',
  'case $j in {*) ;; *) j=$0;; esac',
  'ti=$(printf %s "$j" | sed -nE "s/.*\\"thread-id\\":\\"([^\\"]*)\\".*/\\1/p")',
  'ch=${CODEX_HOME:-$HOME/.codex}',
  'rf=""',
  // Rollout names start with an ISO timestamp, so the last glob match is newest.
  'if [ -n "$ti" ]; then for c in "$ch"/sessions/*/*/*/rollout-*-$ti.jsonl; do [ -f "$c" ] && rf=$c; done; fi',
  'md=""; ef=""; tk=""; cw=""',
  'if [ -n "$rf" ]; then md=$(sed -nE "/\\"type\\":\\"turn_context\\"/s/.*\\"model\\":\\"([^\\"]*)\\".*/\\1/p" "$rf" | tail -n 1); ef=$(sed -nE "/\\"type\\":\\"turn_context\\"/s/.*\\"effort\\":\\"([^\\"]*)\\".*/\\1/p" "$rf" | tail -n 1); tk=$(tail -n 400 "$rf" | sed -nE "s/.*\\"last_token_usage\\":\\{[^}]*\\"total_tokens\\":([0-9]+).*/\\1/p" | tail -n 1); cw=$(tail -n 400 "$rf" | sed -nE "s/.*\\"model_context_window\\":([0-9]+).*/\\1/p" | tail -n 1); fi',
  ENCODE_FN,
  'o="CUIHUD1 agent=codex"',
  // The thread id is the session the phone tracks for this tab (Orca's Codex
  // hook reports the same id as `session_id`, and `codex resume <id>` takes
  // it), so the phone can tell whose beacon it is holding.
  '[ -n "$ti" ] && o="$o sid=$(q "$ti")"',
  '[ -n "$md" ] && o="$o model=$(q "$md")"',
  '[ -n "$ef" ] && o="$o effort=$(q "$ef")"',
  '[ -n "$tk" ] && o="$o used=$tk"',
  '[ -n "$cw" ] && o="$o win=$cw"',
  ...AGENT_HUD_TTY_WRITE,
  // Delegation: our `-c notify=[…]` overrides whatever the user configured, so
  // run theirs too. Best effort, and deliberately narrow: only a SINGLE-LINE
  // `notify = ["a","b"]` array is supported, and an argument containing a comma
  // would be split. Anything else is left alone rather than guessed at.
  'nc=$ch/config.toml',
  'un=""',
  '[ -r "$nc" ] && un=$(sed -nE "s/^[[:space:]]*notify[[:space:]]*=[[:space:]]*\\[(.*)\\].*/\\1/p" "$nc" | head -n 1)',
  'case $un in *CUIHUD*) un="";; esac',
  'if [ -n "$un" ]; then eval "set -- $(printf %s "$un" | tr "," " ")"; [ -n "$1" ] && "$@" "$j" >/dev/null 2>&1; fi',
  'exit 0'
].join('; ')

/**
 * The console writer both Windows scripts share. PowerShell, no single quotes.
 *
 * Why P/Invoke: on Windows the beacon has to reach the pseudoconsole Orca
 * reads, and neither script starts attached to it. Claude Code spawns hook
 * and status-line children with `windowsHide` — Bun, like Node, maps that to
 * CREATE_NO_WINDOW when every stdio is a pipe (libuv `process.c`), so the child
 * gets its own hidden console. Codex spawns its notify with stdout, stderr and
 * stdin all `Stdio::null()` (`codex-rs/hooks/src/legacy_notify.rs`), so
 * `[Console]::Out` goes nowhere. The only route in is the Win32 console API:
 * find the agent up the process tree, `AttachConsole` to it (Claude's case;
 * Codex's child already shares the console), open `CONOUT$`, `WriteConsoleW`.
 * ConPTY 1.22+ then forwards the unknown OSC verbatim (see the docs).
 *
 * Why Reflection.Emit and not Add-Type: Add-Type compiles C# on every run,
 * half a second to two seconds, and this runs on every status refresh. A
 * dynamic P/Invoke type costs ~2 ms (measured under pwsh 7.6.6).
 * `AssemblyBuilder.DefineDynamicAssembly` is .NET Core; the `AppDomain` form
 * is the .NET Framework (Windows PowerShell 5.1) fallback.
 *
 * `CUIHUD_WIN_CONOUT` names a file to append to instead — the test seam, and
 * a bypass for a host where the console write must be inspected. Off
 * Windows with no override the function writes nothing.
 */
export const POWERSHELL_CONSOLE_WRITER = [
  'function K(){ if($script:KT){return $script:KT}',
  '$an=New-Object Reflection.AssemblyName("cuihud")',
  '$ab=$null',
  'try{$ab=[Reflection.Emit.AssemblyBuilder]::DefineDynamicAssembly($an,[Reflection.Emit.AssemblyBuilderAccess]::Run)}catch{$ab=[AppDomain]::CurrentDomain.DefineDynamicAssembly($an,[Reflection.Emit.AssemblyBuilderAccess]::Run)}',
  '$tb=$ab.DefineDynamicModule("cuihud").DefineType("K",[Reflection.TypeAttributes]::Public)',
  '$ma=[Reflection.MethodAttributes]"Public,Static,PinvokeImpl"',
  '$d=@(@("FreeConsole",[bool],@()),@("AttachConsole",[bool],@([uint32])),@("CloseHandle",[bool],@([IntPtr])),@("CreateFileW",[IntPtr],@([string],[uint32],[uint32],[IntPtr],[uint32],[uint32],[IntPtr])),@("WriteConsoleW",[bool],@([IntPtr],[string],[uint32],[uint32].MakeByRefType(),[IntPtr])))',
  'foreach($x in $d){$m=$tb.DefinePInvokeMethod($x[0],"kernel32.dll",$ma,[Reflection.CallingConventions]::Standard,$x[1],[Type[]]$x[2],[Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::Unicode); $m.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)}',
  '$script:KT=$tb.CreateType(); return $script:KT }',
  // Parent pid: Process.Parent is PowerShell 7; CIM is the 5.1 fallback.
  'function P($p){ try{$x=(Get-Process -Id $p -ErrorAction Stop).Parent; if($x){return [int]$x.Id}}catch{}; try{return [int](Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p)).ParentProcessId}catch{}; return $null }',
  'function W($o){ $s=[string][char]27+"]7777;"+$o+[string][char]7',
  'if($env:CUIHUD_WIN_CONOUT){[IO.File]::AppendAllText($env:CUIHUD_WIN_CONOUT,$s); return}',
  'if([Environment]::OSVersion.Platform -ne "Win32NT"){return}',
  '$k=K; $t=$null; $p=$PID',
  // Up to eight ancestors: our pwsh ← (powershell runner | sh) ← claude, or
  // pwsh ← codex. The agent is the process whose console is the pseudoconsole.
  'for($n=0;$n -lt 8;$n++){ $pp=P $p; if(-not $pp -or $pp -le 4){break}; $nm=""; try{$nm=(Get-Process -Id $pp -ErrorAction Stop).ProcessName}catch{}; if($nm -match "^(claude|node|bun|codex)$"){$t=$pp;break}; $p=$pp }',
  'if($t){ [void]$k::FreeConsole(); [void]$k::AttachConsole([uint32]$t) }',
  // GENERIC_READ|GENERIC_WRITE, FILE_SHARE_READ|FILE_SHARE_WRITE, OPEN_EXISTING.
  '$h=$k::CreateFileW("CONOUT$",[uint32]3221225472,[uint32]3,[IntPtr]::Zero,[uint32]3,[uint32]0,[IntPtr]::Zero)',
  'if($h -ne [IntPtr]::Zero -and $h -ne [IntPtr](-1)){ $n=[uint32]0; [void]$k::WriteConsoleW($h,$s,[uint32]$s.Length,[ref]$n,[IntPtr]::Zero); [void]$k::CloseHandle($h) } }',
  // Test seam: prove the P/Invoke type defines on this PowerShell.
  'if($env:CUIHUD_WIN_SELFTEST){ $kk=K; [Console]::Out.Write((($kk.GetMethods() | Where-Object {$_.DeclaringType -eq $kk} | ForEach-Object {$_.Name} | Sort-Object) -join ",")) }'
]

/**
 * Codex's notify command on a Windows host.
 *
 * Codex spawns notify DIRECTLY, with no shell, and Git for Windows does not
 * put `sh.exe` on PATH (only `git.exe`, under `Git\cmd`). So a Windows host
 * gets `powershell` instead of `sh`.
 *
 * Two Windows-only hazards shape the script, and both are why this is not a
 * transliteration of the sh one:
 *
 *  - `powershell -Command <string> <more args>` does NOT bind the extra args
 *    to `$args`; it APPENDS them to the command text. A raw JSON token pasted
 *    onto the end would be re-parsed by PowerShell (whose strings do not
 *    understand `\"`) and would fail the whole command, script and all. So the
 *    script ends in a `#`, which makes whatever is appended a comment, and…
 *  - …the thread id is read from `[Environment]::GetCommandLineArgs()`, which
 *    is the real argv as Windows parsed it, not PowerShell's re-parse.
 *
 * No single quotes: PowerShell's literal-string quote is the one character
 * that would end the token Orca hands the host shell, so every string here is
 * double-quoted and every embedded quote comes from `$q = [char]34`. Likewise
 * ESC and BEL are built from `[char]27`/`[char]7` rather than `` `e ``, which
 * Windows PowerShell 5.1 does not know.
 *
 * Executed for real under PowerShell 7.6.6 on macOS (2026-09-10): the beacon
 * carries model, effort, used and win from the rollout fixture, and a notify
 * command from config.toml runs with the JSON as its last argument. That run
 * found three defects the shape checks had missed (thread id read from the
 * script's own text, backslash globs, Start-Process splitting arguments).
 * Still unrun: Windows PowerShell 5.1, and a real Windows console.
 */
export const CODEX_HUD_NOTIFY_POWERSHELL = [
  '$ErrorActionPreference="SilentlyContinue"',
  '$q=[char]34',
  '$E={param($s) ($s -replace "%","%25" -replace " ","%20" -replace ";","%3B")}',
  '$a=[Environment]::GetCommandLineArgs()',
  // Only the LAST argument is Codex's JSON. The argv also carries this very
  // script as the -Command text, and its own regex literal contains
  // "thread.id" — matching the whole line picked that up and read the thread
  // id as "0-9A-Za-z" (found running it under pwsh 7.6.6, 2026-09-10).
  '$r=""',
  'if($a.Count -gt 0){$r=[string]$a[$a.Count-1]}',
  '$t=""',
  'if($r -match "thread.id[^0-9A-Za-z]{1,4}([0-9A-Za-z-]{8,64})"){$t=$Matches[1]}',
  '$h=$env:CODEX_HOME',
  'if(-not $h){$h=Join-Path $env:USERPROFILE ".codex"}',
  // With no thread id, the newest rollout is the session that just replied.
  // Forward slashes: Windows accepts them everywhere, and pwsh on macOS and
  // Linux (where this is tested) does not treat a backslash as a separator.
  '$g="sessions/*/*/*/rollout-*.jsonl"',
  'if($t){$g="sessions/*/*/*/rollout-*-"+$t+".jsonl"}',
  '$f=Get-ChildItem -Path (Join-Path $h $g) | Sort-Object LastWriteTime | Select-Object -Last 1',
  '$o="CUIHUD1 agent=codex"',
  // `$t` is already `[0-9A-Za-z-]`, so it needs no encoding.
  'if($t){$o=$o+" sid="+$t}',
  'if($f){$L=Get-Content -LiteralPath $f.FullName -Tail 400',
  '$c=$L | Where-Object {$_ -match ($q+"type"+$q+":"+$q+"turn_context"+$q)} | Select-Object -Last 1',
  'if($c -match ($q+"model"+$q+":"+$q+"([^"+$q+"]*)"+$q)){$o=$o+" model="+(& $E $Matches[1])}',
  // "effort":" cannot match inside "reasoning_effort":" — the byte before
  // `effort` must be a quote — so the first match is the real one.
  'if($c -match ($q+"effort"+$q+":"+$q+"([^"+$q+"]*)"+$q)){$o=$o+" effort="+(& $E $Matches[1])}',
  '$k=$L | Where-Object {$_ -match ($q+"type"+$q+":"+$q+"token_count"+$q)} | Select-Object -Last 1',
  'if($k -match ($q+"last_token_usage"+$q+":\\{[^}]*"+$q+"total_tokens"+$q+":(\\d+)")){$o=$o+" used="+$Matches[1]}',
  'if($k -match ($q+"model_context_window"+$q+":(\\d+)")){$o=$o+" win="+$Matches[1]}}',
  // Not stdout: Codex spawns notify with every stdio nulled, so the beacon
  // goes to the console it shares with Codex, via the shared writer.
  ...POWERSHELL_CONSOLE_WRITER.map((line) => line.replace(/\n/g, ' ')),
  'W $o',
  // Delegation, best effort and deliberately narrow: a single-line
  // `notify = ["a","b"]` in config.toml, run with the same JSON argument.
  '$cf=Join-Path $h "config.toml"',
  '$m=Select-String -Path $cf -Pattern "^\\s*notify\\s*=\\s*\\[(.*)\\]" | Select-Object -First 1',
  // TOML basic strings: undo \" and \\ . Then the call operator, not
  // Start-Process: Start-Process re-joins -ArgumentList into one command line
  // and re-splits it, so an argument with a space or a quote (any `sh -c`
  // script) arrives in pieces — seen under pwsh 7.6.6. `&` hands each element
  // over as one argv entry on every platform.
  // -cnotmatch: PowerShell's -notmatch ignores case, and the sh notify's own
  // argv0 is "cuihud", so the recursion guard was firing on every real config.
  'if($m -and $m.Matches[0].Groups[1].Value -cnotmatch "CUIHUD"){$p=@($m.Matches[0].Groups[1].Value -split "," | ForEach-Object {$_.Trim().Trim($q).Replace("\\"+$q,$q).Replace("\\\\","\\")})',
  '$z=@()',
  'if($p.Count -gt 1){$z=@($p[1..($p.Count-1)])}',
  '$z=$z+@($r)',
  'if($p.Count -ge 1 -and $p[0]){& $p[0] @z}}',
  // Everything PowerShell appends after the command string lands in here.
  '#'
].join('; ')


/**
 * Claude Code's status-line command for a Windows host.
 *
 * Why a second script: on Windows the sh script cannot work. If Git Bash is
 * present, Claude Code runs the command through it, but the child sits in a
 * hidden console (see POWERSHELL_CONSOLE_WRITER) and `/dev/tty` is that hidden
 * console, not the pseudoconsole. If Git Bash is absent, Claude Code runs the
 * command under PowerShell (`shell ?? (bash-found ? "bash" : "powershell")`,
 * read from 2.1.267) and sh syntax fails outright. Both cases need PowerShell
 * with a console attach, so both get this script.
 *
 * Why -EncodedCommand: the same command text is parsed by sh on one host and
 * by PowerShell on another, and no quoting survives both. Base64 (UTF-16LE,
 * what -EncodedCommand expects) has no quotes at all; `powershell` is Windows
 * PowerShell 5.1, present on every Windows. Line breaks separate statements,
 * so no `;` and no trailing `#` are needed.
 *
 * Verified under PowerShell 7.6.6 on macOS with the console write redirected
 * to a file (CUIHUD_WIN_CONOUT); the kernel32 path itself needs Windows.
 */
export const CLAUDE_HUD_STATUSLINE_POWERSHELL = [
  '$ErrorActionPreference="SilentlyContinue"',
  '$i=[Console]::In.ReadToEnd()',
  '$j=$null',
  'try{$j=$i | ConvertFrom-Json}catch{}',
  '$E={param($s) ([string]$s -replace "%","%25" -replace " ","%20" -replace ";","%3B")}',
  `$o="CUIHUD1 agent=claude hk=1 hb=${CLAUDE_HUD_HEARTBEAT_SECONDS_WIN32}"`,
  'if($j.session_id){$o=$o+" sid="+(& $E $j.session_id)}',
  'if($j.model.id){$o=$o+" model="+(& $E $j.model.id)}',
  'if($j.model.display_name){$o=$o+" name="+(& $E $j.model.display_name)}',
  'if($j.effort.level){$o=$o+" effort="+(& $E $j.effort.level)}',
  '$cu=$j.context_window.current_usage',
  'if($cu -and $cu.input_tokens -ne $null){$o=$o+" used="+([int64]$cu.input_tokens+[int64]$cu.cache_creation_input_tokens+[int64]$cu.cache_read_input_tokens)}',
  'if($j.context_window.context_window_size){$o=$o+" win="+[int64]$j.context_window.context_window_size}',
  'if($j.context_window.used_percentage -ne $null){$o=$o+" pct="+[int][math]::Floor([double]$j.context_window.used_percentage)}',
  '$f=$j.rate_limits.five_hour',
  'if($f -and $f.used_percentage -ne $null){$ra=0; if($f.resets_at){$ra=[int64]$f.resets_at}; $o=$o+" h5="+[int][math]::Floor([double]$f.used_percentage)+":"+$ra}',
  '$w=$j.rate_limits.seven_day',
  'if($w -and $w.used_percentage -ne $null){$rb=0; if($w.resets_at){$rb=[int64]$w.resets_at}; $o=$o+" d7="+[int][math]::Floor([double]$w.used_percentage)+":"+$rb}',
  // Finished and launched background tasks, as in the sh script: every
  // <task-id> with a <status> in the transcript tail is a task-notification,
  // mid-turn ones included, and every tool_result whose content starts with
  // Claude's launch text is a shell. Assistant records are skipped.
  '$tp=[string]$j.transcript_path',
  '$q=[char]34; $pa=$q+"type"+$q+":"+$q+"assistant"+$q',
  'if($tp -and (Test-Path -LiteralPath $tp)){$tl=@(Get-Content -LiteralPath $tp -Tail 8000 | Where-Object {$_ -notmatch $pa}); $ids=@($tl | Where-Object {$_ -match "<status>"} | Select-String -Pattern "<task-id>([A-Za-z0-9_-]{3,})</task-id>" -AllMatches | ForEach-Object {$_.Matches} | ForEach-Object {$_.Groups[1].Value} | Select-Object -Unique | Select-Object -Last 32); if($ids.Count -gt 0){$o=$o+" done="+($ids -join ",")}; $bg=@($tl | Select-String -Pattern ($q+"content"+$q+":"+$q+"Command (?:running in background with ID: |did not complete[^"+$q+"]*moved to the background \\(ID: |was manually backgrounded by user with ID: |was moved to the background \\(ID: )([A-Za-z0-9_-]{3,})") -AllMatches | ForEach-Object {$_.Matches} | ForEach-Object {$_.Groups[1].Value} | Select-Object -Unique | Select-Object -Last 32); if($bg.Count -gt 0){$o=$o+" bg="+($bg -join ",")}}',
  // Delegation: the user keeps their own bar. Their command runs under Git
  // Bash when it exists (what Claude Code itself would have used), else under
  // this same PowerShell. Its stdout is ours, which Claude Code draws.
  '$c=""',
  '$wd=[string]$j.cwd',
  '$cd=$env:CLAUDE_CONFIG_DIR',
  'if(-not $cd){ $hp=$env:USERPROFILE; if(-not $hp){$hp=$HOME}; $cd=Join-Path $hp ".claude" }',
  '$cands=@()',
  'if($wd){$cands=$cands+@((Join-Path $wd ".claude/settings.local.json"),(Join-Path $wd ".claude/settings.json"))}',
  '$cands=$cands+@((Join-Path $cd "settings.local.json"),(Join-Path $cd "settings.json"))',
  'foreach($sf in $cands){ if(-not $c -and (Test-Path -LiteralPath $sf)){ try{ $st=Get-Content -LiteralPath $sf -Raw | ConvertFrom-Json; if($st.statusLine.type -eq "command" -and $st.statusLine.command){$c=[string]$st.statusLine.command} }catch{} } }',
  'if($c -and $c -cnotmatch "CUIHUD"){ if(Get-Command sh -ErrorAction SilentlyContinue){ $i | & sh -c $c } else { $i | & powershell -NoProfile -NonInteractive -Command $c } }',
  ...POWERSHELL_CONSOLE_WRITER,
  'W $o',
  'exit 0'
].join('\n')

/** `powershell -EncodedCommand` takes UTF-16LE base64. */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export const CLAUDE_HUD_WINDOWS_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(CLAUDE_HUD_STATUSLINE_POWERSHELL)}`

/**
 * Claude Code's Stop hook, as the authority on what is still running.
 *
 * Why this exists: the phone used to infer background tasks from the
 * transcript, because nothing told it. That inference cannot see a completion
 * recorded mid-turn — Claude writes those as records Orca's reader never
 * surfaces — so tasks piled up. Measured 2026-09-10 against a real session:
 * the reader claimed 36 running when 3 were.
 *
 * The agent knows exactly. Its Stop payload carries `background_tasks` with an
 * `id` and a `status` each (verified against Claude Code 2.1.267; the captured
 * payload is the fixture beside this file's test; 2.1.283 builds the Stop and
 * UserPromptSubmit payloads with 2.1.282's code, 2026-09-26). The hook beacons
 * the ids still running, and the phone takes that over its own guesswork.
 *
 * Parsed with tr, grep and sed alone: a Claude Code native install is a single
 * binary, so the host may have no node, python3 or jq — the same reason the
 * status line carries four readers. Splitting on `{` puts one task per line;
 * the id is read only from a line that also says it is running.
 *
 * `run=` is always emitted, empty included: an absent field means "no answer",
 * an empty one means "nothing is running", and the phone needs the difference
 * to clear the row on the last task.
 *
 * Teammates are left off. The payload names one `type: teammate` — Claude
 * Code writes each task's type through an alias table (`in_process_teammate`
 * → `teammate`, `local_bash` → `shell`, `local_agent` → `subagent`; 2.1.281
 * to 2.1.283), so a filter on the internal name never matched (2026-09-26);
 * both names are dropped. The payload calls one
 * `running` for as long as it exists, idle included — on 2026-09-12 four
 * council reviewers a day idle put "4 running tasks" on the phone while the
 * desk's /tasks showed none. A teammate is a peer to message, not work that
 * reports back; when one IS working, Orca's SubagentStart/Stop hooks carry it.
 */
export const CLAUDE_HUD_STOP_HOOK_SCRIPT = [
  'i=$(cat 2>/dev/null || true)',
  'rn=$(printf %s "$i" | tr "{" "\\n" | grep -v -E "\\"type\\"[[:space:]]*:[[:space:]]*\\"(in_process_)?teammate\\"" 2>/dev/null | grep "\\"status\\"[[:space:]]*:[[:space:]]*\\"running\\"" 2>/dev/null | sed -nE "s/.*\\"id\\"[[:space:]]*:[[:space:]]*\\"([A-Za-z0-9_-]+)\\".*/\\\\1/p" | awk "!s[\\$0]++" | tail -n 64 | tr "\\n" ",")',
  // `sid`: the session this list belongs to; see the status line. Only an id's
  // own characters, so a stray quote or space can never break the grammar.
  'si=$(printf %s "$i" | sed -nE "s/.*\\"session_id\\"[[:space:]]*:[[:space:]]*\\"([A-Za-z0-9._-]+)\\".*/\\\\1/p" | head -n 1)',
  // `effort`: Stop's input is built with a tool context, which is what makes
  // Claude Code add `effort:{level}` to it (2.1.289, function `rd`; absent for
  // a model that takes none, and no `effort` key means no `effort=` field, never
  // a guess). A quoted copy inside `last_assistant_message` is JSON-escaped
  // (`\"effort\"`) and cannot match. This is how a pick made for the session
  // only, which no settings file records, reaches the phone without a status
  // line: the next Stop says what the session now sends.
  'ef=$(printf %s "$i" | LC_ALL=C sed -nE "s/.*\\"effort\\":\\{\\"level\\":\\"([a-z]+)\\"\\}.*/\\1/p" | head -n 1)',
  'o="CUIHUD1 agent=claude${si:+ sid=$si} run=${rn%,}${ef:+ effort=$ef}"',
  ...AGENT_HUD_TTY_WRITE
].join('; ')

/**
 * The same prompt beacon on a Windows host with no Git Bash. Runs for real
 * under PowerShell 7 in tests; it has NOT run on Windows.
 */
export const CLAUDE_HUD_PROMPT_HOOK_POWERSHELL = [
  '$ErrorActionPreference="SilentlyContinue"',
  '$i=[Console]::In.ReadToEnd()',
  '$j=$null',
  'try{$j=$i | ConvertFrom-Json}catch{}',
  '$pr=""',
  'if($j -and $j.prompt){ $pr=[string]$j.prompt }',
  '$ct=""',
  'if($pr.Length -gt 2000){ $pr=$pr.Substring(0,2000); $ct=" cut=1" }',
  // Send the JSON string BODY, exactly as the sh hook does: the phone undoes
  // one escaping, and a Windows path in the prompt must not lose its
  // backslashes on the way (2026-09-13).
  '$pr=(ConvertTo-Json $pr -Compress)',
  'if($pr.Length -ge 2){ $pr=$pr.Substring(1,$pr.Length-2) }',
  '$pr=$pr -replace "%","%25" -replace " ","%20" -replace ";","%3B"',
  // `at=<uuid>`: the last user/assistant row at submit time, as the sh hook
  // captures it, so the phone anchors a queued prompt where the record sits.
  'if($j -and $j.transcript_path -and (Test-Path -LiteralPath $j.transcript_path)){ $tl=@(Get-Content -LiteralPath $j.transcript_path -Tail 4000 | Where-Object {$_ -match \'"type":"(user|assistant)"\'}); if($tl.Count -gt 0){ $m=[regex]::Match($tl[-1], \'"uuid":"([0-9a-fA-F-]+)"\'); if($m.Success){ $at=$m.Groups[1].Value } } }',
  // `sid`: the session, as the sh hook sends it. No shape guard here on
  // purpose: every source char costs ~2.7 on the Windows command line, which
  // is nearly at its ceiling, and the phone refuses an id outside
  // `[A-Za-z0-9._-]` (`agent-hud-beacon.ts`).
  '$sid=""; if($j.session_id){$sid=" sid="+$j.session_id}',
  '$o="CUIHUD1 agent=claude" + $sid + " up=" + $PID + ":" + $pr + $ct',
  'if($at){ $o=$o + " at=" + $at }',
  ...POWERSHELL_CONSOLE_WRITER.map((line) => line.replace(/\n/g, ' ')),
  // The console writer above defines `W`; a call to a name it never
  // defined was swallowed by SilentlyContinue and wrote nothing (2026-09-13).
  'if($pr){ W $o }',
  'exit 0'
].join('\n')

/**
 * The Stop hook on a Windows host with no Git Bash, which runs hooks under
 * PowerShell. Same contract as the sh script: beacon the ids the agent says
 * are still running, always emitting `run=` even when empty. Written to the
 * agent's own console through the same P/Invoke writer the status line uses,
 * because a hook child there sits in a hidden console.
 *
 * Runs for real under PowerShell 7 in tests. It has NOT run on Windows.
 */
export const CLAUDE_HUD_STOP_HOOK_POWERSHELL = [
  '$ErrorActionPreference="SilentlyContinue"',
  '$i=[Console]::In.ReadToEnd()',
  '$j=$null',
  'try{$j=$i | ConvertFrom-Json}catch{}',
  '$ids=@()',
  'if($j -and $j.background_tasks){ $ids=@($j.background_tasks | Where-Object { $_.status -eq "running" -and $_.type -ne "teammate" -and $_.type -ne "in_process_teammate" } | ForEach-Object { [string]$_.id } | Where-Object { $_ } | Select-Object -Unique | Select-Object -First 64) }',
  '$sid=""; if($j.session_id){$sid=" sid="+$j.session_id}',
  '$o="CUIHUD1 agent=claude" + $sid + " run=" + ($ids -join ",")',
  ...POWERSHELL_CONSOLE_WRITER.map((line) => line.replace(/\n/g, ' ')),
  'W $o'
].join('\n')

export const CLAUDE_HUD_STOP_HOOK_WINDOWS_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(CLAUDE_HUD_STOP_HOOK_POWERSHELL)}`

export const CLAUDE_HUD_PROMPT_HOOK_WINDOWS_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(CLAUDE_HUD_PROMPT_HOOK_POWERSHELL)}`

export function buildClaudeHudSettingsJson(hostPlatform: NodeJS.Platform | null = null): string {
  return JSON.stringify({
    statusLine: {
      type: 'command',
      command: hostPlatform === 'win32' ? CLAUDE_HUD_WINDOWS_COMMAND : CLAUDE_HUD_STATUSLINE_SCRIPT,
      // The heartbeat: see CLAUDE_HUD_HEARTBEAT_SECONDS. A user's own bar runs
      // on the same beat, which is their bar repainting, not a row of ours.
      refreshInterval:
        hostPlatform === 'win32' ? CLAUDE_HUD_HEARTBEAT_SECONDS_WIN32 : CLAUDE_HUD_HEARTBEAT_SECONDS
    },
    // Why a hook as well as the status line: the status line says what the
    // agent IS, the Stop hook says what it still has running. Both ride the
    // same --settings flag, so the host still gains no file and no config.
    hooks: {
      // The model a session starts on, before any prompt or status-line tick.
      // POSIX hosts only: it is an sh script, and a Windows host takes no
      // flag at all (hostTakesAgentHudFlag).
      ...(hostPlatform === 'win32'
        ? {}
        : {
            SessionStart: [
              { hooks: [{ type: 'command', command: CLAUDE_HUD_SESSION_START_HOOK_SCRIPT }] }
            ]
          }),
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command:
                hostPlatform === 'win32'
                  ? CLAUDE_HUD_STOP_HOOK_WINDOWS_COMMAND
                  : CLAUDE_HUD_STOP_HOOK_SCRIPT
            }
          ]
        }
      ],
      // A prompt typed on the desktop mid-turn never reaches the phone
      // through Orca; this hook puts its text on the same beacon.
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command:
                hostPlatform === 'win32'
                  ? CLAUDE_HUD_PROMPT_HOOK_WINDOWS_COMMAND
                  : CLAUDE_HUD_PROMPT_HOOK_SCRIPT
            }
          ]
        }
      ]
    }
  })
}

/**
 * Codex parses a `-c key=value` override as TOML.
 *
 * The sh script cannot be inlined: a TOML basic string rejects the `\033` in
 * it outright. Base64 keeps the value to `[A-Za-z0-9+/=]` plus a fixed
 * wrapper, and no quoting can break it. `base64 -d` is spelled the same on
 * macOS and GNU coreutils.
 *
 * The PowerShell script goes in as text, because its ESC comes from
 * `[char]27` and not an escape — but its `\*`, `\{`, `\s` and `\d` would still
 * be invalid TOML escapes, so every backslash is doubled (which is exactly
 * what `JSON.stringify` does, and TOML decodes back). A TOML literal string
 * would avoid that, but its delimiter is the single quote, which is the one
 * character that would end the shell token Orca hands the host.
 */
export function buildCodexHudNotifyOverride(hostPlatform: NodeJS.Platform | null): string {
  if (hostPlatform === 'win32') {
    const script = JSON.stringify(CODEX_HUD_NOTIFY_POWERSHELL)
    return `notify=["powershell","-NoProfile","-NonInteractive","-Command",${script}]`
  }
  const encoded = Buffer.from(CODEX_HUD_NOTIFY_SCRIPT, 'utf8').toString('base64')
  return `notify=["sh","-c","eval \\"$(printf %s ${encoded} | base64 -d)\\"","cuihud"]`
}

/** Escape for a single-quoted POSIX token: Orca tokenizes agent args with the
 *  Unix grammar once and re-quotes each token for the host shell itself. */
function singleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function agentHudLaunchFlag(
  agent: 'claude' | 'codex',
  hostPlatform: NodeJS.Platform | null
): string {
  return agent === 'claude'
    ? // Same flag everywhere; a win32 host gets the PowerShell command inside it.
      `--settings ${singleQuoted(buildClaudeHudSettingsJson(hostPlatform))}`
    : `-c ${singleQuoted(buildCodexHudNotifyOverride(hostPlatform))}`
}

/**
 * No beacon flag for a Windows host (2026-09-25: its Claude would not start,
 * "Error: Invalid JSON provided to --settings", because Windows PowerShell 5.1
 * strips the double quotes inside a native program's argument). The writers
 * above stay, tested under PowerShell 7, until a launch encoding is proven on
 * a real Windows machine. A missing HUD beats an agent that will not start.
 * None for a host whose platform is unknown either: that is a failed
 * `status.get`, and it may be the same Windows host.
 */
export function hostTakesAgentHudFlag(hostPlatform: NodeJS.Platform | null): boolean {
  return hostPlatform !== null && hostPlatform !== 'win32'
}

/**
 * The launch arguments for one agent: the host's own defaults kept in front,
 * ours appended in place of any flag of ours already saved there (the desktop
 * sync's, or an older build's), so a profile the sync flagged launches exactly
 * as saved. Null for an agent with no beacon channel, on a host that
 * takes no flag (`hostTakesAgentHudFlag`), or when the host's args carry the
 * user's own `--settings` or `-c notify=`, which ours would replace
 * (`agent-hud-launch-flag-owner.ts`), so the host launches exactly as it
 * always did.
 */
export function buildAgentHudLaunchArgs(args: {
  agent: TuiAgent
  /** The host's own default args for this agent, kept in front of ours. */
  hostDefaultArgs: string
  /** From `status.get`; decides which Codex notify command the host can run. */
  hostPlatform: NodeJS.Platform | null
}): string | null {
  if ((args.agent !== 'claude' && args.agent !== 'codex') || !hostTakesAgentHudFlag(args.hostPlatform)) {
    return null
  }
  const flags = readHudLaunchFlags(args.agent, args.hostDefaultArgs, args.hostPlatform)
  if (!flags.readable || flags.usersOwn) {
    const refusal = !flags.readable ? `they do not split (${flags.reason})` : `they carry the user's own ${flags.usersOwn}, which ours would replace`
    console.warn(`[hud-launch-args] ${args.agent}: no beacon flag on this tab's args: ${refusal}`)
    return null
  }
  return withOurFlagLast(args.hostDefaultArgs, flags.ours, agentHudLaunchFlag(args.agent, args.hostPlatform))
}
