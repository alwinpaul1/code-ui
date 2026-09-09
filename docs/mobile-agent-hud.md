# The chat HUD, with nothing set up on the host

Verified against Orca 1.4.197, Claude Code 2.1.266 and codex-cli 0.153.4 on
macOS. The Windows path is written but unrun; see below.

**The rule this is built to:** a Code UI user sets up nothing on their desktop.
No status line, no plugin, no config, no Orca change — and no code written to
their machine either. The phone does all of it.

## Current design: the invisible beacon on the PTY

Verified live 2026-09-09 on macOS against Claude Code 2.1.266 and codex-cli
0.153.4. **Not yet confirmed end-to-end on a phone** — see "What is still
unproven" below.

The HUD reads the agents' own live state, and the state travels on an escape
sequence terminals draw nothing for. The user's terminal is unchanged, their
disk is untouched, and no terminal is opened on the host.

### The channel

Both agents accept a command-line flag that makes them run a small `sh`
command of ours. That command is where the whole design lives.

| | Claude Code | Codex |
|---|---|---|
| flag | `--settings '{"statusLine":{"type":"command","command":"…"}}'` (same on every platform) | POSIX: `-c 'notify=["sh","-c","eval \"$(printf %s <base64> \| base64 -d)\"","cuihud"]'`; Windows: `-c 'notify=["powershell","-NoProfile","-NonInteractive","-Command","…"]'` |
| when it runs | every repaint, with the agent's state on stdin | after each turn, with one JSON argument |
| what the agent draws for it | **nothing**, when the command prints nothing (verified) | nothing; Codex has no UI for notify |
| where the figures come from | the JSON on stdin | the rollout Codex writes for itself |

Claude Code's stdin JSON carries `model.id`, `model.display_name`,
`effort.level`, `context_window.context_window_size`,
`context_window.current_usage.{input_tokens,cache_creation_input_tokens,cache_read_input_tokens}`,
`context_window.used_percentage` (the last two are `null` before the first
reply), `rate_limits.five_hour.{used_percentage,resets_at}` and
`rate_limits.seven_day.…` (`resets_at` in epoch seconds), plus `cwd`,
`session_id` and `transcript_path`.

Codex's notify argument carries only `type`, `thread-id`, `turn-id`, `cwd`,
`client`, `input-messages` and `last-assistant-message` — no figures. Those
live in `${CODEX_HOME:-$HOME/.codex}/sessions/YYYY/MM/DD/rollout-*-<thread-id>.jsonl`:
`event_msg` records with `payload.type=="token_count"` carry
`payload.info.last_token_usage.total_tokens` (the CURRENT context, not the
running total) and `payload.info.model_context_window`; `turn_context` records
carry `payload.model` and `payload.effort` (also spelled `reasoning_effort`).
The script reads the last of each. Rollouts are read, never written.

### Why the payload cannot go on stdout

**Claude Code strips OSC escapes from a status-line command's stdout**
(verified), and printing anything visible would put a row in the user's
terminal, which is the thing this must not do. So the payload goes straight to
the PTY instead.

The child process has no controlling tty of its own (`/dev/tty` fails, `tty`
says "not a tty"), but it can find the agent's by walking up its parents:
`ps -o tty= -p <pid>` gives `ttys003` on macOS and `pts/3` on Linux, and a
write to `/dev/<that>` reaches the terminal stream. The walk is capped at six
hops. `CUIHUD_TTY` overrides the device, which is how the tests assert the
exact bytes.

### The payload

One `printf`, one write, well under 1 KB:

```
ESC ] 7777 ; CUIHUD1 agent=claude model=<id> name=<display name> effort=<level>
             used=<tokens> win=<window> pct=<int> h5=<int>:<epoch> d7=<int>:<epoch> BEL
```

