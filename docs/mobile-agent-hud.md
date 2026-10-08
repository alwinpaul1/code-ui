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
- **Ghostty** (libghostty-vt `b0947378`, checked while it was the phone's engine;
  the phone now draws its panes with xterm.js only, and this stays as the
  second parser the bytes were verified against; `parse_table.zig`,
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
those in its frames, and the phone strips the bytes before its terminal sees them.

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

### Beacon field `sc` (a loop's tick, 2026-10-01)

A recurring loop (`CronCreate`) fires its prompt through `UserPromptSubmit`
like a typed one: Claude Code 2.1.286 builds that payload as the common fields
plus `prompt` and `session_title`, nothing that says it was scheduled. Orca's
decoder draws nothing for the tick's own row (an `isMeta` user row,
`turnOrigin: "scheduled"`), so the status copy and the hook copy drew every
tick as a user bubble, cut at 200, every three minutes; the Claude app draws
none (reported 2026-10-01).

Just before Claude Code enqueues the tick it writes a `system` row,
`"subtype":"scheduled_task_fire"`, whose `prompt` is the tick's words
FOLDED and cut at 200, with no mark (session 76ba8f2f, rows 36098 and 36099).
The fold is read from the 2.1.286 and 2.1.288 binaries (`V3`/`H4`): each run of
whitespace (line break, tab, double space) becomes one space, the ends are
trimmed, control and format characters are dropped. The one real record had a
first line over 200 characters, so a line break inside the row was never seen;
until 2026-10-03 the hook compared its unfolded copy, and a prompt with a line
break in its first 200 characters (a heredoc loop) was never marked and drew as
a bubble. The prompt hook folds its own copy the same way (`pn`, whitespace
escapes to a space, runs squeezed, ends trimmed) and looks at the transcript's
last eight lines (a known limit: a mid-turn tick with more rows written before
the hook runs goes unmarked) for such a row whose `prompt`, escaped as the
hook's own copy is, is this very prompt, or, when it
is 200 characters long (escapes decoded, a multibyte character counted once),
starts it, and sends `sc=1` when it finds one. A shorter row holds the whole
prompt, so only the same words are its tick: a prefix rule there marked a typed
"status report…" as a tick of a loop whose prompt was "status". The comparison is a quoted `case`, so a `*`
or `[` in the words is a character. The phone drops a marked copy, and the
status copy that stands for it takes the mark in the merge
(`scheduled-prompt-ticks.ts`, `desktop-prompt-merge.ts`).

Verified against 2.1.286's row order in a real transcript, not a live run:
if the row is written after the hook reads, there is no mark, never a wrong
one, and the chat falls back to matching the words against the loop's
`CronCreate` or `ScheduleWakeup` call in the loaded transcript. A tab launched
before this flag, or one launched without the hook, has only that fallback.
No mark proves a copy was typed: a tick that fires mid-turn can have a tool row
written between its `system` row and the hook, and the words alone cannot tell
a typed copy of a loop's prompt from a tick, so such a copy is drawn only when
its own transcript row lands.

**Sentinel loops (`/loop` with no prompt, loop.md).** The task's stored prompt
is `<<autonomous-loop>>`, `<<autonomous-loop-dynamic>>`, `<<loop.md>>` or
`<<loop.md-dynamic>>`, and the `CronCreate` call holds it. The fire row does
NOT: `mon` writes `U(task)`, which swaps a sentinel for the literal `/loop`, or
`/loop (loop.md)` for the loop.md pair (2.1.286 @48710795). (An earlier
revision of this section, and commit e137463b's message, said the fire row
holds the sentinel; that was wrong.) The turn, and so the hook's prompt, holds
what `resolveLoopDefaultFire` makes of the sentinel at fire time:
`# Autonomous loop tick…` (also `(dynamic pacing)`), the first delivery's
`# Autonomous loop check`, and `# /loop tick — …` (`loop.md tasks`, `tasks from
<path>`, `loop.md absent (dynamic pacing)`), all read from the 2.1.286 binary,
none from a captured transcript. Two rules cover it:

- The hook sends `sc=1` when BOTH hold over the same eight-line tail as the
  words rule: the last fire row's `prompt` is exactly `/loop` or
  `/loop (loop.md)`, and the prompt starts `# Autonomous loop ` or
  `# /loop tick ` (the em dash is left out of the pattern). Either alone would
  mark typed prompts: any prompt typed within eight lines after a sentinel tick,
  or any prompt that merely opens like one. A typed `/loop …` command is never
  marked (a bare `/loop` is not matched by the words rule either: that rule
  skips the two literals). That carve-out costs one mark the words rule used to
  give: a loop whose stored prompt is literally `/loop` or `/loop (loop.md)`,
  not a sentinel, fires with that literal as its words and goes unmarked. Only a
  model that ignored ScheduleWakeup's "pass the sentinel" instruction stores
  one, and the phone's loaded or remembered words match still drops its tick
  (review of 8750e6bb). A tick that fires mid-turn with its fire row further
  back goes unmarked and falls to the phone's rule. The PowerShell writer never
  had `sc=1` and gets no beacon flag, so it is not mirrored.
- The phone (`scheduled-loop-sentinels.ts`): when a loaded or remembered call's
  prompt is one of the four sentinels, a desk copy whose folded words start with
  `# Autonomous loop tick`, `# Autonomous loop check` or `# /loop tick — ` is a
  tick (one list for all four: `<<loop.md>>` with no file resolves to the
  autonomous words). Words a person types that open exactly so, while a sentinel
  loop is known, lose their bubble until their own row lands.

Not seen in a payload: that the hook receives the RESOLVED words is inferred
from ticks drawing past a loaded call, not read from a hook payload.

