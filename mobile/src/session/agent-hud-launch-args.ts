// Why: import from 'buffer' (the npm polyfill), not 'node:buffer' because
// Metro cannot resolve Node builtins in a React Native bundle.
import { Buffer } from 'buffer'
import type { TuiAgent } from '../../../src/shared/tui-agent'

/**
 * The HUD's data source: the agents' own live state, carried to the phone on
 * an INVISIBLE escape sequence written straight to the PTY. Nothing is drawn
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
 *    gives `ttys003` on macOS and `pts/3` on Linux) and writes ONE
 *    `ESC ] 7777 ; <payload> BEL` to `/dev/<tty>`. Terminals draw nothing for
 *    an unknown OSC; the phone already receives the raw PTY byte stream and
 *    sniffs the sequence out of it (`agent-hud-beacon.ts`).
 *  - Windows has no PTY device path to walk to, so both halves take a
 *    different route there. Claude Code runs its status-line command through
 *    Git Bash, so the same sh script detects MSYS from `uname -s` and writes
 *    to `/dev/tty` (MSYS's name for the attached console, which is Claude's
 *    own under ConPTY), then `/dev/conout`. Codex spawns notify with NO shell
 *    and Git for Windows puts no `sh.exe` on PATH, so a win32 host gets a
 *    PowerShell notify command instead (`CODEX_HUD_NOTIFY_POWERSHELL`).
 *    **The whole Windows path is untested on a real Windows machine.**
 *
 * The POSIX scripts use `sed`, `printf`, `tail`, `tr` and `ps` only: no node,
 * no jq, no python for the payload itself. (Claude's DELEGATION step below
 * does reach for node/python3/jq, but only to read the user's own settings
 * file, and Claude Code is itself a Node program.)
 */

/**
 * Finds the terminal to write to and writes `$o` there. Two ways in:
 *
 *  - Unix: the child has no controlling tty of its own, so walk up at most six
 *    parents for one (`ps -o tty=` → `ttys003` on macOS, `pts/3` on Linux) and
 *    write to `/dev/<that>`. Every `ps` is guarded: MSYS's own `ps` has no
 *    `-o tty=`, and the walk must never make noise or fail the script.
 *  - Windows: Claude Code runs status-line commands through Git Bash, where
 *    there is no PTY device to walk to. MSYS maps `/dev/tty` to the attached
 *    console instead, and the command inherits Claude's console under ConPTY —
 *    which is the stream Orca forwards. `/dev/conout` is the second try.
 *    UNTESTED on a real Windows host; see docs/mobile-agent-hud.md.
 *
 * One `printf`, so the whole sequence is a single write() the phone sees whole
 * far more often than not. The sniffer stitches a split one anyway.
 *
 * `CUIHUD_TTY` overrides the device; `CUIHUD_WIN_TTY` and `CUIHUD_WIN_CONOUT`
 * override the two Windows ones. Tests point them at temp files.
 * Quoted case patterns: an unquoted `?` would glob-match any single char.
 */
const TTY_WRITE = [
  // `2>/dev/null` FIRST: a failing `>>` is reported by the shell on fd 2, and
  // that must already be /dev/null or a Windows host with no console would
  // print an error into the terminal this exists to leave alone.
  'w(){ printf "\\033]7777;%s\\007" "$o" 2>/dev/null >> "$1"; }',
  'tt=$CUIHUD_TTY',
  'wn=0',
  'case $(uname -s 2>/dev/null || true) in MSYS*|MINGW*|CYGWIN*) wn=1;; esac',
  'if [ -z "$tt" ] && [ "$wn" = 0 ]; then pw=$PPID; nw=0; while [ -n "$pw" ] && [ "$pw" != 1 ] && [ $nw -lt 6 ]; do dv=$(ps -o tty= -p "$pw" 2>/dev/null | tr -d " " || true); case "$dv" in ""|"?"|"??") pw=$(ps -o ppid= -p "$pw" 2>/dev/null | tr -d " " || true);; *) tt="/dev/$dv"; break;; esac; nw=$((nw+1)); done; fi',
  'if [ -n "$tt" ]; then w "$tt"; elif [ "$wn" = 1 ]; then w "${CUIHUD_WIN_TTY:-/dev/tty}" || w "${CUIHUD_WIN_CONOUT:-/dev/conout}"; fi'
]

