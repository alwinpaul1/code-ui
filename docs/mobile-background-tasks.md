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
