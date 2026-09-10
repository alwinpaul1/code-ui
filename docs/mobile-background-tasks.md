# Background tasks pill and sheet (chat mode)

Shows Claude Code's background shells and subagents under the newest message
("N running tasks") with a sheet of Running and Finished rows. Code UI cannot
stop a Claude task, so rows carry no stop control.

## Sources, in order of authority

1. **The transcript** (`mobile/src/session/mobile-background-tasks.ts`).
   A `Bash` call whose result says `Command running in background with ID: …`
   (or `moved to the background (ID: …)`) and an `Agent` call whose result
   carries `agentId: …` are launches. A user-role `<task-notification>` turn
   naming the id retires the task, with `<status>failed` shown as a failure.
   Tool calls pair with results FIFO by ordinal, the rule
   `pairToolBlocks` uses, and an interrupted turn drops its unanswered calls.
2. **The host's hook status** (`agentStatus` on the session tab, from Orca's
   hook listener). This is what fixes the case the transcript cannot see:
   - A completion that lands **mid-turn** is never written as a user turn.
     Claude Code 2.1.266 stores it as an `attachment` record of type
     `queued_command`, which Orca's transcript reader does not surface.
     Observed 2026-09-09 on the S23: five tasks shown running while two were.
   - `agentStatus.subagents` is the live roster kept current by
     SubagentStart/SubagentStop and Claude's `background_tasks` inventory. When
     the host reports status at all, a launched agent absent from the roster
     (or idle in it) is finished. Absent field = none tracked, which is how
     Orca's own sidebar reads it. Roster entries the loaded transcript window
     never showed are listed as running.
   - Orca holds the pane `working` while Claude's Stop hook still lists a
     running non-agent task, so `state: 'done'` means every background shell
     has reported. A shell with no notification while the pane is still
     `working` stays listed; the host gives no per-shell ids, so this is the
     remaining approximation.
   - `null` status (no hooks for this pane, an older host) trusts the
     transcript alone.

## Tests

`mobile-background-tasks.test.ts`: transcript derivation against verbatim
transcript bytes, plus "background tasks reconciled against the host agent
status" (roster retirement with no notification, absent roster, pane `done`
retiring shells, roster-only agents, idle teammates, null status).
`MobileBackgroundTasksSheet.test.tsx`: rendering in both themes.

## 2026-09-09 (late): finished shells retire live, via the beacon

The remaining gap was a shell that finishes while Claude is still working:
no hook fires for it, the notification is a `queue-operation` record Orca's
reader skips, and Claude's footer count proved unreliable. The fix rides the
existing HUD beacon (`docs/mobile-agent-hud.md`): Claude re-runs the
status-line command on every message and tool event with `transcript_path`
in hand, so the script greps the last 256 KB of that transcript for
`<task-id>…</task-id>` (every occurrence is a task-notification — as a user
turn when idle, as queue-operation records mid-turn), deduplicates, keeps the
newest 32, and appends `done=id1,id2` to the beacon. The phone parses it into
`doneTaskIds`, the controller exposes the active tab's list, and
`deriveBackgroundTasks` treats those ids as completed. Verified with the real
records this machine wrote on 2026-09-09 (`fixtures/claude-transcript-task-
notifications-2.1.266.jsonl`). Claude Code only; Codex has no background
shells. Needs the tab to carry the beacon flag (phone-launched, or desktop
with the settings switch on).

### Cross-platform notes (verified 2026-09-09, Claude Code 2.1.267)

- **The reader is five tools every platform ships**: `tail -c`, `grep -o`,
  `sed`, `awk`, `tr`. All are in coreutils, BusyBox and Git for Windows'
  `usr/bin`. A test asserts the line uses nothing else.
- **Windows path conversion.** `transcript_path` arrives JSON-escaped
  (`C:\\Users\\me\\…`) and Claude Code runs the status-line command through
  Git Bash, which cannot open a backslash path — its own `/statusline` agent
  warns about exactly this. The script converts separators to `/` before
  opening the file; repeated slashes collapse, and a POSIX transcript path has
  no backslash, so it is a no-op on macOS and Linux. Tested with a
  Windows-escaped path under every shell.
- **Shells.** The whole script is exercised under `sh`, `bash` and `dash`
  (Debian/Ubuntu's `/bin/sh`, the strictest of the three) wherever `/bin/dash`
  exists.
- **Windows hosts get the PowerShell status line** (`docs/mobile-agent-hud.md`,
  Windows section), whether or not Git Bash is present, and it carries the
  same `done=` list. Its console write is the one link that has not run on a
  real Windows machine.

## The beacon's window is a window, so the phone remembers what it saw

Measured 2026-09-10, Claude Code 2.1.266, on a 40 MB session transcript. The
status-line command reads a fixed tail of that transcript to find the
`<task-id>`s of tasks that finished mid-turn. A busy session wrote past that
tail in **87 seconds**: a subagent's failure notice sat 1.27 MB behind the end
of the file by the next refresh, so the beacon stopped naming it. The phone
kept only the newest beacon's list, so the id was lost for good and a dead
agent sat in the running row for 25 minutes while the desktop showed it gone.

Two changes, because either alone still loses ids:

- The phone remembers the union of every id a beacon has named, per terminal
  handle (`mobile-finished-task-id-memory.ts`). An id now has to be seen once,
  not continuously. Capped at 512, oldest dropped first, and reset when the
  handle changes so one tab never retires another tab's tasks.
- The tail grew from 256 KB to 1 MB (`sh`), and from 600 to 2000 lines
  (PowerShell). That is roughly six minutes of the busiest session measured
  here, which covers a phone that was backgrounded for a few minutes and saw
  no beacons at all.

This does not make the window unnecessary. A phone that has been away longer
than the window still misses ids, and those tasks stay in the running row
until the turn ends and the pane reports `done`.

## The agent is the authority now, not the transcript

Measured 2026-09-10 against this project's own 40 MB transcript: reading the
transcript alone reported **36 background tasks running when 3 were**. Every
retirement path the reader has is indirect — a completion that lands mid-turn
is written as a record Orca's transcript reader never surfaces, so almost
nothing ever retired on its own.

Claude Code's Stop hook payload carries `background_tasks`, each with an `id`
and a `status` (captured from Claude Code 2.1.267; the payload is a fixture
next to `agent-hud-stop-hook.test.ts`). The phone now installs that hook
through the same `--settings` launch flag as the status line — still no file
and no configuration on the host — and the hook beacons the ids still running.

`runningTaskIds` outranks everything the transcript says: a launch missing
from it has ended. It is deliberately three-valued. Absent means the agent has
not answered, which is the normal state mid-turn, and the transcript stays the
only source until the turn ends. Empty means nothing is running, which is what
clears the row on the last task.

The two beacons are merged rather than replacing one another: the status line
says what the agent IS, the Stop hook says what it still has RUNNING, and
neither carries the other's fields.

**This only takes effect for a tab opened after the phone is updated.** The
launch flags are fixed when the agent starts, so a session already running
keeps the old settings, hook and all, until its tab is opened again.

