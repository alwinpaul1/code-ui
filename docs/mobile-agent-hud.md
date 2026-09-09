# The chat HUD, with nothing set up on the host

Verified against Orca 1.4.197, Claude Code 2.1.263 and codex-cli 0.153.4.

**The rule this is built to:** a Code UI user sets up nothing on their desktop.
No status line, no plugin, no config, no Orca change — and no code written to
their machine either. The phone does all of it.

## Update 2026-09-09 (later): the agents paint the HUD themselves

Both agents have a status-line feature that can be switched on **for one
process, from the command line, with nothing written to the host**. The phone
does that for every agent tab it launches (`agent-hud-launch-args.ts`,
`agent-hud-launch-config.ts`), keeping the host's own default args in front:

| Agent | Flag added at launch | What the agent then paints on its own footer |
|---|---|---|
| Claude Code 2.1.266 | `--settings '{"statusLine":{"type":"command","command":"<sh>"}}'` | `[Fable 5.1 medium] ctx 64% 649k/1.0M · 5h 37% · 7d 36%` |
| codex-cli 0.153.4 | `-c 'tui.status_line=["model-with-reasoning","context-remaining","five-hour-limit","weekly-limit"]'` | `gpt-5.6-terra xhigh · Context 100% left · monthly 94% left` |

Claude Code pipes its own state to the status-line command on every repaint
(model, effort, `context_window.used_percentage`, `context_window_size`,
`current_usage`, both rate-limit windows; captured in
`fixtures/claude-statusline-2.1.266.json`). The command is POSIX `sh` with
`sed` and `printf` only: no Node, no jq, no single quotes, so it survives
Orca's argument tokenizer. Codex needs no command at all. The phone's screen
parser reads both lines, so the HUD is repainted by the agent itself the
moment anything changes.

Limits, stated plainly: this covers **agents the phone launches**. A session
started from the desktop has no flags and falls back to the sources below.
The Claude status-line command is `sh`, so it is not added on a Windows host
(Codex's flag is, being a plain CLI option); Windows Claude sessions keep
model and mode from Orca and no context ring until a PowerShell variant is
written and tested on a real Windows machine.

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
