# The chat HUD, with nothing set up on the host

Verified against Orca 1.4.197, Claude Code 2.1.266 and codex-cli 0.153.4 on
macOS; the heartbeat (`refreshInterval`) and the session id against Claude
Code 2.1.276; the C0 channel against Claude Code 2.1.281 (2026-09-25). A Windows host gets no flag: the first real Windows run failed (see below).
Claude Code 2.1.283 (2026-09-26, the two binaries compared, not run): the
status-line payload, the `--settings` and `statusLine.refreshInterval`
handling, the hook list and the Stop and UserPromptSubmit payloads are built
with 2.1.282's code, so every field and key order the scripts read is unchanged.
The prompt hook's `at=` rule was checked against Claude Code 2.1.284's record
shapes (2026-09-29, built by hand from a real session's uuids and times, not
run live; see "Beacon field `at`" below).

**The rule this is built to:** a Code UI user sets up nothing on their desktop.
No status line, no plugin, no config, no Orca change — and no code written to
their machine either. The phone does all of it.

## Current design: the invisible beacon on the PTY

Verified live 2026-09-09 on macOS against Claude Code 2.1.266 and codex-cli
0.153.4. **Not yet confirmed end-to-end on a phone** — see "What is still
unproven" below.

The HUD reads the agents' own live state, and the state travels on four C0
control bytes that terminals do not draw, wherever a splice puts them. The
user's terminal is unchanged, their disk is untouched, and no terminal is
opened on the host. (Until 2026-09-25 it travelled on an OSC escape; "Why not
an OSC" below says why that could draw text.)

### The channel

Both agents accept a command-line flag that makes them run a small `sh`
command of ours. That command is where the whole design lives.

| | Claude Code | Codex |
|---|---|---|
| flag | `--settings '{"statusLine":{"type":"command","command":"…","refreshInterval":5}}'` (same on every platform; 15 on Windows) | POSIX: `-c 'notify=["sh","-c","eval \"$(printf %s <base64> \| base64 -d)\"","cuihud"]'`; Windows: `-c 'notify=["powershell","-NoProfile","-NonInteractive","-Command","…"]'` |
| when it runs | every repaint and every 5 s (15 s on Windows), with the agent's state on stdin | after each turn, with one JSON argument |
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

```
CUIHUD1 agent=claude hk=1 hb=5 sid=<session id> model=<id> name=<display name>
        effort=<level> used=<tokens> win=<window> pct=<int>
        h5=<int>:<epoch> d7=<int>:<epoch>
```

Space-separated `key=value`; values percent-encode `%`, space and `;`, and the
phone undoes exactly those three, once: a `%41` typed in a prompt arrives as
`%41` (before 2026-09-30 the phone decoded a prompt a second time, and it
arrived as `A`). A key whose figure the agent did not state is simply
absent — nothing is guessed at, and a beacon with tokens but no window leaves
the phone's context ring alone rather than inventing a denominator.

### The frame: the C0 channel

The payload travels as `ACK <body> ACK`. The body is `<crc> <payload>` in
UTF-8, where `<crc>` is the POSIX `cksum` of the payload bytes in decimal.
Every body byte is written as two hex nibbles, and each nibble as three base-3
digits: SOH = 0, STX = 1, ETX = 2. A 200-byte payload is about 1.3 KB of
control bytes.

The writer is plain `sh`: `cksum`, `od -An -v -tx1`, one `sed` that turns each
hex digit into three letters, and `tr` that maps the letters and the `w`
delimiters onto the four bytes. No control byte is ever held in a shell
variable (bash uses `\001` internally), and a `tr -d "\n"` drops any newline
a `sed` adds, which would move the cursor. With no `od` or no `cksum` the frame
comes out empty or fails its checksum, and the phone ignores it. The code is
`agent-hud-channel.ts` (the phone's decoder and a reference encoder) and
`AGENT_HUD_TTY_WRITE` in `agent-hud-tty-write.ts` (the writer). A test holds
the writer's bytes to the encoder's under `sh`, bash and dash.

Why these four bytes, checked against both parsers' source rather than from
memory:

- **xterm.js 6.1** (the desktop renderer, 6.1.0-beta.303, and Orca's headless
  model, 6.1.0-beta.302; `EscapeSequenceParser.ts`, `InputHandler.ts`): every
  C0 byte except CAN, SUB and ESC is EXECUTE in ground, ESC, ESC-intermediate
  and every CSI state, and the parser stays in the state it was in. It is
  IGNORE in OSC, SOS/PM and APC. Execute handlers exist only for BEL, BS, HT,
  LF, VT, FF, CR, SO and SI, so SOH, STX, ETX and ACK reach the no-op fallback.
  **One exception, which no byte avoids:** the CSI fast path leaves its loop at
  any C0 byte right after `ESC[` and resumes in CSI_PARAM instead of
  CSI_ENTRY, so a following `?` goes to CSI_IGNORE and the private-mode CSI is
  dropped. Nothing is drawn, but a dropped `ESC[?2026l` leaves synchronized
  output on, which holds the desktop renderer until the next frame's ESU or
  1 s. It happens only when the splice lands at exactly that byte, and only
  when xterm.js has two more bytes of the same write in hand. The OSC dropped
  the sequence there too, and drew the rest of it.
- **Ghostty** (libghostty-vt `b0947378`, the phone's engine; `parse_table.zig`,
  `stream.zig`, `Terminal.zig`): the same actions in ground, ESC, CSI and OSC;
  its SOS/PM/APC string keeps C0 as payload. `execute` ignores
  SOH and STX explicitly, and ETX and ACK in its default branch. It executes
  only 0x00-0x0F: its ground fast path **prints** 0x10-0x1F (except ESC) as
  one-cell glyphs, which rules out DLE through US.
- **The rest of C0 is out** for a stated reason: NUL, ENQ (Ghostty answers
  it), BEL, BS, HT, LF, VT, FF and CR (they act), SO and SI (charset shift),
  DC1 and DC3 (flow control), CAN and SUB (they abort a sequence), ESC (it
  starts one), and EOT (macOS drops it on output under `ONOEOT`).

The phone takes every one of the four bytes out of the stream wherever it
lands, feeds them to a per-terminal decoder, and passes every other byte on
untouched and in order. Every ACK opens the next frame, so a frame whose
opening ACK was lost fails its checksum, and the stream is back in step at the
next one. A frame is dropped for a digit count that is not whole bytes, a
nibble past 15, a missing or wrong checksum, an empty payload, or more than
16 KiB. A program that happens to print these bytes (readline leaks SOH and
STX around prompts) cannot inject a beacon, and stripping them changes nothing
on screen, because no terminal on the path acts on them.

### Why not an OSC

On 2026-09-25 (phone on 0.9.54, Claude Code 2.1.281 on the desktop) the
desktop Claude Code composer showed `❯ 2026h` mid-turn. Nobody typed it and it
was never submitted. The beacon is written to the agent's tty by a **second
process** (the status-line command, the hooks, Codex's notify) while the agent
paints the same tty. When Orca reads the pty slowly, the kernel splits the
agent's write and the beacon lands in the gap. Claude Code 2.1.281 writes each
frame as one string: `ESC[?2026h`, the patches, a cursor move to the input
caret, `ESC[?2026l`.

An OSC begins with ESC, and ESC aborts whatever sequence it lands in. `ESC[?`
+ beacon + `2026h` made xterm.js print `2026h` at the caret, and Claude's diff
renderer never repaints an unchanged input row. The reverse splice, a frame
landing inside the beacon, ended the OSC early and printed the rest of its
payload (`used=… win=…`) as text. On a private pty with Claude-shaped frames
and the host's exact `printf`, 1-4 % of beacons landed inside an escape at
5-20 ms of reader lag, `ESC[?` → `2026h` among them. The phone never showed
it: it rejoined the two halves when it took the OSC out.

With the channel, the same pty run lands channel bytes inside CSI and just
after ESC thousands of times, and xterm.js renders the capture identically
with and without them. `agent-hud-beacon-splice.test.ts` does the same at every
offset, in both directions, with the bytes the real status-line script writes.

**Still possible, and no byte choice fixes it**, for the channel, the OSC
and any other second writer. A splice that lands between the bytes of one
UTF-8 character: the host decodes the pty bytes before any terminal sees them,
so that character becomes U+FFFD on the desktop and on the phone. A splice
between a base character and its combining mark or variation selector
(`e`+U+0301, `❤`+U+FE0F): xterm.js's execute path resets its grapheme join, so
the mark takes a cell of its own and the rest of that row moves one cell. In a stress run (a beacon every
~25 ms, 20 ms of reader lag, 8 s) the host's decode showed 0-3 broken
characters with the OSC writer and 4-8 with the channel, whose frames are
larger. At the real cadence (one status-line beacon every 5 s) it has not been
observed. Inside a DCS passthrough both parsers hand C0 to the DCS handler as
data, and Ghostty keeps it as payload inside SOS/PM/APC; neither agent paints
those in its frames, and the phone strips the bytes before Ghostty sees them.

`sid` names the session the beacon speaks for: Claude Code's `session_id`
(the same field its hooks report, and the same id `--resume`/`-c` keep —
verified on 2.1.276), Codex's thread id (the notify argument's `thread-id`,
which is also what Orca's Codex hook reports as `session_id` and what `codex
resume` takes). Every emitter carries it: the status line, the Stop hook, the
prompt hook and the Codex notify, on sh and on PowerShell alike.

### A beacon is believed only for its own process

The store is keyed by terminal handle, and a handle outlives the process that
emitted into it. On 2026-09-18 the phone read "Fable 5.1 medium" for a
terminal whose process was a hand-started `claude -c` painting
`[Opus 5 (1M context) xhigh | Max 20x]`: the phone-launched agent that had run
there before had left its last beacon, the hand-started one emits none, and
nothing tied the record to a process. Three rules now decide what a reader may
take from a beacon (`hud-beacon-fields.ts`, `agent-hud-beacon-liveness.ts`,
`use-mobile-native-chat-hud.ts`):

- **Session.** A beacon is used only when its `sid` equals the session the tab
  is showing (`agentStatus.providerSession.id`). Another session, no `sid`
  (an older emitter, an older record), or a tab that does not yet know its
  session: the beacon is held but not used, and the HUD shows nothing rather
  than a figure from a process that may be gone. The warm-start storage key was
  bumped so every record written before `sid` existed is dropped.
- **Screen.** A badge on the user's own status line (or Codex's footer) that
  names a model owns the model+effort pair; the beacon supplies the context and
  the rest. A live beacon and the badge describe the same repaint and cannot
  disagree beyond the instant after `/model`; when they do, the beacon is
  describing something no longer on screen.
- **Silence.** The phone launches Claude with `statusLine.refreshInterval`
  (seconds; 2.1.276 binary: `min(1)`, "re-run the status line command every N
  seconds in addition to event-driven updates") — 5 s on POSIX, 15 s on
  Windows, where each run is a PowerShell process and is unmeasured — so the
  beacon is a heartbeat, and it declares its beat (`hb=`). Verified live on
  2.1.276: a beat every 2 s through a 25 s foreground tool call and through
  idle time at the prompt. But the status line is unmounted, and the timer
  with it, under every full-screen picker and dialog — `/model`, a permission
  prompt, an AskUserQuestion card: 0 beats in 25 s under each, same probe —
  and a dialog is where the phone user sits and reads for minutes. So silence
  counts only while Orca says the agent is `working`, the window starts
  afresh with each working stretch, and a beacon that declares a beat and
  falls silent through max(30 s, six beats) of work is from a process no
  longer running the command: its model, effort and context are dropped.

  A beacon that declares NO beat — Codex, whose notify runs only at a turn's
  end; a Claude from a build before the field — can only be caught at a turn
  end it did not report: 20 s after the pane goes idle with no beacon
  (allowing one that landed up to 10 s before the flip). That rule applies to
  every beacon. A dialog and an interrupted turn (Orca's `interrupted` on the
  `done`, not sticky, so a bare re-send of the same `done` is not a turn end
  either) are not turn ends; the next turn starting forgets the deadline.

  The phone hears a terminal only while its stream is subscribed, and it
  unsubscribes the tab it leaves. Every tab switch, foreground recovery, relay
  reconnect and WebView reload goes through `subscribeToTerminal`, which
  stamps the moment listening began (`noteAgentHudBeaconListening`); silence
  is measured from the latest of the last arrival, the working stretch and
  that stamp, and a fresh stamp forgets a pending turn end. So a warm-start
  record, a background stint, a tab switched back and a chat/terminal flip
  (which resubscribes the same tab as a lease-only stream and back) all get a
  full window. That is safe because a write-off is sticky until a beat newer
  than it: a turn end or a resubscribe does not show a dead record again on
  credit. The sticky hold (`use-sticky-live-hud.ts`) keeps only what the
  SCREEN said, so a dropped beacon cannot survive through it.

  Why not "30 s of the agent working" without a heartbeat (the first cut,
  93e3cc5): Claude Code re-runs its status line on an event — a new assistant
  message, `/compact`, a mode change — and NOT while a tool executes, so that
  rule blanked a live session's pill and ring 30 s into any long tool call or
  subagent run. The heartbeat costs ~10 ms of CPU per beat with no user status
  line (38 MB transcript, 2026-09-18), plus about 7 ms of wall time for the C0
  channel's writer (2026-09-25); a user's own bar runs on the same beat,
  which is their bar repainting, not a row of ours.

This matters because `claude -c`/`--resume` keep the session id: the session
rule alone cannot tell a hand-continued session from the phone-launched one it
continues. The screen rule and the silence rule are what separate them.

### The phone side

`agent-hud-beacon.ts` takes the channel's bytes out of every `Output` chunk
(`agent-hud-channel.ts`; a frame may span any number of chunks), publishes each
decoded beacon to a module store keyed by terminal handle, and returns the
chunk with only those bytes removed, so the engine never sees them either. It
still reads the old `ESC ] 7777 ; … BEL` frame, stitching one split across
chunks (holding at most 2 KB per handle), because a tab launched with the old
flags keeps writing it until its agent restarts. Another program's OSC (a
window title, an OSC 8 hyperlink) passes through untouched.

`hud-beacon-fields.ts` merges it into the HUD above the host's `agentStatus`
fields, and above the screen reading for the context: the beacon is what the
agent said about itself, on the turn it said it. A badge on screen that names
a model owns the model+effort pair (see below). The screen still owns the
permission and collaboration modes, which no beacon carries.

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

Both paths read `hostPlatform` from `status.get` first. A Windows host gets no
flag (below), and neither does a host whose platform could not be read: Orca
has reported it since its 2026-08-13 builds, so a missing one is a failed
`status.get`, and that host may be the same Windows machine.

- Tabs the phone opens: `agent-hud-launch-config.ts` puts the host's own
  `agentDefaultArgs`/`agentDefaultEnv` in front and appends ours, passed as the
  `launchConfig` of `session.tabs.createTerminal`. A flag of ours already in the
  saved args (the desktop sync's, or an older build's) is taken out first and
  the current one put last, so a profile the sync already flagged launches
  exactly as saved (no `launchConfig` at all) instead of with a second copy.
  Until 2026-09-30 the phone appended ours after the sync's, which started
  every phone-opened tab with two `--settings` (Claude) or two `-c notify=`
  (Codex). A user's own `--settings` or `-c notify=`, or args that do not split
  the way Orca splits them, still get no flag, with a `[hud-launch-args]` line.
- Tabs the user opens on the desktop: `agent-hud-desktop-launch-args.ts` writes
  one flag per agent into Orca's `agentDefaultArgs` over `settings.update`,
  once, on connect. Idempotent and signature-based
  (`agent-hud-launch-flag-owner.ts`): a flag is ours only when it carries our
  `CUIHUD` signature or is the exact text 0.2.77 wrote, so the user's own
  flags are kept, an upgrade replaces ours rather than stacking a second, no
  flag is added over the user's own `--settings` or `-c notify=`, and the same
  pass strips 0.2.77's visible `tui.status_line` flag wherever a host still
  carries it.
  The switch is Settings → Chat UI → "Desktop agents report model and context",
  default on; turning it off removes the flags again.
- **A key is never deleted.** Orca reads a missing `agentDefaultArgs` key as
  "launch with the defaults", which are the skip-permissions flags, and an
  empty one as "no flags", which is how its ask-permissions mode is saved. So
  the flag is appended to what Orca would launch with (its defaults, when
  nothing is saved), and taking it out leaves `''` rather than removing the
  key. Until 2026-09-25 the strip deleted an emptied key, which would have
  turned permission prompts off for every Windows user in ask mode.
- A tab the phone opens, and an AI-vault resume, on a Windows host start
  without any flag an earlier build saved there, so neither fails in the
  moment before the connect sync takes it out.

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

### Windows takes a different route (switched off)

(2026-09-27: with no beacon and no badge, the Claude model pills fall back to
the model the session's own transcript recorded on its last reply, read from the
host's session scan under a five-minute budget. See
`docs/mobile-model-from-transcript.md`, which also records the Orca change that
would make the scan unnecessary.)

**2026-09-25: a Windows host gets no beacon flag, from the phone or through
the desktop sync, and the sync takes back out one it already saved.** The
first report from a real Windows machine was Claude refusing to start at all:
"Error: Invalid JSON provided to --settings". Windows PowerShell 5.1 strips
the double quotes inside an argument it passes to a native program, so
`claude --settings '{"statusLine":…}'` reached Claude Code as JSON with no
quotes in it. Orca launches through PowerShell there, and the sync had saved
the flag in `agentDefaultArgs`, so every Claude launch on that host failed,
not only the phone's. `hostTakesAgentHudFlag` in `agent-hud-launch-args.ts`
is the switch. Everything below is kept, and its size ceiling still tested,
for the day a launch encoding survives 5.1 on a real machine.

Windows has no PTY device path to walk to, so both halves change — and Codex's
flag itself differs, which is why the phone reads `hostPlatform` from
`status.get` before building it. **None of this has been run on a real Windows
machine.** There is no PowerShell on the Mac it was written on
(`which pwsh powershell` finds neither), so the PowerShell script is asserted
by shape only. Treat the whole Windows path as unproven.

- **Every Windows writer keeps the OSC frame.** ConPTY rebuilds the output
  stream rather than passing bytes through, and whether it forwards SOH, STX,
  ETX and ACK is unknown; none of this has run. So the PowerShell scripts and
  the MSYS branch of the sh script still write `ESC ] 7777 ; … BEL`, and still
  carry the splice risk above. The phone reads both frames.
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
  when its settings were readable. The C0 channel was checked the same way on
  2026-09-25: Claude Code 2.1.281, launched with the new flags in a private
  tmux server (`env -i`, no `ORCA_*` variables, a fresh session, no prompt),
  had its pty bytes captured with `pipe-pane`. The phone's decoder read 13 of
  13 status-line beacons out of them, in 4096-byte and 7-byte chunks. The pane
  showed nothing extra (`capture-pane -e` holds no control byte but LF and
  ESC), and the screen matched a run without the flags except for one live
  usage figure, the user's own bar included. The Stop and prompt hooks and
  Codex's notify were not run live, since each needs a model turn; they share
  the one writer and run for real under sh, bash and dash in the tests. What
  remains unobserved is whether these bytes survive Orca's PTY streaming all
  the way to the phone. That needs a device.
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

### Beacon field `at` (the prompt hook's anchor)

`at=<uuid>` rides the prompt hook's beacon (`up=`, Claude Code only; Codex's
notify carries no prompt). It names the transcript row the prompt was typed
after, read by the hook from the last 1 MiB of `transcript_path` at submit
time. That is the last `"type":"user"` or `"type":"assistant"` record that
carries a string prompt or a `"type":"text"` or `"type":"image"` block, and no
`"type":"tool_use"`, `"type":"tool_result"` or `"type":"thinking"` block. Plain
`sh`, `tail`, `grep -E`/`-v`/`-o`, `head` and `sed`;
`agent-hud-prompt-anchor.test.ts` runs the hook itself against a temp
transcript, the main case under sh, bash and dash.

The tool and thinking exclusion dates from 2026-09-15, when anchors on those
rows were not found on the phone (the comment above the command in
`agent-hud-launch-args.ts` has the report). Orca 1.4.216's transcript decoder
(`rEn` and `KTn` in its app.asar, read 2026-09-29) does make rows of them,
keyed by the record's uuid: tool calls, tool results, and thinking as text.
The exclusion is kept anyway. A text row is held whichever reading is right,
while a tool-row anchor is found only if those rows reach the phone under that
uuid, which no device has shown since 2026-09-15, and changing it moves every
mid-turn desk message. It cost this: a message typed after a call, with no
text since, drew above that call (usually one), where the Claude app draws it
below. Since 2026-09-29 the hook also sends when it ran (`ts=`, below), and the
phone moves the message below the rows stamped a second or more before the
start of that second, so it pays it only for a call made within about two
seconds of the send, and a tab whose hook sends no time still pays it in full. A device check settles the exclusion
itself. The same decoder draws nothing for a
record whose only block is `redacted_thinking`, `server_tool_use` or
`web_search_tool_result`, which is why a row must also carry text, an image
or a string prompt.

The rule matches the block's `"type":` field, never the bare word. Claude Code
2.1.284 writes the message's `"stop_reason":"tool_use"` into every record of a
turn that goes on to call a tool, text records included. Until 2026-09-29 the
hook skipped any record with `"tool_use"` anywhere in it, so it skipped every
text row of a working turn: a message typed at 05:36, right after a text row,
was beaconed as typed after the prompt that opened the turn at 05:08. The test
fixture is built by hand in the shape 2.1.284 writes, with that session's uuids
and times; the hook was not run live against 2.1.284. Matching on the type
alone then named the records above that 2.1.284 had also stamped
`"stop_reason":"tool_use"`, which the bare word had skipped by accident; a
regression review of the fix found that, and the text-or-image requirement is
its answer. One gap is left as it was: that decoder draws an image block only
when it has a url or a path, so a record of nothing but a base64 image still
qualifies here and makes no row.

A changed hook reaches a tab only when its agent starts. The phone's own
launches carry the new flag at once. For desktop launches, the connect sync
rewrites the flag in Orca's `agentDefaultArgs` on the next connect, because it
matches the flag by shape and writes only when the text differs. An agent
already running keeps the hook it was launched with until it restarts: its
beacons still decode, and a mid-turn prompt's `at=` can still name the prompt
that opened the turn.

The PowerShell prompt hook (Windows, switched off) still takes the last
user/assistant record with no content filter at all, so it would name tool
rows. It is not fixed: the Windows Claude flag is 30,766 characters, and with
the 2,000 reserved for the host that is 32,766, one short of the 32,767 cap
(2026-09-29), so any fix there has to pay for itself; and that path has never
run on Windows.

### Beacon field `ts` (when the prompt was typed, 2026-09-29)

`ts=<epoch seconds>` rides the same beacon: `date +%s` when the hook ran, by
the desk's clock, the clock the transcript's rows are stamped by. On Claude
Code 2.1.284 `UserPromptSubmit` fires at the enqueue, 21 ms after the Enter, so
it is when the prompt was typed. A `date` that prints anything but digits
(one without `%s`) sends no `ts=`, and the phone takes nine to eleven digits
only. The phone keeps it as `typedAt` (epoch ms, the start of that second),
apart from a status copy's `at`: `at` also pairs a copy with the phone's own
sends, and this changes only where a hook copy is drawn
(`use-desktop-prompt-echoes.ts`).

Why it exists: "All 3 prompts stacked together with no responses in between
them" (the phone, 2026-09-29). When the chat does not hold the row `at=` names,
the copy had nothing else to go by and was drawn where the chat first saw it.
After a sleep the phone reads every beacon of the turn at once and its first
page is the turn's tail, so the rows the copies name are on the page above, and
every copy was first seen on the same last reply: they settled under it, in a
row. With a time:

- A copy whose named row is not held goes after the last row written at or
  before the start of its second. One typed before every row of a page, with
  earlier rows not loaded, is not drawn under that page: it is drawn where it
  was typed when the page above loads. A place found among the rows of a read
  that has not settled (the transcript the chat kept from before a sleep) is
  drawn for now and not kept, and the following below stays open while
  earlier rows are not loaded, or the copies of a turn stayed after the kept
  tail, in a row (review of 15fcfbea).
- A copy whose named row is held follows the rows stamped at least a second
  before the start of its second (`typedAt` minus 1 s, the slack a status
  copy's exact time gets) as those rows load, so it sits below the calls made
  between Claude's last words and the send, as the Claude app draws it, except
  one made within about the last two seconds.
- The chat's stored copy of a drawn message (the witness memory) gives way to
  its own hook copy when that copy has a time, as it gives way to a status
  copy, so a row that loads late still moves the message, and the stored copy's
  old place does not break the tool fold. It gives way the same way to its
  own hook copy while this run's chat is placing that copy (`placedHere`), so
  a row loading a reading later moves a waiting copy, time or no time; drawn
  by the stored copy instead, its waiting place was final. The copy is still
  stored from its first drawing: not storing a waiting one (fe1c055a) lost it
  after a relaunch and let a phone send of the same words take it (review of
  fe1c055a). After a relaunch nothing is placed in that run, and the stored
  copy draws it where it was.
- A stored `typedAt` the beacon could not have written (not whole seconds in
  the nine-to-eleven-digit range) is no time: the warm start restores fields
  unchecked.
- Three prompts typed during one long call have no row between their times,
  so they stay three in a row, after that call.

A copy with no time (a tab launched before this) whose named row is not held is
drawn where the chat first saw it while it waits. If the row does not come
within the wait it settles there, and the chat logs that once
(`[desk-prompt] drawn where first seen: …`), so a stack of those can be told
from a placement bug. Such a tab gets `ts=` when its agent restarts. The
PowerShell hook sends no `ts=` (see above: no room, and Windows gets no flag).
Tested against the day's real records (`mobile-chat-stacked-desk-prompts.test.ts`)
and by running the hook itself under sh, bash and dash
(`agent-hud-prompt-hook.test.ts`); not yet seen on a device.

### The prompt hook's copy as evidence (2026-09-29)

The tab status (`agentStatus.prompt`) carries the pane's last prompt, cut at
200 characters, and makes no new copy when the prompt's words do not change.
The prompt hook's copy (`up=`, with `at=`) carries the words as typed, up to
2,000 bytes, the text row they were typed after, and a nonce of its own for
each submission. Four cases the status alone cannot settle use it
(`desktop-prompt-merge.ts`, `desk-prompt-row-owners.ts`,
`desk-prompt-landed.ts`, `use-desktop-prompt-echoes.ts`; the cases are in
`mobile-chat-midturn-beacon-evidence.test.ts` and
`mobile-chat-desk-message-earlier-turn-words.test.ts`):

- A long message is drawn by its twin's whole words, so the queue box's whole
  reading of it and the echo are the same words (W1 of the review of
  fix/midturn-gaps).
- A user row belongs to a hook submission of its words when it comes straight
  after the row the submission names, as a prompt typed with the agent idle
  does, so the same words sent mid-turn and then typed as the next turn's
  prompt stay two messages (gap D). Not when a row between them is a joined
  dequeue that may be the earlier message's own: the earlier message's words as
  a run of whole lines of a longer row that no hook submission of its own words
  owns and no harness sent (`joinedLineBetween`). No row is split into its
  messages: a prompt can be made of earlier messages' words, and that lost
  messages.
- A user row at or before the row a hook copy names was written before the
  copy was typed, so it never lands the copy: a mid-turn "keep going" that
  repeats an earlier turn stays drawn, where before the earlier turn's row
  dropped its only copy (2026-09-30). A status copy with no hook twin names
  no row and is still landed by any row of its words.
- A message read first after Orca's stand-in goes after the row its hook copy
  names; with the hook and no copy of it, it came before the chat listened,
  and goes by its run's start (gap C).

Verified on Claude Code 2.1.284, in a private tmux server with no `ORCA_*`
variables and a hook that logged each event: a prompt typed while a turn ran
fired `UserPromptSubmit` at its enqueue (21 ms after the Enter) and none when
Claude dequeued it as its own turn after the first ended. So a second hook
copy of the same words is a second submission, never a dequeue. Without the
hook's copies (a Codex tab, a Windows host, a Claude tab launched without the
hook, a submission made while the phone did not listen to the terminal) each
case behaves as before, and the tests pin those limits.

## Windows (2026-09-10): what actually reaches the phone, and how

An earlier version of this section claimed the sh script's MSYS branch reached
the pseudoconsole. It cannot, and the reason shapes the whole Windows design:

- **Hook children have no console of their own to reach.** Claude Code spawns
  status-line and hook commands with `windowsHide`. Bun, like Node, maps that
  to `CREATE_NO_WINDOW` when every stdio is a pipe (libuv `src/win/process.c`),
  so the child gets a fresh hidden console — `/dev/tty`, `/dev/conout` and
  `[Console]::Out` all end there, not in the pseudoconsole Orca reads. Codex is
  the other way round: it spawns notify with stdin, stdout and stderr all
  `Stdio::null()` (`codex-rs/hooks/src/legacy_notify.rs`) and no creation
  flags, so the child shares Codex's console but its stdout goes nowhere.
- **Which shell runs the status line.** Claude Code 2.1.267:
  `shell ?? (gitBashFound ? "bash" : "powershell")`. With Git Bash it is sh;
  without, PowerShell (`pwsh`, else `System32\...\powershell.exe`). So a host
  with only PowerShell *does* run the status line — the sh script just fails
  in it.

Both facts point at one design: **a PowerShell status line for every Windows
host, writing through the Win32 console API.**

- `CLAUDE_HUD_STATUSLINE_POWERSHELL` reads the JSON from stdin
  (`ConvertFrom-Json`), builds the same payload as the sh script (a test
  asserts byte-for-byte equality), reads finished task ids from
  `transcript_path`, and delegates to the user's own status line from
  `settings.json` — under `sh` when Git Bash exists, else under PowerShell.
- It is handed to Claude Code as `powershell -NoProfile -NonInteractive
  -EncodedCommand <UTF-16LE base64>`. That text parses identically under sh
  and under PowerShell (no quotes in it), and `powershell` is Windows
  PowerShell 5.1, present on every Windows.
- `POWERSHELL_CONSOLE_WRITER`, shared with the Codex notify script, walks up
  the process tree to the agent (`claude`, `node`, `bun` or `codex`),
  `FreeConsole` + `AttachConsole` to it (Claude's case; Codex's child already
  shares the console), opens `CONOUT$` and `WriteConsoleW`s the OSC. The
  P/Invoke type is built with Reflection.Emit — ~2 ms — because `Add-Type`
  compiles C# on every run and this runs on every refresh.
- From the console on, the chain has sources: OpenConsole forwards unhandled
  OSC sequences since v1.22
  ([microsoft/terminal#17741](https://github.com/microsoft/terminal/pull/17741)),
  Orca ships node-pty 1.1.0 which bundles OpenConsole 1.23 and its desktop
  panes pass `useConptyDll: true`, and Orca's PTY reader is what the phone
  subscribes to.

Tested here, under PowerShell 7.6.6 (portable tarball on macOS, found via
`CUIHUD_PWSH` or `pwsh` on PATH; skipped with a warning where absent):

- Claude: identical beacon to the sh script from the same JSON; token total
  and percentage after a reply; finished task ids from a real transcript
  (idle and mid-turn kinds); the user's own bar kept; the encoded form run
  with JSON on stdin; and the dynamic P/Invoke type defining all five kernel32
  entry points. The console write is redirected to a file with
  `CUIHUD_WIN_CONOUT`.
- Codex: model, effort, used and win from a real rollout; the newest rollout
  when no thread is named; the user's own notify run with the JSON as its last
  argument. Executing it found four defects the shape checks had passed: the
  thread id was read from the script's own `-Command` text, the rollout glob
  used backslashes, `Start-Process` split the user's arguments, and the
  recursion guard was case-insensitive (`cuihud` argv0 matched `CUIHUD`).
- The sh script still has its own no-runtime delegation fallback (pure `sed`)
  for a Linux host without node, python3 or jq, and runs under sh, bash and
  dash in tests.

**Still not run, and cannot be from a Mac**: the kernel32 calls themselves
(`AttachConsole` to a pseudoconsole owner, `CreateFileW("CONOUT$")`,
`WriteConsoleW`), Windows PowerShell 5.1 (the scripts avoid `` `e ``, single
quotes and `$IsWindows` for it, and use the `AppDomain` assembly fallback), and
the end-to-end pass on a Windows console. A Windows host with Git Bash *or*
PowerShell now has a path; the first run on real Windows decides whether the
console attach lands where the reasoning says it does.