Space-separated `key=value`; values percent-encode `%`, space and `;`. A key
whose figure the agent did not state is simply absent — nothing is guessed at,
and a beacon with tokens but no window leaves the phone's context ring alone
rather than inventing a denominator. OSC 7777 is private, so terminals draw
nothing for it.

### The phone side

`agent-hud-beacon.ts` scans every `Output` chunk for the sequence, stitches one
split across chunks (holding at most 2 KB per handle), publishes the parsed
beacon to a module store keyed by terminal handle, and returns the chunk with
our bytes removed — so xterm never sees it either. Another program's OSC (a
window title, an OSC 8 hyperlink) passes through untouched.

`hud-beacon-fields.ts` merges it into the HUD above the host's `agentStatus`
fields and above the screen reading: the beacon is what the agent said about
itself, on the turn it said it. The screen still owns the permission and
collaboration modes, which no beacon carries.

### Chat mode had to change

While native chat covers a terminal the phone used to subscribe with
`mobileInputLeaseOnly`, so the host sent `subscribed` and no bytes at all. The
beacon needs bytes, and chat is exactly when the phone needs the beacon, so a
covered subscribe is now an ordinary data-carrying one. It still carries **no
viewport**, so the host does not phone-fit a PTY that chat never renders, it is
still the input-floor lease, and the callback still returns early for a covered
handle after stripping the beacon — so nothing reaches xterm. `leaseOnlyRef`
still records "this stream is not rendering", which is what the rearm and
resume logic reads. The cost is deliberate: a covered tab now streams the
agent's output over the link.

### Where the flags come from