**A status copy ahead of its hook twin.** On a tab with the prompt hook a tick
that fires mid-turn reaches the phone twice: Orca's status copy, then the
hook's beacon copy, which alone carries `sc=1`. Until the mark arrived the
status copy drew as a user bubble and vanished a moment later, a flash of the
loop's words every tick. `useDesktopPromptEchoes` now holds back a status copy
(nonce `status:`) the chat watched arrive (not found on a first reading, not
read after Orca's stand-in) while the tab has the hook and no twin has paired
with it, for `STAND_IN_TWIN_WAIT_MS` (5 s, the wait a copy found after the
stand-in already has), and arms a timer for the deadline, since readings happen
only on a re-render. A twin that never comes (a frame spliced on the pty or cut
in the relay) leaves the copy drawn after the wait. A beacon copy carries its
own mark and never waits; a tab without the hook has no twin to wait for.
The cost: a message typed mid-turn on a hook tab draws up to 5 s late when its
twin is late. The wait holds any status copy the chat watched arrive on a hook
tab, so a tick on an idle pane waits for its marked twin the same way.

**Not covered: a tick on a tab with no hook whose loop call was never loaded.**
Telling it from a typed prompt by the transcript's rows (a typed prompt gets a
user row of its words, a tick an `isMeta` row Orca draws nothing for) was built
and reverted (1ffc72c5, reverted after review). It rested on the status copy of
a tick being a prompt that began a working run, and it is not: while a loop is
registered Orca keeps the pane `working` (2.1.286's Stop payload carries
`session_crons`), so a live loop's tick never has a fresh `stateStartedAt`, and
the status has no idle-submit signal to key on. It also held a typed prompt
forever when the chat's read never settled, and Claude stamps the user row
before `UserPromptSubmit` runs, so its row slack could judge a typed prompt a
tick. Such a tick draws, until the loop's call is loaded or the hook marks it.

**Why the hook never says a copy was NOT a tick (`sc=0`).** A hook that sent
`sc=0` when it read the transcript and saw no fire row of this prompt was
proposed and not built, because a wrong `sc=0` fails to a drawn bubble where a
missing `sc=1` fails to the word match. Evidence (offsets into `strings -n 20`
of the 2.1.286 binary): a write queue whose methods (`enqueueWrite`,
`scheduleDrain`, `appendToFile`; @21965780, @21966388) match the transcript's
store drains on `FLUSH_INTERVAL_MS=100` (@21964619); a tick's fire row and its
user row are stamped 21 ms apart; and the hook runs several processes before it
reads the tail. IF the fire row goes through that queue (not traced), it may
not be on disk when the hook reads. Revisit only with a measured delay on a
live tick.

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


## Model and effort without a beacon (2026-10-05)

Reported on 0.9.115 / Claude Code 2.1.289: one tab drew "Opus 5.5" with no
effort, another drew no model at all ("Model" in the composer). Neither is a
regression from the xterm.js switch (beacon stripping sits above the WebView and
its files changed only in comments between 0.9.114 and 0.9.115) and neither is a
2.1.289 change (the status-line payload builder is the same as 2.1.288's,
compared by minified-name-blind diff). The cause is which sources a tab with no
beacon and no badge has left. The user had also just removed the
`claude-hud-enhanced` plugin, whose `[Model effort | Auth]` badge had been the
live pair for every tab that carried no beacon.

### The order, and why it extends the rule

1. The live beacon, or the badge on the user's own status line. Authoritative
   whenever present, including when it states a model with no effort: Claude
   omits `effort` from its status-line payload for a model that takes none, and
   after an API 400 on `output_config.effort` latches "effort unsupported" for
   the session (`sw()` / `$Pn` in the 2.1.289 binary). The hook frames below are
   beacon-tier too; the newest frame wins.
2. What the session's own screen said since: the effort its working spinner
   states and the model an alt+p toast names (below, "The spinner's effort and
   the alt+p toast"), laid over tiers 3 to 5 by when each was said
   (`claude-screen-model-pair.ts`).
3. The session's own last answer to `/model`, `/effort` or `/fast`, or the
   harness's fallback notice, read from rows the transcript already holds
   (`claude-session-command-pair.ts`).
4. The session's own startup frame, below (`claude-startup-frame.ts`). It sits
   under tier 3 and under the scan whenever the scan names another model.
5. The model the host's transcript scan last read for this session
   (`claude-transcript-model.ts`), which carries no effort.
6. Nothing.

Tiers 4 and 5 are ordered by what each statement is about, not by rank: the frame
was printed at launch, so a reply written later under a different model (an alt+p
picker switch writes no row) is the newer statement and the scan wins, effort
dropped. When the scan names the same model it records no effort, so the frame
supplies the one it stated.

`CLAUDE.md` says "no figure from anywhere but the beacon or the screen". Tier 2
is the screen. Tiers 3 and 4 are a deliberate, narrow extension of it: a line
the agent printed about itself, in answer to the user's command, in the
session's own record. It is not a tracked record, not the launch record, not a
setting, and not a guess. The
rule's reason (a figure the agent did not state about THIS session) still holds,
and the extension stays inside it.

### The startup frame (2026-10-06)

A `claude` typed by hand into a shell has no launch flag, so no beacon and no
badge, and before this tier it showed nothing past `/model` and `/effort` output
(Claude Code 2.1.290: no status-line, hook, window-title or OSC channel was added
that names the model or effort; the title is `sessionTitle ?? aiSessionTitle ??
agentTitle ?? haikuTitle ?? "Claude Code"`, identical in 2.1.289).

**What Orca does, exactly.** Orca's desktop renderer reads the same frame to fill
its own model and effort pills (`claude-terminal-session-options.ts`,
stablyai/orca @ 13d94acd, since #12860, 2026-08-06). Its read is loose: the FIRST
row containing `Claude Code vX` anywhere in the buffer; the lowest row with a `·`
or a `with <level> effort` in the frame's bottom-up window (two rows below the
header when the frame has no bottom edge); and an effort whose word was elided to
`…` is accepted. It does not send the result to mobile: Orca mobile shows the
model only from `agentStatus.model`, which its Claude hook normalizer never sets,
and no effort for a terminal Claude tab at all. That looseness suits a pane Orca
spawned and watched from the start, and not a phone attaching to any tab, so this
reader differs on purpose (`claude-startup-frame.ts`).

**What it reads.** 2.1.290's header component lays out a row of [mascot, text
column] with `gap: 2`; the mascot's glyphs span columns 0 to 8 (the binary's
`Ke`, `Ue` and `Ge` glyph tables), so on each of the three rows the first eleven
columns hold only mascot art and spaces, and the text starts at column 11:
`Claude Code vX`, then `<Model> with <level> effort · <plan>`, then
`[@<agent> · ]<cwd>` (` · <status>` follows the cwd in fullscreen). Only the model
row is read, so an agent name or a fullscreen status on the third row changes
nothing.
- A header that is not of that shape is not a frame: indented or quoted (the
  text must begin EXACTLY at column 11, with no trimming, and the model row must
  have art in column 0 or 1), a `tmux capture-pane` of a nested claude in a tool
  result, a joined one-liner. A copy indented by one or two columns fails the
  column test even when its `⏺` has scrolled off.
