# Background tasks pill and sheet (chat mode)

Shows the agent's background shells and subagents as "N running tasks" on
the status line above the composer (beside the agent's own spinner verb, as
the Claude app draws it since 2026-09-24), with a sheet of Running and
Finished rows that opens part way and drags up to full screen. A run of Agent
calls in the conversation reads "Running agent" while any of its agents is
still in the running list below, and "Ran N agents" after.

**Two readers, one row.** Which one runs is decided by the lane, not by the
agent:

- A **terminal-driven tab** has only the transcript the phone already holds,
  reconciled against the host's hook status and the HUD beacon. Everything
  below the next heading describes that reader, and it is unchanged.
- A **structured tab** gets the provider's own roster from the host over
  `agentSession.subscribe`, and that is the whole answer for the tab.

## The structured lane reads the host's roster

Orca #18757, #18807, #19346 and #19311 put provider-owned background work on
the structured-session wire. The phone keeps it in the shared reducer's state
and projects it in `mobile-structured-background-tasks.ts`.

Three states, and the first two are not the same thing:

- **`undefined`** — this host has never reported a roster (an older host, or a
  session that has never had background work). The transcript reader keeps the
  tab, exactly as before the wire.
- **`null`** — the host reported one and cleared it. Authoritative: the
  transcript reader must *not* take the tab back and re-list work the host has
  just said is gone.
- **an object** — the live roster. `tasks` are Running; `settledTasks` are
  Finished, with a `blocked` one shown as a failure.