/** Percent-encodes what would otherwise break the `key=value` grammar:
 *  `%` first (or it would double-encode), then space and `;`. */
const ENCODE_FN = 'q(){ printf %s "$1" | sed -e "s/%/%25/g" -e "s/ /%20/g" -e "s/;/%3B/g"; }'

/**
 * Claude Code's status-line command.
 *
 * The JSON Claude Code pipes in is a SINGLE line, so anchored `sed` captures
 * are safe; the greedy `.*` prefix takes the last match of each pattern, and
 * `used_percentage` is disambiguated by the `remaining_percentage` that only
 * the context block carries. `current_usage` and `used_percentage` are null
 * before the first reply, in which case those keys are simply left off the
 * payload — the phone shows what is known and nothing else.
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
  'mi=$(g "\\"model\\":\\{\\"id\\":\\"([^\\"]*)\\"")',
  'mn=$(g "\\"display_name\\":\\"([^\\"]*)\\"")',
  'ef=$(g "\\"effort\\":\\{\\"level\\":\\"([^\\"]*)\\"")',
  'pc=$(g "\\"used_percentage\\":([0-9.]+),\\"remaining_percentage\\"")',
  'cw=$(g "\\"context_window_size\\":([0-9]+)")',
  'ta=$(g "\\"current_usage\\":\\{\\"input_tokens\\":([0-9]+)")',
  'tb=$(g "\\"cache_creation_input_tokens\\":([0-9]+)")',
  'tc=$(g "\\"cache_read_input_tokens\\":([0-9]+)")',
  'ha=$(g "\\"five_hour\\":\\{\\"used_percentage\\":([0-9.]+)")',
  'hb=$(g "\\"five_hour\\":\\{\\"used_percentage\\":[0-9.]+,\\"resets_at\\":([0-9]+)")',
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
  // status for every EVENT while it is still running.
  '[ -n "$tp" ] && [ -r "$tp" ] && dn=$(tail -c 1048576 "$tp" 2>/dev/null | grep "<status>" 2>/dev/null | grep -o "<task-id>[A-Za-z0-9_-]*</task-id>" 2>/dev/null | sed -e "s/<task-id>//" -e "s#</task-id>##" | awk "!s[\\$0]++" | tail -n 32 | tr "\\n" ",")',
  // Every shell Claude has started, from its own tool results: "Command running
  // in background with ID: <id>" and "moved to the background (ID: <id>)".
  // Same tail, same tools. Launched minus done is what is still running, and
  // it is right mid-turn — the Stop hook's `run=` list is only as fresh as the
  // last turn end, and a 858k-token session's launches sit far above the
  // window the phone loads. Measured 2026-09-11: the desk read "3 shells",
  // the phone "1".
  'bg=""',
  '[ -n "$tp" ] && [ -r "$tp" ] && bg=$(tail -c 1048576 "$tp" 2>/dev/null | grep -o -e "background with ID: [A-Za-z0-9_-]*" -e "background (ID: [A-Za-z0-9_-]*" 2>/dev/null | sed -e "s/.*ID: //" | awk "!s[\\$0]++" | tail -n 32 | tr "\\n" ",")',
  'o="CUIHUD1 agent=claude"',
  '[ -n "$mi" ] && o="$o model=$(q "$mi")"',
  '[ -n "$mn" ] && o="$o name=$(q "$mn")"',
  '[ -n "$ef" ] && o="$o effort=$(q "$ef")"',
  '[ -n "$ta" ] && o="$o used=$((ta+${tb:-0}+${tc:-0}))"',
  '[ -n "$cw" ] && o="$o win=$cw"',
  '[ -n "$pc" ] && o="$o pct=${pc%.*}"',
  '[ -n "$ha" ] && o="$o h5=${ha%.*}:${hb:-0}"',
  '[ -n "$wa" ] && o="$o d7=${wa%.*}:${wb:-0}"',
  '[ -n "$dn" ] && o="$o done=${dn%,}"',
  '[ -n "$bg" ] && o="$o bg=${bg%,}"',
  ...TTY_WRITE,
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
  '[ -n "$md" ] && o="$o model=$(q "$md")"',
  '[ -n "$ef" ] && o="$o effort=$(q "$ef")"',
  '[ -n "$tk" ] && o="$o used=$tk"',
  '[ -n "$cw" ] && o="$o win=$cw"',
  ...TTY_WRITE,
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
  '$o="CUIHUD1 agent=claude"',
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
  // Finished background tasks, as in the sh script: every <task-id> in the
  // transcript tail is a task-notification, mid-turn ones included.
  '$tp=[string]$j.transcript_path',
  'if($tp -and (Test-Path -LiteralPath $tp)){$ids=@(Get-Content -LiteralPath $tp -Tail 2000 | Where-Object {$_ -match "<status>"} | Select-String -Pattern "<task-id>([A-Za-z0-9_-]+)</task-id>" -AllMatches | ForEach-Object {$_.Matches} | ForEach-Object {$_.Groups[1].Value} | Select-Object -Unique | Select-Object -Last 32); if($ids.Count -gt 0){$o=$o+" done="+($ids -join ",")}}',
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
 * payload is the fixture beside this file's test). The hook beacons the ids
 * still running, and the phone takes that over its own guesswork.
 *
 * Parsed with tr, grep and sed alone: a Claude Code native install is a single
 * binary, so the host may have no node, python3 or jq — the same reason the
 * status line carries four readers. Splitting on `{` puts one task per line;
 * the id is read only from a line that also says it is running.
 *
 * `run=` is always emitted, empty included: an absent field means "no answer",
 * an empty one means "nothing is running", and the phone needs the difference
 * to clear the row on the last task.
 */