- Phone-width panes: `nEr` splits the model and the billing onto separate rows
  below about 52 columns, so the text column is four rows against the three-row
  mascot, which `alignItems: "center"` offsets by 0.5. How Yoga rounds that was
  not provable from the minified bundle, so both are read: the mascot on the
  header, model and next row (offset 0), or a blank header prefix with the mascot
  on the three rows below it (offset 1). The column-11 and art rules hold in both.
- A header with a `⏺` or `⎿` row reachable upward before a `❯` prompt or the top
  of the screen sits in a reply or tool block and is not read: a column-0 `cat`
  of a banner would otherwise pass the shape test.
- Only the NEWEST frame is read, and a newest frame that cannot be read gives
  nothing rather than the one before it.
- The model is mapped by family tokens (`claudeIdFromLabel`), so the
  `(1M context)` note, which 2.1.290 still appends to a 1M id's name
  (`supports_1m_suffix`), changes nothing. A family or version it cannot map is
  refused whole.
- A pane too narrow for the word "effort" (`with high…`) keeps the model and
  drops the effort (Orca keeps the level; this repo refuses rather than guesses).
- Not handled, so refused: a screen reader's mascot-less header, Apple
  Terminal's smaller fallback mascot (its text column is not verified), and a
  fullscreen animation frame whose mascot is not the same nine columns.

**Where it comes from.** One source, and one only: the screen poll that already
runs while chat covers a terminal (`terminal.read --screen`,
`use-mobile-terminal-hud-observation.ts`, `startupFrame`). It is the host's
VISIBLE rows (`buildVisibleSnapshotReadFallback`, Orca `terminal-tail-read.ts`),
so the frame is on it only until the conversation outgrows one screen.
- The pair is kept per session id and persisted with the other session caches
  (`claude-startup-frame-pair.ts`, `codeui:chat-startup-frame-pairs`, 32
  sessions), so a frame that scrolled off, a reconnect or a relaunch keep it.
- A frame is filed under the session the tab had WHEN IT APPEARED, and under no
  other (`fileStartupFrame`, `claude-startup-frame-pair.ts`). The record of what
  was filed is per terminal scope and module-level, because a remount, an
  `enabled` toggle or a reconnect resets the screen read and re-reads the frame
  still on screen, which is the OLD session's. The same frame (same model, efforts
  that agree or one cut by a narrow pane) under a different session id is refused
  every time; a different frame is a new process's and is filed. A frame first
  seen while no session is known waits for the id that arrives while it is still
  on screen, and is dropped when a screen read no longer finds it (the
  observation reports `null` then). A session that changes with no new frame
  (`/clear`, `/resume`, a second `claude` that has not painted yet) inherits
  nothing. The cost: a second `claude` with the SAME model and effort paints an
  equal frame and gets no figure from this tier; late is acceptable, wrong is
  not. The filing record is memory only, so after a relaunch a first sight files
  normally. A narrow read of the same model never erases an effort a wide read
  stated.
- **Deleted: the oldest-stream read.** An earlier version of this branch also
  read `terminal.read {cursor: 0}` once per terminal. Orca's tail buffer is per
  PTY from spawn, so cursor 0 answers the first frame that PTY EVER painted: a
  second `claude` in the same terminal, `/clear`, `/resume` and `claude -c` all
  got the first run's pair filed under the new session id, and a correct pair
  could be overwritten and persisted. Nothing binds that buffer to a session, so
  the read is gone and `use-claude-transcript-model.ts` reads the host for
  nothing here. The cost is that a tab first attached after its frame scrolled
  off shows no figure from this tier.
- The phone's own xterm buffer is not a source either: it holds the host's
  snapshot at attach, which has not been measured, and chat pauses the stream.

**What it is not.** It is the session's statement AT LAUNCH. A later `/model`,
`/effort` or `/fast` row overrides it (tier 3), so do a later thinking
spinner's effort and an alt+p toast (tier 2), and a live beacon or badge
overrides everything. The effort-step keys write nothing the phone can read, so
until the next status line, command or thinking turn the effort here can be
stale; it is never drawn as anything fresher. It does not fill a
missing field of a beacon (a beacon that states a model and no effort yet keeps
no effort): mixing a launch statement into a live pair is the "Opus Medium" bug.