## Codex under Orca 1.4.217 and Codex 0.158.0 (2026-09-30)

Checked against Orca's v1.4.217 source and its recorded Codex captures
(`src/main/runtime/__fixtures__/codex-0-158-0-*.txt`, `codex-0-155-1-timed-turn.txt`), rendered through
tmux at 120x40. **Not run against a live Codex 0.158 tab.**

- **Isolation (#23900, #23907).** Orca's shell function for `codex` now puts `--no-daemon` in front of
  the arguments of every launch in an Orca terminal (unless `ORCA_CODEX_ISOLATE=0`, or the command is
  `agents`, `queue` or names `--remote`/`--no-daemon` itself; it probes `codex --help` first, so 0.155 and
  older are left alone). Codex 0.156+ otherwise shares one background app-server per `CODEX_HOME`, which
  ran every tab's hooks with the first tab's Orca environment. The captures record the launch as
  `codex --no-daemon -c check_for_update_on_startup=false …`. What the phone reads does not move:
  `providerSession` and the `rollout-*.jsonl` path still come from the hook payload and still sit under
  `<CODEX_HOME>/sessions/YYYY/MM/DD/`, and no phone code names an app-server. The one dependency worth
  knowing is the notify beacon: its script finds the PTY by walking at most six parents of the notify
  process with `ps -o tty=`. Under a shared server that chain ends in a daemon with no terminal, so a
  phone-launched tab would have written nowhere; in process, the parent is the tab's own Codex. That is
  reasoning from the script, not something observed. A user who sets `ORCA_CODEX_ISOLATE=0` gets the
  shared server back.
- **Readiness (#23475, #23765).** Codex 0.158 dropped `model:` and `directory:` from its startup box
  (it says `loading`, then nothing). Orca's `worker-start` waited on those rows; the phone never did.
  It gates a send on the link and the input lease, and reads Codex's screen only for the model picker
  and the queue editor (`isCodexIdle`, `isCodexWorking`): the composer placeholder, the input footer and
  the busy row. Those are unchanged in 0.158.0, with one exception the captures showed: the footer grew
  a "? for shortcuts" line under the composer, so the busy row (`• Working (0s • esc to interrupt)`)
  sits **seventh** from the bottom instead of sixth, and the phone's six-line tail read a running turn
  as idle. It now applies Orca's own rule (`hasBusyStatusRowAbove`, v1.4.217): only the last non-blank line above the composer counts, stepping over the queued-input preview and one `└` detail line, matched on `to interrupt)`; with no `›` composer on screen there is no verdict. A sentence or status row quoted higher up in an answer, or above 0.158's timestamp, is not a running turn (`codex-picker-screen.ts`, pinned by
  `codex-0158-screens.test.ts`).
- **Trust prompt.** A first launch in an unknown folder opens "Trust this folder?" (`› 1. Trust and
  continue`). The phone has no card for it; it is neither an approval nor an idle prompt to the readers,
  so nothing is typed into it.