export const CLAUDE_HUD_STOP_HOOK_SCRIPT = [
  'i=$(cat 2>/dev/null || true)',
  'rn=$(printf %s "$i" | tr "{" "\\n" | grep "\\"status\\"[[:space:]]*:[[:space:]]*\\"running\\"" 2>/dev/null | sed -nE "s/.*\\"id\\"[[:space:]]*:[[:space:]]*\\"([A-Za-z0-9_-]+)\\".*/\\\\1/p" | awk "!s[\\$0]++" | tail -n 64 | tr "\\n" ",")',
  'o="CUIHUD1 agent=claude run=${rn%,}"',
  ...TTY_WRITE
].join('; ')

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
  'if($j -and $j.background_tasks){ $ids=@($j.background_tasks | Where-Object { $_.status -eq "running" } | ForEach-Object { [string]$_.id } | Where-Object { $_ } | Select-Object -Unique | Select-Object -First 64) }',
  '$o="CUIHUD1 agent=claude run=" + ($ids -join ",")',
  ...POWERSHELL_CONSOLE_WRITER.map((line) => line.replace(/\n/g, ' ')),
  'W $o'
].join('\n')

export const CLAUDE_HUD_STOP_HOOK_WINDOWS_COMMAND = `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePowerShellCommand(CLAUDE_HUD_STOP_HOOK_POWERSHELL)}`

export function buildClaudeHudSettingsJson(hostPlatform: NodeJS.Platform | null = null): string {
  return JSON.stringify({
    statusLine: {
      type: 'command',
      command: hostPlatform === 'win32' ? CLAUDE_HUD_WINDOWS_COMMAND : CLAUDE_HUD_STATUSLINE_SCRIPT
    },
    // Why a hook as well as the status line: the status line says what the
    // agent IS, the Stop hook says what it still has running. Both ride the
    // same --settings flag, so the host still gains no file and no config.
    hooks: {
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
 * The launch arguments for one agent: the host's own defaults kept in front,
 * ours appended. Null for an agent with no beacon channel, so the host
 * launches exactly as it always did.
 *
 * A null platform is treated as POSIX: an older host that does not report one
 * is a host the phone has only ever seen on macOS and Linux.
 */
export function buildAgentHudLaunchArgs(args: {
  agent: TuiAgent
  /** The host's own default args for this agent, kept in front of ours. */
  hostDefaultArgs: string
  /** From `status.get`; decides which Codex notify command the host can run. */
  hostPlatform: NodeJS.Platform | null
}): string | null {
  if (args.agent !== 'claude' && args.agent !== 'codex') {
    return null
  }
  const base = args.hostDefaultArgs.trim()
  const flag = agentHudLaunchFlag(args.agent, args.hostPlatform)
  return base ? `${base} ${flag}` : flag
}