**Proven and modelled.** Proven from the binary: the header component's layout
(`gap: 2`, the mascot's glyph spans, the three text rows), and that the effort
suffix (` with ${level} effort`) is the same builder in 2.1.289 and 2.1.290.
Proven from Orca's source: what Orca reads and what it sends to mobile. MODELLED,
not captured: every frame in the tests
(`fixtures/claude-startup-frame-2.1.290-modelled.ts`). No live 2.1.290 frame has
been captured; the text column (11) is derived from the glyph spans and the gap,
and the mascot's width constant was not readable in the minified bundle. Not
proven: ConPTY redraws, the fullscreen layout, and the exact row wording on a
real screen. Codex has no counterpart (its startup box is a different frame and
its model comes from the footer and rollout), so nothing here reads it.

### The spinner's effort and the alt+p toast (2026-10-08)

The requirement: the pills follow every switch for ANY user with nothing set up
on the desktop (no beacon, no status line, no plugin), in the default and the
fullscreen TUI. Two rows Claude Code itself draws make that possible, both
CAPTURED from a live Claude Code 2.1.294 (`tmux capture-pane -p`, detached pane,
`--settings '{"tui":"default"}'` and once `"fullscreen"`, at 160 and at 44
columns; `fixtures/claude-spinner-effort-2.1.294.ts`,
`claude-model-toast-2.1.294.ts`). Readers:
`claude-screen-model-statement.ts`; store and order: `claude-screen-model-pair.ts`.

**The spinner states the effort on every thinking turn.**
`✻ Gallivanting… (2s · thinking with xhigh effort)`,
`· Inferring… (2s · ↓ 113 tokens · thinking with xhigh effort)`, and with a hook
running `✻ Burrowing… (Syncing CodeGraph index… 0/3 · 3s · ↓ 163 tokens ·
thinking with xhigh effort)`. Between thinking phases it says `thought for 2s`,
and Sonnet 5.5 says only `thinking`: neither states an effort, and a spinner
with no effort changes nothing. The levels read are `low|medium|high|xhigh|max`.
- Read only where Claude draws it: the first column-0 row above the input box's
  top rule. The rows Claude puts between them (a tip's `⎿` rows, a status
  line) are indented, and so is every reply and tool row (`⏺` opens a reply,
  its rows continue at two columns), so a spinner quoted in a reply is never
  that row (captured: a reply repeating two spinner rows).
- The row must be whole: glyph, verb, `…`, a parenthesis CLOSED on the same
  row, the effort as its last part. At 44 columns Claude drops the elapsed time
  (`✢ Mustering… (thinking with high effort)` is read) but a longer one wraps:
  `· Mustering… (running Stop hooks… 2/3 ·` over `thinking with high effort)`
  at column 0. That gives no effort rather than a joined guess.
- It is the effort for the model the session is running, so it is kept with
  the model the pills showed when it was read and dropped when they show
  another.

**The alt+p picker writes nothing to the transcript; it shows a toast for
about two seconds.** `Model set to sonnet (claude-sonnet-5-5) for this session
only` (or `… and saved as your default for new sessions`, the user's own row;
not captured, because Enter in the picker saves the global default). The model
becomes the id in the parenthesis, and the effort is cleared: the toast names
none, and the effort before it was the old model's (the same reset as a `/model`
row, `claude-session-command-pair.ts`). Moving the picker's effort slider and
pressing `s` shows the same toast with no effort, so after it the effort is
unknown until the next thinking turn states it.
- The toast is drawn flush with the box's right edge, two columns in (the
  footer's `paddingX: 2`; 158 of 160 columns, 42 of 44): at the right of the
  first footer row at desktop width, on a footer row of its own at 44 columns,
  cut with `…` after the id, and in FULLSCREEN on the row directly above the
  box's top rule. Only those rows, only flush, so a reply's copy (indented two
  columns from the left) is not read. A row holding a double-width character is
  not flush by this count and is refused.
- A toast is a switch on its first sighting only; it stays up for several polls.
  If the spinner of a turn begun before it is still up, that spinner is the old
  model's: no effort is taken until a screen with no spinner has been seen.

**Order.** Tier 2 above. Each statement is kept per session id and persisted
(`codeui:chat-screen-model-statements`, 32 sessions, fail-open both ways), and
lies over the lower tiers by when it was said:
- against a command row, by the command pair the phone HELD when the statement
  was seen: a command it did not hold then is newer and wins. Keys are compared,
  never the host's row time against the phone's clock;
- against the startup frame, by the phone's clock: a frame read later is a new
  process's and wins;
- against the scan, the superseded rule of a `/model` row: a toast stands until
  a reply newer than the last one the phone held at the toast is in the rows,
  the scan was taken after it, and it names another model.
A live beacon or a badge on the user's own status line is above all of it: these
statements apply only where no live pair speaks, and never fill a field a live
pair left empty. A phone pick no scan has confirmed still shows nothing.

**Limits.** The effort shows only once the model thinks on a turn: a turn with
no thinking states none, and a model that never thinks never states it (Sonnet
5.5 at its defaults, captured). A toast missed while the phone was away is lost
(the scan replaces it only after a reply and a fresh scan). The spinner is read
off the host's VISIBLE rows on the poll (once a second while the agent works), so
a thinking phase shorter than a poll can be missed; the next one says the same.
The `◐ medium · /effort` row some screens show is a user's own mod, not Claude
Code's, and nothing reads it. Also seen on 2.1.294 and not used: the default
TUI's startup header repaints its `with <level> effort` after a picker switch
while it is still on screen.

### The hook beacon (POSIX hosts)