Both paths read `hostPlatform` from `status.get` first, because Codex's notify
command differs on Windows (Claude's `--settings` does not).

- Tabs the phone opens: `agent-hud-launch-config.ts` puts the host's own
  `agentDefaultArgs`/`agentDefaultEnv` in front and appends ours, passed as the
  `launchConfig` of `session.tabs.createTerminal`.
- Tabs the user opens on the desktop: `agent-hud-desktop-launch-args.ts` writes
  one flag per agent into Orca's `agentDefaultArgs` over `settings.update`,
  once, on connect. Idempotent, marker-based, and the same pass strips
  0.2.77's visible `tui.status_line` flags wherever a host still carries them.
  The switch is Settings → Chat UI → "Desktop agents report model and context",
  default on; turning it off removes the flags again.

### A user's own status line is kept

Claude Code's `--settings` overrides the user's `statusLine`, so the script
reads theirs and runs it: `$cwd/.claude/settings.local.json`,
`$cwd/.claude/settings.json`, then the same two under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}`, extracting `.statusLine.command` with
node, else python3, else jq (settings.json is multi-line JSON, so sed is not
reliable for it; Claude Code is itself a Node program, so `node` is there). Its
stdout is printed verbatim — a user with claude-hud keeps seeing exactly their
bar. Found nothing, print nothing, draw no row. Codex's own single-line
`notify = [...]` from `config.toml` is run too, best effort.

### Windows takes a different route (untested)

Windows has no PTY device path to walk to, so both halves change — and Codex's
flag itself differs, which is why the phone reads `hostPlatform` from
`status.get` before building it. **None of this has been run on a real Windows
machine.** There is no PowerShell on the Mac it was written on
(`which pwsh powershell` finds neither), so the PowerShell script is asserted
by shape only. Treat the whole Windows path as unproven.

- **Claude Code** runs status-line commands through Git Bash, so it is the same
  sh script with one branch: `uname -s` matching `MSYS*`/`MINGW*`/`CYGWIN*`
  skips the parent walk and writes to `/dev/tty`, which MSYS maps to the
  attached console — Claude's own under ConPTY, which is what Orca streams.
  `/dev/conout` is the second try; if neither opens, nothing is written and
  nothing is printed. Every `ps` in the POSIX walk is guarded (MSYS ships its
  own `ps` with no `-o tty=`), and `2>/dev/null` is applied **before** the
  append, so a failed open cannot put a shell error in the terminal either.
- **Codex** spawns notify directly, with no shell, and Git for Windows puts no
  `sh.exe` on PATH (only `git.exe`, under `Git\cmd`). So a `win32` host gets
  `notify=["powershell","-NoProfile","-NonInteractive","-Command","…"]`. Two
  Windows-only hazards shape that script: `powershell -Command <string> <args>`
  **appends** the extra args to the command text rather than binding them to
  `$args`, and a raw JSON token pasted on the end would be re-parsed by
  PowerShell (whose strings do not understand `\"`) and fail the whole command.
  So the script ends in `#`, which makes whatever is appended a comment, and
  the thread id comes from `[Environment]::GetCommandLineArgs()` — the real
  argv as Windows parsed it. With no thread id it falls back to the newest
  rollout. ESC and BEL are `[char]27`/`[char]7`, not `` `e ``, which Windows
  PowerShell 5.1 does not know; every string is double-quoted with `[char]34`
  for embedded quotes, because a single quote would end the token Orca hands
  the host shell. Every backslash is doubled going into TOML, which rejects
  `\*`, `\{`, `\s` and `\d` as escapes.

### Limits, and what is still unproven

- **The end-to-end path has NOT been confirmed on a phone.** The scripts are
  tested by executing them under `sh` and `bash` against real captured
  fixtures, and the sniffer is tested against the exact bytes they emit. The
  host half was also proven live on 2026-09-09: run under a `script(1)` pty
  with its own stdin and stdout redirected to files, Claude's script wrote
  `ESC ] 7777 ; CUIHUD1 agent=claude … BEL` to the pty and printed zero bytes
  to stdout, and the same run handed back this machine's real claude-hud bar
  when its settings were readable. What remains unobserved is whether OSC 7777
  survives Orca's PTY streaming all the way to the phone. That is the one thing
  left to verify, and it needs a device.
- The beacon is only as fresh as the agent's own cadence: Claude Code repaints
  its status line continuously, Codex fires notify once per turn.
- No single quote may ever appear in either script: the whole thing rides
  inside a JSON string inside a single-quoted shell token that Orca tokenizes
  with the Unix grammar once and re-quotes per shell
  (`tokenizeStartupCommand`). A test asserts their absence. Codex's value is
  base64-wrapped because TOML rejects the `\033` in it outright.

The sections below are the record of what was tried before this.

## Update 2026-09-09 (night): Claude Code's own context warning

Claude Code paints a context figure itself once the window runs low, with no
status line configured (strings in the 2.1.266 binary: "% until
auto-compact", "Context low (", "% remaining)", "% context used"). The phone
now reads those on a bare Claude footer (`REMAINING_PATTERNS` in
`mobile-terminal-hud-parse.ts`): the ring appears for a user without a status
line exactly when Claude Code starts warning, and stays absent before that
rather than showing a guessed figure. The model still comes from Orca's hook.
The threshold at which Claude Code starts painting the figure is its own and
was not measured here (no near-full session was available).

## Update 2026-09-09 (evening): status-line flags tried and withdrawn

Between 0.2.74 and 0.2.77 the phone switched on the agents' own status lines
at launch (Claude Code `--settings '{"statusLine":…}'`, Codex
`-c tui.status_line=[…]`), first on tabs the phone launched, then through
Orca's `agentDefaultArgs` launch profile for desktop launches. It worked and
was verified live, but it puts a line into the user's terminals, and a fresh
user must not see a status line they never asked for. Withdrawn in 0.2.78;
every connect strips the flags from a host that still carries them
(`agent-hud-desktop-launch-args.ts`).

What the binaries and Orca's contracts say, checked 2026-09-09:

- Claude Code's base hook payload fields: `hook_event_name`, `session_id`,
  `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`,
  `agent_id`, `agent_type`, `served_call`, `caller_session_id`, `effort`. No
  model, no usage. Codex's: `model`, `effort`/`reasoning_effort`,
  `transcript_path`, `session_id`, `cwd`, `turn_id`. No tokens.
- Orca's listener reads neither agent's `effort`, and its transcript reader
  keeps only the last assistant text. Its `agent.hook` method is the internal
  relay between remote hosts and Orca main, not a phone-facing channel.
- Claude Code strips OSC sequences from status-line output (so no invisible
  side channel) but passes SGR through; a concealed line still costs a row.

So, with nothing added to the terminal, the phone can show model (hooks),
mode and rate limits today; effort and context need Orca to forward what its
hooks and transcript reader already hold. That is an upstream change, see
`docs/orca-upstream-agent-status-usage.md`.

## Update 2026-09-09: the host-terminal reader is gone

The reader below opened a background terminal on the desktop to run a small
Node script that read the agents' own files. It worked, but every read gave
the desktop a tab, so "Terminal" pills flashed next to the agent tabs on the
phone every 30 s. The user asked for no host terminals at all, so the reader
was removed in 0.2.69. What the HUD reads now, with nothing opened on the host:

| Field | Source | Notes |
|---|---|---|
| model | `agentStatus.model` on the session tab (Orca's agent hooks), else the agent's screen | host-computed, live |
| effort | the agent's screen, else the option the phone itself set | Claude paints it only with a status line |
| context | the agent's screen | Codex paints it on its footer; **Claude Code paints it only when a status line is installed** |
| rate limits | `accounts.subscribe` | host-computed, same feed as the home screen |
| permission mode | the agent's screen | as before |

Checked and ruled out as sources (Orca 1.4.197 mobile RPC surface): the native
chat stream (`nativeChat.subscribe` messages carry id, role, blocks, timestamp,
source only), agent status (has `model`, no effort or tokens), the dashboard
snapshot, and structured `agentSession.*` (model and effort, no usage). The
transcript and rollout files are reachable from the phone only through a
terminal, which is the path that was removed.

So on a bare host the Claude HUD shows model and mode but no context ring;
Codex shows everything. The section below is kept as the record of the reader.

## What it used to read, and why that was wrong

The model, the effort and the context figure were parsed out of the agent's
rendered terminal screen. Three faults, and only the last is obvious:

1. **They are only on screen if a status line is installed.** Claude Code prints
   no model or context by itself. Whatever the phone showed came from whatever
   status line the user happened to have. With none, it showed nothing.
2. **It is text laid out for a screen** — wrapped at the pane width, shortened
   with an ellipsis, at whatever precision that status line chose.
3. **It changes between agent releases.**

Account usage (5-hour and weekly, on the home screen) was never scraped: that is
`accounts.subscribe`, computed on the host. Only the in-chat figures were text.

## What it reads now

Both agents write these facts themselves, as JSON, unprompted:

| Field | Claude Code 2.1.263 | codex-cli 0.153.4 |
|---|---|---|
| model | `message.model` per `assistant` record | `turn_context.payload.model` |
| effort | top-level `effort` per record | `turn_context.payload.effort` |
| context used | `input + cache_read + cache_creation` of the newest non-sidechain record | `token_count.info.last_token_usage.total_tokens` |
| context window | **never recorded** — inferred, see below | `token_count.info.model_context_window` |
| mode | `permission-mode` records | `turn_context.payload.approval_policy` |
| rate limits | not on disk | `token_count.rate_limits` |

The sidechain filter matters: a subagent runs against its own context, so its
record would report the sidechain's occupancy as the main thread's.

A `compact_boundary` newer than the newest assistant record wins, and its
`postTokens` is what is in context. Without that the ring sits red at 93% until
the agent next replies, when the truth is 2%.

## The context window, with nothing installed

Claude Code never records the window size, and the model id does not carry it —
a live 1M session logs an unmarked `claude-opus-5`. The size is taken, in order:

1. an explicit `[1m]` in the model id;
2. a status line's own cache, keyed by `sha256(transcriptPath)`, when one
   happens to exist (exact);
3. **otherwise the smallest size Claude Code ships that the session's own
   numbers fit** — a session cannot have held more tokens than its window, and
   Claude Code compacts near the limit, so a `compact_boundary`'s `preTokens` is
   the closest evidence there is.

Rule 3 is a proven lower bound, not a guess. It can under-report a 1M window
early in a session and corrects upward as it grows, and it is never above 100%.
Verified on a live 683k session: the cache and rule 3 both give 1,000,000.

Codex needs none of this — it reports its own window.

## How the phone reads a host file with nothing installed

Every step is on Orca 1.4.197's mobile allowlist:

1. `terminal.create` with a `command`. For a mobile client Orca forces
   `focus:false`, `activate:false`, `presentation:'background'`.
2. The command is `printf %s <base64> | base64 -d | node - <args>; exit`. The
   reader goes into **node's stdin and is never written to disk**; base64 keeps
   the payload to `A-Za-z0-9+/=` so no quoting in it can escape the shell. The
   only thing that lands on the host is the small JSON result, and each run
   sweeps the ones left by earlier runs.
3. `terminal.wait { for: 'exit' }`. `terminal.create` returns when the terminal
   exists, not when its command has run — the reader takes ~130 ms, and
   resolving early either found nothing or pinned the read grant to a file the
   reader then rewrote, which the host rejects as stale. The client deadline is
   the server's + 5 s, or the transport rejects before the host's answer lands.
4. `files.resolveTerminalPath` for the `/tmp` path. The grant guard allows
   `os.tmpdir()`, `/tmp` and `/private/tmp` — the same grant used for pasted
   images. It also requires the path to have appeared in that terminal's own
   output, so the reader prints it on a line of its own rather than relying on
   the echoed command line, which a wrap can split.
5. `files.readTerminalArtifact`, then `terminal.close`.

The reader writes to `<out>.part` and renames, so the path is absent or
complete, never half-written.

### Why nothing lighter works

- **`nativeChat.subscribe` carries none of it.** Its message builders emit
  exactly `{id, role, blocks, timestamp, source}`, and Codex's `token_count`
  record — the one holding the window, the usage and the limits — matches none
  of the four event types its parser handles and is dropped.
- **The file cannot be read directly.** `files.readTerminalArtifact` refuses
  anything over 512 KiB and truncates from byte 0; transcripts here are 2 MB.
- **`crossWorkspace: true`** means "any workspace Orca already knows about"; it
  does not reach `~/.claude` or `~/.codex`.

### Limits, stated plainly

- POSIX hosts only. The phone reads the platform from `status.get` and does not
  run the snapshot on Windows, where the screen path stays.
- It needs `node` on the host's PATH. If it is missing, nothing is written and
  the HUD keeps the screen reading.
- One shell round trip, so it runs every 30 s rather than the screen's 1 Hz, and
  on demand when the caller refreshes. The screen read stays underneath for
  permission dialogs and the queue, which are not in the transcript until they
  have been answered.
- `snapshot.limits` and `planType` are parsed but not yet rendered anywhere.

## Tested

`agent-hud-reader-execution.test.ts` runs the shipped constant under `node` —
asserting on its source text would pass even if the logic sat in a dead branch.
Nine cases across both agents: real record shapes, the sidechain filter, a turn
larger than the first tail window (21% of the transcripts on this machine have
one), the window with nothing installed, a compaction, Codex's full reading, its
cwd discriminator, and its refusal to guess when a session id is unknown.

### Beacon field `done` (added 2026-09-09, late)

`done=id1,id2,…` — background-task ids whose completion Claude has written to
its transcript, read by the status-line script from `transcript_path`. Only
Claude emits it. Consumed by `mobile-background-tasks.ts`, not by the HUD.