Why the two readers are not merged: they speak different id spaces (Claude's
transcript task ids versus the SDK's task frames), so stitching them risks the
same task appearing in both sections. The cost is that a structured tab's
Finished list holds only what the host still keeps — the host flushes settled
tasks once the last live one ends — so it is shorter than the transcript
reader's history. The Running list, which is what the row counts, is strictly
better: it is the provider's own answer, so it never strands a task the
transcript could not retire.

**Stopping one task** is offered only where the roster says
`supportsTaskStop`, and never on a row the host marks `stoppable: false`
(Orca #19705, 2026-09-10: a foreground subagent live inside the turn, which
the SDK cannot target — the phone advertises
`agent-session.background-task-row-stop.v1` so the host sends those rows at
all, and hides their Stop). Absent means stoppable, as every older host meant
it. It sends `agentSession.cancel` with
`{ turnId: 'background-tasks', scope: 'background-tasks', taskId }` — the
`turnId` there is the host's scope marker, not a real turn, because a
background task outlives the turn that launched it. Codex reports
`supportsStopAll: false` (it exposes no honest stop: `turn/interrupt` on a
child ends its turn and leaves the shell running), so no stop is drawn for it.

**Not ported:** the wire's `totalTokens` per task. Upstream's desktop strip
renders it as "18.1k · 2m"; the phone sheet has no place for it yet, so it is
read off the wire by the equality check and then dropped.

**Not verified against a live host.** The shared contract and the projection
are covered by tests, but no structured session on a real desktop has been
watched publishing a roster to this phone. The fallback is the safe direction
— a host that publishes nothing leaves the tab exactly where it was.

## Terminal tabs: sources, in order of authority

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
     the host reports status at all, it decides every agent it tracks: a
     launched agent absent from the roster (or idle in it) is finished, and
     one it lists is running even after a notification (a resumed agent
     notifies again). Absent field = none tracked, which is how Orca's own
     sidebar reads it. Roster entries the loaded transcript window never
     showed are listed only when they are the session's own; see "The count
     is the session's own work" below.
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
`MobileBackgroundTasksSheet.test.tsx`: rendering in both themes, and the
structured lane's roster taking the sheet over from the transcript reader.
`mobile-structured-background-tasks.test.ts`: the wire projection, including
the `undefined` / `null` split above.
`mobile-structured-session-background-tasks.test.ts`: the shared reducer and
coalescer keeping the roster, and a task edge not rebuilding the transcript.

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

## Parallel agents are paired by what Claude Code says, not by order

The reader pairs a call with its result first-in-first-out, because Orca's
reader drops the tool_use ids. For agents launched side by side that is
wrong: Claude Code 2.1.281 writes each launch result when the launch is
acknowledged. Five agents launched on 2026-09-23 had their results written
4th, 2nd, 1st, 3rd, 5th, so three rows carried another agent's title and
time, and "View transcript" opened another agent's file under the wrong
name (`fixtures/claude-parallel-agents-2.1.281.ts`).

Claude Code names each id's description in two places the phone reads: the
host roster (`agentStatus.subagents`, filled from Claude's own
`background_tasks`) and an agent's finished notification (`Agent "<description>"
finished`). Where either names an id, the launch takes the call with that
description (`mobile-background-task-agent-titles.ts`). Where neither does,
the first-in-first-out pairing stands; nothing better is in hand.

A foreground agent's result is its report followed by `agentId: …` and a
`<usage>subagent_tokens: …` block, which is written only once the run is
over. Such a launch is filed under Finished at once instead of waiting for a
roster that may never come.

## The count is the session's own work (2026-09-26)

Reported from the phone: "Working… · N running tasks" read 5, then 8, back
to 5, then 11, then 10, changing within seconds, on session 967668df (entrypoint
cli; its records say Claude Code 2.1.281, the installed binary was 2.1.283).
The lead had five agents of its own running for hours; each started reviewer
agents of its own that came and went; background shells started and finished
mid-turn.

**What Claude Code itself holds.** One task registry for the whole process:
every subagent's context is handed the lead's `taskRegistry` and
`queuedNotificationsRegistry` (the same code in the 2.1.281, 2.1.282 and
2.1.283 bundles). That shows in three places the phone reads:

- The lead's transcript carries a `queue-operation` record for every
  notification in the process. In this session 337 of the 467 enqueued ones
  were for tasks the lead never launched (a reviewer's, a reviewer's shell's).
- The Stop hook's `background_tasks` is every running backgrounded task in the
  registry, reviewers included. Seen live at 00:53:36: two spawnDepth-2 rows on
  Orca's roster gained descriptions from the lead's Stop, like the lead's own.
- The footer's "· N shells" pill is filtered by kind only (`yX` in 2.1.281,
  `MJ` in 2.1.283), never by owner: a reviewer's test shell is in it.

What Claude Code DRAWS as the session's agents is narrower: the agent panel
beside the prompt lists only the lead's agents at the top level, and folds a
reviewer under its parent as "(+N)" (its row filter keeps a row whose nearest
live parent agent is the one being viewed; none, at the top). The phone counts
that set, plus the lead's own shells. Its Background dialog and the Claude
app's `background_tasks_changed` feed do count everything in the registry.

**The replay.** Every launch, completion (user turns, attachments and
queue-operations alike), TaskStop and turn end of 23:50–00:34 was replayed
against the real reader every 5 s, with the roster rebuilt from each
subagent's own transcript and `.meta.json` (`spawnDepth`, `parentAgentId`),
and the beacon lists rebuilt from the same 4 MiB tail the status line reads.
The truth was 5–7 (five agents, 0–2 shells). The phone's old rule gave 4–13
and changed 38 times; the sources, one by one:

| Source | What it did | Effect |
| --- | --- | --- |
| Orca's roster | listed the reviewers beside the lead's agents, and the reader added any row the window had not shown launched | +1 to +3, moving as reviewers came and went |
| The footer count | counted the reviewers' shells, and the reader padded unnamed "Background shell" rows up to it | +1 to +4, moving with every reviewer's test run |
| The status line's `live=` | lists shells only, yet retired every agent launched before its last change | −1 to −3 each time a shell started or finished |
| The Stop hook's `run=` | lists agents, so for the one beacon after each turn end the agents came back | +1 to +3 for a few seconds at every turn end |
| The pane's working start | moved when the lead's question at 23:23 was answered, and "launched before the current working run" retired four agents and a shell that ran on | −1 to −5 |
| A stopped shell | bhcfbe9vf, stopped at 00:20:27, gets no notification; `bg=` and `live=` keep naming it once the TaskStop scrolls out of the window | +1 later on |

**The rule now** (`mobile-background-tasks.ts`, `-roster.ts`, `-footer.ts`,
`-evidence.ts`, `-memory.ts`, `use-active-tab-task-report.ts`):

- An agent the host tracks runs while the roster lists it. Neither beacon
  list judges an agent. A notification outranks the row only when it was
  written after the row started: Orca re-creates a row at every
  SubagentStart, so a resumed agent's row starts after its last
  notification, and a row that started before it is a phantom Orca kept
  after missing the SubagentStop.
- Each roster row the loaded window never showed launched is placed once,
  the first time the phone sees it with a window loaded
  (`mobile-background-task-memory.ts`): the lead's own when the lead's
  transcript launched it (any result that opens with "Async agent launched
  successfully", whichever call it pairs with) or messaged it, or when an
  Agent call of the lead's still waiting for its result was made at or
  before the row started (a foreground agent has no id anywhere until it
  ends; one row per call, earliest first); given the benefit of the doubt
  when it was on the first roster the phone read, or started before the
  loaded window reaches back to; otherwise a subagent's, which stays so as
  the window slides. A teammate (`a<name>-<hex>`) always counts. A
  doubted row that stops loses the doubt: whoever resumes it next shows it.
- The footer count caps the lead's named shells always. It pads unnamed ones
  up to its count while no subagent runs, and while one does up to what it
  counted the last time none ran (plus shells launched since), since those
  can only finish. A reading keeps capping the shells launched before it
  while a dialog hides the footer; a held reading never speaks for the run
  boundary.
- "Launched before the working run" retires a shell only when no beacon
  list can speak for it, and the run is the one that followed the last
  `done` the phone saw: a question or permission prompt moves the pane's
  `stateStartedAt` but not that. The first working state the phone sees
  stands in, as before; after a `waiting` it has no start for, it retires
  nothing.
- Ids a window showed ending (a notification, a TaskStop) are remembered for
  the session, so a slid window cannot bring them back.
- A host status missing from one snapshot is bridged by the last one for up
  to 60 s.

**Two shapes the beacon scripts and the reader did not know** (2.1.280 to
2.1.283 bundles, 2026-09-26): the Stop hook's `background_tasks` writes each
type through an alias table, so a teammate arrives as `teammate`, never
`in_process_teammate`, and the hook now drops both; and `qMn` has a fourth
background sentence, "Command was moved to the background (ID: …) so that a
message that arrived while it was running can reach you", which the reader,
`bg=` and `live=` now read. No transcript on this machine holds one yet. The
sentence could in principle follow captured output (the result is
`[stdout, stderr, sentence].join`), which the start anchor would miss, but
every real background result here from 2.1.212 to 2.1.282 opens with it; the
only later matches are quotes (greps, code, JSON dumps), which is what the
anchor is for.

Replayed again with the new rule, through the real session memory: 5–9, ten
changes, each a real event (a shell starting or ending, an agent launched, a
first-look reviewer stopping), and no task of the lead's ever missing with a
40- or a 150-message window, with or without the beacon. The one exception
is a tab with no beacon, no footer on screen and a 40-message window: two
shells whose launches had already left the window are named by nothing, for
the old rule as for the new.

**Codex** has none of the sources that flapped: its transcript records no
launch the phone reads, its notify beacon carries no task ids, and the footer
count is read for Claude only. Its count is Orca's Codex roster as it stands
(SubagentStart/SubagentStop hooks and the parent rollout's
`sub_agent_activity`), and it shares only the missing-status flap, now
bridged. If Codex fires SubagentStart for a child's own child on the lead's
pane, that row is counted: nothing the phone reads can place a Codex row. Not
verified: none of the 12 rollouts on this machine (codex-cli 0.153.4) ever
spawned a sub-agent.