The launch flag already installs `UserPromptSubmit` and `Stop` hooks that write
a beacon frame to the agent's own tty. Two facts about what Claude Code 2.1.289
puts in a hook's input decide what they can carry (the builder `rd(session, cwd,
permissionMode, toolUseContext)`; read from the binary, not captured live):

- `effort:{level}` is added only when `rd` is handed a tool context and the model
  takes effort (`sw(model)`). `Stop`, `PreToolUse` and `PostToolUse` are built
  with one; `SessionStart` and `UserPromptSubmit` are not.
- `model` is a field of `SessionStart` alone.

So `SessionStart` beacons `model=` (`agent-hud-session-start-hook-script.ts`) and
`Stop` adds `effort=` to its existing frame (`CLAUDE_HUD_STOP_HOOK_SCRIPT`).
`PostModelSwitch` (2.1.289, `GHr`; also in the hook-event list the settings
schema accepts) fires after ANY change of the effective model, with `from_model`,
`to_model`, `requested_model` and `source` (`command`, `picker`, `sdk`, `auto`,
`resume`) but no effort. It beacons `model=<to_model>` when that is a Claude id
(an alias is skipped; the status line names it within a beat). No hook fires for
an effort-only change. Tool
hooks also carry effort but fire on every tool call, one `sh` each, so they are
not used. A pick made for one session only is reported at that session's next
Stop, which the settings file never records.

On the phone (`pairFromHookFrame` in `agent-hud-beacon.ts`): a model frame with
no `name=` and no `effort=` is a SessionStart. For the model already held it
keeps the status line's name and effort; for another model the old effort goes.
An effort frame with no model lands on the held pair, or is kept until a model
arrives and drawn by nobody alone. A status-line frame always carries `name=` and
replaces the pair, as before. A frame that names only an id is named the way the
transcript names an id ("Opus 5.5"), not shown raw.

Hooks are skipped under the same conditions as the status line: `disableAllHooks`
("Disable all hooks and statusLine execution") and an untrusted workspace ("hook
execution - workspace trust not accepted" beside "Status line command skipped:
workspace trust not accepted"). They add coverage where the status line is not
mounted yet or has not ticked, never where it is switched off.

### Hooks always exit 0

Claude Code reads a non-zero exit from a hook as a hook error, and exit 2 from a
`Stop` hook as a BLOCKING error fed back to the model; a hook's stdout is added
to the model's context (`PostModelSwitch` adds `hook_success` content to the next
request). So every command we install prints nothing and ends in an
unconditional `exit 0`: the tty writer runs in a subshell with stderr silenced
(`AGENT_HUD_TTY_WRITE`), because under dash a failed `>>` redirect exited the
shell with status 2 and the last command's failure became the hook's status
(review H3, 2026-10-05). This covered the `Stop` hook already on main.
`agent-hud-hooks-exit-zero.test.ts` runs every installed command (the status line
included) under sh, dash, bash and zsh against a tty that cannot be written.

### Which tabs carry the flag

| Tab | Flag | Proof |
|---|---|---|
| Launched from the phone | Yes | `agentHudLaunchFlag` on every phone launch |
| Orca's desktop "new agent" UI | Yes, once the phone has connected, with the Chat UI switch on and no `--settings` of the user's own | The phone writes the flag into Orca's per-agent `agentDefaultArgs` over `settings.update` (`agent-hud-desktop-launch-args.ts`); Orca appends them to every agent it launches |
| `claude` typed by hand into a shell | No | Nothing the phone can set reaches a terminal it did not create. Claude takes settings from `--settings <file-or-json>` and from files; the only env vars are `CLAUDE_CODE_MANAGED_SETTINGS_PATH` and `CLAUDE_CODE_REMOTE_SETTINGS_PATH`, both paths to a file we would have to write |
| Windows host | No | See below |

### Windows

No encoding was found that is safe, so `hostTakesAgentHudFlag` stays as it is.

- Claude parses `--settings` with a JSONC parser (comments and trailing commas,
  double-quoted strings only), so the JSON needs raw double quotes; there is no
  quote-free form.
- Windows PowerShell 5.1 drops unescaped inner double quotes when it builds argv
  for a native program. Escaping them as `\"` fixes 5.1 and breaks PowerShell
  7.3+, whose native-argument passing escapes them itself, so a `\"` arrives as
  a literal backslash. One literal cannot be right for both, and the phone cannot
  know which PowerShell Orca runs.
- Orca quotes agent arguments for PowerShell with `quotePowerShellLiteral`
  (single quotes, inner text verbatim). It ships `quotePowerShellNativeArgument`
  (the `\"` escaping) but uses it for `wsl.exe` only.
- `--settings` takes a file, but only one that already exists with our content;
  we may not write one.
- No `pwsh` is installed on the development machine, so the existing PowerShell
  harness could not run here. A real Windows machine, with the PowerShell Orca
  actually uses, is needed to prove any encoding.

### What is NOT a source, and why

- **Claude's settings file** (`modelSettings[<id>].effortLevel ?? effortLevel`,
  which the `usage-band` mod reads through `$.settings.read()`). Not reachable
  with nothing installed: `files.read` takes a worktree-relative path (no
  absolute path, no `..`), `files.readTerminalArtifact` needs a grant for a path
  that appeared in a terminal's output and only allows temp directories, and the
  one route left (a background terminal running a reader, above) was removed on
  2026-09-09 and is forbidden by CLAUDE.md. A default is also not the session's
  effort: a pick made for the session only is recorded nowhere else. Showing it
  as fact would be wrong exactly when the user changed it.
- **The launch argv or env** (`--model`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL`).
  The tab snapshot (`RuntimeMobileSessionTerminalTab`) carries `launchAgent`,
  `startupCwd` and `launchDraft`, no argv and no env.
- **`effort.level` in hook payloads through Orca.** Orca 1.4.220 forwards neither
  it nor the model to `agentStatus` for Claude. Our own hooks above read the same
  input instead.
- **The request's `"effort":"…"` in the transcript JSONL** (the mod greps it for
  subagents). Orca's reader publishes `{id, role, blocks, timestamp, source}`
  only, so it never reaches the phone.

### Wordings read from the transcript rows

Read from the 2.1.289 binary (modelled, not captured from a live session) except
where marked. A command's output counts only as the row right after its own
`<command-name>/model|effort|fast</command-name>` envelope; the fallback notice
has no envelope and is read from `system` rows only: an assistant reply that
opens with "Switched to X because" is prose, not the harness (review, 2026-10-05).

| Row | Model | Effort |
|---|---|---|
| `Set model to \`X\` and saved as your default for new sessions` / `… for this session only` (captured on 2.1.278) | X | null |
| `… with \`high\` effort` after either (level in backticks, `Jb`; an unwrapped level is read too) | X | the level |
| `Kept model as \`X\`` | X | kept if it was X's, or set before any model was named |
| `Current model: \`X\`` [`(this session only)`] [`(effort: high)`] | X | the level, else null |
| `↯ Fast mode ON · model set to \`X\``, only when `/fast` promoted the model | X | null |
| `Switched to X due to high demand for Y` / `… because Y is not available` / `… returned an error …` | X | null |
| `Set effort level to high (…)` (captured on 2.1.278), `Current effort level: high`, `Effort level: auto (currently high)`, `Effort 'max' exceeds the cap …; set to 'high' instead`, `CLAUDE_CODE_EFFORT_LEVEL=high overrides this session`, `… Effort stays high` | unchanged | the level |
| `Effort level set to auto …` | unchanged | null |

The levels are `low`, `medium`, `high`, `xhigh`, `max`; `auto` is no level.

### Superseded and unseen changes

A model can change with no row the phone parses: the alt+p inline picker, the
effort-step keys, a resume into a new process. When a reply came after the
command (`answeredAt`), the scan was taken after that reply (`freshAsOf`) and
names another model, the scan is newer and the command is dropped, effort
included (`withSessionCommandPair`). An effort-only command is bound to the model
the scan read when the phone first saw it (`boundModel`). Row times are the
host's clock and `freshAsOf` the phone's; the skew is the one
`resolveClaudeModelFallback` already accepts. The last pair read for a session is
kept in memory so a reconnect that replaces the ~40 loaded rows does not lose a
command typed further back. A phone pick not yet confirmed by a scan shows
nothing, and an older command row does not bring a figure back (2026-09-18).

### Ways the effort changes for one session

| Case | Written where the phone can read it | Source | Status |
|---|---|---|---|
| `/model` picker slider, or typed `/model` | stdout row | command row, then the next Stop frame | wording modelled, row shape captured |
| `/effort <level>` | stdout row | command row, then the next Stop frame | wording modelled, row shape captured |
| `/effort auto` | stdout row, no level | effort unknown until the next Stop frame | modelled |
| bare `/effort`, bare `/model` | stdout row | command row | modelled |
| Ultracode on or off | stdout row (`Effort stays X`) | command row | modelled |
| `CLAUDE_CODE_EFFORT_LEVEL` set before launch | nothing until the user runs `/effort` | the next Stop frame (the hook input carries the level the session sends) | modelled |
| `--effort` flag | nothing on the tab snapshot | the next Stop frame | modelled |
| effort-step keybinding, `ultrathink` | not found writing a row | the next Stop frame | modelled |
| "Effort unsupported" latch | `effort` leaves the status line and the hook input | a beacon states the model alone | read from the binary |
| `/fast` promotion, overload fallback | `Fast mode ON · model set to`, `Switched to …` | command row | modelled |
| alt+p picker | a toast for about 2 s, nothing in the transcript | the toast (model, effort cleared), then the next thinking spinner (effort) | captured on 2.1.294 |
| any change, on a thinking turn | the spinner's `thinking with <level> effort` | the screen poll | captured on 2.1.294 |
| resume into a new process | nothing parsed | the scan, ordered against the command | modelled |

A resume in a new process keeps the SAME session id (verified on 2.1.276 for
`-c` and `--resume`, `agent-hud-beacon-liveness.ts`), and the model and effort
can revert to defaults with it. On a tab with the flag the new process's
`SessionStart` frame names the model and a different one drops the old effort;
on a tab without it nothing visible marks the resume (no row of its own has been
seen), so the remembered effort stands until a newer row or beacon. This is a
known limit, not a proven bug: whether the transcript carries a resume marker
the phone could read is not established.

A tab with no beacon at all (typed-in, or an untrusted workspace) has only the
rows. For a case none of them records, the pill shows the model with no effort,
or nothing; it can still show a stale figure when the change left no row and no
reply followed the old command (the command stands until a reply and a fresh scan
say otherwise).

### New sessions

| Session | Before its first prompt | After it |
|---|---|---|
| Phone-launched (flag) | `SessionStart` frame: the model; then the status line's pair at its first tick | status line, `Stop` effort |
| Orca desktop UI (flag, if the phone has synced) | same | same |
| Typed-in `claude`, no flag | nothing | the scan's model, any command rows |
| Windows | nothing | the scan's model, any command rows |

### Codex

Not applied. Codex states model and effort in its own footer and rollout, which
the beacon and screen readers already take.

### A switch while the phone is away, and what survives

The beacon is a stream event: nothing replays it. The phone unsubscribes a tab's
terminal stream whenever it leaves it (another project, another tab, a
foreground recovery, a reconnect: `noteAgentHudBeaconListening`), the host's
snapshot is a rendering of the screen and holds none of the invisible C0 bytes,
and a frame written meanwhile is lost. What it keeps instead:

- the last beacon per terminal, in memory and, for a relaunch, in the warm-start
  store (`agent-hud-beacon-warm-start.ts`);
- the last pair read from the session's own command rows, per session id, in a
  persisted store (`claude-session-command-pair.ts`, `createPersistedMap`, fail
  open both ways).

Everything is ordered by the PHONE's clock. A model command outranks the beacon
only when the phone first saw its row (`seenAt`, set by `sessionCommandPairFor`
and persisted with the pair) after it last HEARD that beacon (the last arrival,
repeats included: `getAgentHudBeaconArrivedAt`; for a warm-start record only its
stored time). The host's row time is never compared with the phone's clock: that
comparison let an old `/effort` outrank a newer beacon with the phone an hour
behind (review N2). The scan ordering does compare host row times with the
scan's phone clock (`freshAsOf`); that is a skew it accepts and this does not.
The next arrival ends the override, so it lasts until the beacon's next repaint,
normally 5 s. The hook listens for arrivals only while a command is waiting on
one (`subscribeAgentHudBeaconArrivals`), so a quiet tab is not re-rendered on
every repeat.

The race, and its closure (review R1): "first seen after the beacon" is only
evidence of a switch when the phone saw the command APPEAR, that is, when it
already held a pair for the session and this one differs. With nothing held for
the session (first view on this device, the 32-entry eviction, a failed hydrate)
a command's first sighting says nothing about when it was written, and an OLD row
loaded after a fresh beacon read as newer than it. So a pair first seen with
nothing held is stored with `seenAt = -Infinity` and can never outrank a beacon;
a record kept before the field existed, or whose `-Infinity` came back from JSON
as null, stays "never" too. An old row seen for the first time therefore no
longer outranks a live beacon. The cost: in a session never viewed on this device,
a switch made while away shows only from the beacon's next frame (at most 5 s
after resubscribing), not from the rows. A late pair is acceptable; a wrong one
is not.

A command must also add something: a row that states less than the beacon (the
same model with no effort, "Kept model as" after Esc in the picker, `/effort
auto`, the same effort) never erases what the live beacon states (review N3). A
beacon heard after the command wins; a badge on the screen is the present and is
never outranked. Any
pair older than a confirmed switch is dropped; one that is merely old, with no
conflicting evidence, is shown as it was left. It is NOT marked "last seen": the
same pair is already shown for an idle tab that has not repainted, a mark would
read as a warning on every healthy idle tab, and the first beacon, normally
within one repaint, replaces it anyway.

### Switch scenarios

Delays are worst cases. "Status line" is Claude's own refresh: it re-runs on a
change of `mainLoopModel`, `effortValue` and the other inputs, and on a 5 s timer
while mounted (`refreshInterval`); read from the binary, not timed on a device.

| Switch | User's state | Source that shows the pair | When |
|---|---|---|---|
| desktop `/model`, picker, `/fast`, overload fallback | on the tab | `PostModelSwitch` frame (model), then status line (effort) | model at once; effort within the status line's repaint, at most 5 s |
| desktop `/effort`, effort keys | on the tab | status line, else the command row, else the next Stop frame | repaint, at most 5 s; with no status line, the row at once, else the next turn end |
| phone picker | on the tab | same as the desktop, plus the phone's own pick rule (nothing shown until a scan confirms) | as above |
| any switch | other project / other tab | frames are lost; on return the command row (newer than the held beacon) | when the chat loads; then the first beacon, at most 5 s after resubscribing |
| any switch, no row (alt+p picker, effort keys, resume) | other project | the first beacon after return | at most 5 s after resubscribing; until then the last pair is shown |
| any switch | app backgrounded | as other project | as above |
| any switch | app killed | warm-start beacon and the persisted command pair, then rows, then the first beacon | rows on open; beacon at most 5 s after |
| any switch | no flag (typed-in, untrusted workspace, Windows) | command rows, the alt+p toast, the next thinking spinner | when the chat loads, the row arrives, or the screen poll sees it (1 s while working) |

### Tests must never reach a real terminal (2026-10-06)

The tty writer walks up to six parents with `ps -o tty=` when `CUIHUD_TTY` is unset
or empty. A test runs under vitest, under the tool's shell, under the agent, which
sits on the user's real PTY, so a test that ran the status-line script with
`CUIHUD_TTY: ''` wrote a beacon for the synthetic session `00000000-…` into the
live terminal of the Orca tab running the tests. The phone then drew "Another
agent started in this tab reported session …; the chat stays on Claude's own
session 00000000". The phone recovers by itself (the leaked beacon holds the chat
only while it is fresh, about 30 s, and the next real frame replaces it:
`native-chat-beacon-leak-recovery.test.ts`), so each further test run re-armed it.

Every test that runs one of our scripts must now pin `CUIHUD_TTY` to a temp file
or run with `noTerminalPath()` (`agent-hud-script-runner.test-support.ts`), a PATH
whose `ps` sees no process. `agent-hud-tests-reach-no-real-tty.test.ts` is a
source-reading ratchet that fails any test that does neither. Do not run these
scripts from a test with a real `ps` and no override, and do not point
`CUIHUD_TTY` at a real device.

The ratchet was hardened after review (2026-10-06): a harmless-looking word in a
call (`uname`, `command -v`) exempts it only when the call runs no variable;
`CUIHUD_TTY: tty` counts as pinned only when `tty` is a literal path that is not a
real device or is assigned, directly or through `join(dir, …)`, from a temp
directory (`mkdtemp`, `tmpdir`, `TMPDIR`); a file is scanned when it names a
script constant, a builder (`buildClaudeHudSettingsJson`, `agentHudLaunchFlag`,
`buildCodexHudNotifyOverride`) or imports one of the modules that define them;
a test that fakes MSYS (`uname`) or uses `noTtyOverride` must pin both
`CUIHUD_WIN_TTY` and `CUIHUD_WIN_CONOUT`, because the Windows branch writes to
`${CUIHUD_WIN_TTY:-/dev/tty}`; every file that imports `child_process` under
`src/` and `scripts/` is scanned, helpers and `*.test-support.ts` included; and a
`//` inside a string no longer hides the rest of the line. The script's own
`/dev/tty` fallback stays: on a real Windows host `/dev/tty` is the attached
console, which is where the frame belongs, and a fallback to nothing would only
drop the Windows beacon. A whole-suite run in a new session with no controlling
tty, stdin from `/dev/null`, a `ps` that prints nothing and every override on a
temp file is the belt that catches what a source-reading test cannot.

### Three lines against a test reaching a real terminal (2026-10-06)

The tty writer walks ANCESTORS, so the only structural fix is that no ancestor of
the tests, within six steps, holds a terminal. Source-shape ratchets kept missing
shapes (Opus, three rounds), and a PATH-shadowed `ps` does not cover a spawn with
its own PATH: macOS's `/bin/ps` cannot be shadowed, and a reviewer's scratch spawn
with `PATH: '/usr/bin:/bin'` used it, walked to the agent on `ttys010` at depth 5
and wrote one frame into the real terminal. `setsid` alone does not help either: it
drops the process's controlling terminal, not its ancestors'.

1. **Primary: `mobile/scripts/run-detached.mjs`, which `pnpm test` runs vitest
   through** (and so does the release workflow's `pnpm test` step). It double-forks:
   it starts `sh` in a new session, `sh` starts the command in a background subshell
   and exits, so the subshell is reparented to pid 1 and the command's chain is
   command, subshell, pid 1, with no terminal in it. stdout and stderr are pipes the
   subshell inherits, relayed until the last writer closes them; stdin is `/dev/null`;
   the exit status travels through a file; SIGINT, SIGTERM and SIGHUP are forwarded to
   the process group. `scripts/run-detached.test.ts` runs the real runner and has the
   command READ its own ancestry (real `ps`, no write): it ends at pid 1 with no
   terminal. `src/test/vitest-runs-detached.test.ts` fails hard when vitest runs with a
   terminal among its ancestors, on a developer machine: run `pnpm test`, not `vitest`
   from a terminal. The same read-only walk (`mobile/vitest.ancestors.ts`) also runs in
   the globalSetup BEFORE any worker starts, so a direct `npx vitest run` from a
   terminal throws at setup with zero tests executed ("A terminal is among this test
   run's ancestors … run `pnpm test`, which detaches it"); the guard test stays for a
   run whose setup was skipped. In CI there is no terminal anywhere, so both pass.
   The runner escalates an interrupt: a command started from a background list has
   SIGINT ignored, so after forwarding it sends SIGTERM and then SIGKILL to the group
   (2 s, 4 s) and exits 130.
2. **Second: vitest's `globalSetup`** (`mobile/vitest.global-setup.ts`): a `ps` that
   prints nothing, and logs each call with a `CUIHUD_PROBE` token, first on PATH, and
   `CUIHUD_TTY`, `CUIHUD_WIN_TTY`, `CUIHUD_WIN_CONOUT` on temp files, with
   `CUIHUD_TEST_SANDBOX` naming the directory. It covers a spawn that inherits or
   spreads `process.env` under the forks, threads and vmThreads pools and for
   `scripts/**/*.test.ts` (same config). It does NOT cover a spawn with its own PATH.
   `agent-hud-test-sandbox.test.ts` resolves `ps` under the exact environment it will
   pass and requires the sandbox shim, spawns the original leak shape
   (`{ ...process.env, CUIHUD_TTY: '' }`), requires a shim call carrying this spawn's
   probe token with `-o tty=`, and compares each sink's size before and after instead
   of requiring zero. The probe shows the call came from an environment that test
   built, not which process called. With the shim missing it fails before spawning.
3. **Third: the source ratchet** (`agent-hud-tests-reach-no-real-tty.test.ts`), for a
   spawn that builds its environment from nothing. A spawn in a file that names a
   script or builder must keep PATH (spread `process.env`, or build `PATH` from it),
   pin `CUIHUD_TTY` to a temp path (every assignment of the name), or use
   `noTerminalPath()`; a `pathShim` counts only when its variable is named `psShim`
   or `fakePs` or it is an MSYS shim with both console overrides (a naming
   convention, not a check of what the shim does); `CUIHUD_WIN_CONOUT` exempts only a
   PowerShell spawn. The environment rule runs BEFORE the harmless exemption, so
   `execSync('uname; ' + s, { env: … })` and its template form are judged as spawns of
   a script, and a hand-built PATH is accepted only with a pinned temp `CUIHUD_TTY`
   (no walk is made then). Its one exemption is the sandbox guard's call, by repo-relative
   path and only a call that carries `CUIHUD_PROBE`. Not chased: a string-form
   `execSync`, a script piped on stdin, wrappers in helpers, import aliases,
   `promisify`.

**Residual routes, stated plainly.** A process already orphaned under something that
holds a terminal, or a host whose init holds one, is not helped by the runner (the
guard test checks the chain it actually got). A test that spawns with its own PATH
and runs a script written in a shape the ratchet does not read still reaches the real
`ps` unless the runner is in use. Running vitest from a terminal without the runner
fails the guard test, and the other tests of that run are protected only by the
sandbox and the ratchet.

**Decision: the script does not refuse to walk when `VITEST` is set.** It would add
test-runner knowledge to a script that ships to users, a user with `VITEST` exported
in a shell profile would silently lose the beacon, and it would not help the case that
matters (a spawn with a hand-built environment has no `VITEST` either).
