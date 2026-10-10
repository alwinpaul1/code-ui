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

## The sheet's drag (2026-09-27)

The sheet is a `BottomDrawer` with `expandable` and `dragContentToDismiss`.
It is laid out once at full height and only moved (`translateY`): 0 at full,
the opening offset at its opening height. It used to be resized with the
finger, and on the phone a drag down from full height scrolled the list up
under the finger, took the title off the top, and left the sheet at its
opening height with the list part way down. There the list does not scroll
and the content's pan waited for the list to reach its top, so nothing on
the list moved the sheet until the handle was found.

Now: the title and close cross are the drawer's `header`, pinned above the
list and draggable like the handle. While a drag on the list moves the sheet
below full height, and while the sheet stands at its opening height, the list
is held at its top (`scrollTo` from its scroll handler); a fling under a
handle drag is left alone. At the opening height a drag on the list always
moves the sheet, and the list is put back at its top when the sheet comes to
rest there. A drag the sheet followed always ends on a rest, and turning the
phone moves the sheet onto its new rest. The gestures are built once, so the
clock's tick and streamed messages do not rebuild them mid-drag
(`use-bottom-drawer-drag.ts`, `background-tasks-sheet-drag.test.tsx`).

The sheet never stands above full height: its box is exactly that tall, and
above it the bottom would lift off the screen. Its springs settle without
overshoot (`drawer-spring.ts`): the old `{damping 28, stiffness 400}` named no
mass, Reanimated 4 filled in 4, and the sheet sprang about 50 dp into the
status bar. At the opening height the sheet's bottom, with its inset padding,
is below the screen, so a strip of the sheet's colour lies over the rows at
the screen's edge and keeps them off the gesture bar. A sheet reopened while
it was still closing shows its list from the top.

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
background task outlives the turn that launched it. Codex used to report no
task stop (`turn/interrupt` on a child ends its turn and leaves the shell
running), so no stop was drawn for it. Since Orca #26780 a host whose Codex is
0.140 or newer stops a backgrounded command through Codex's own
`thread/backgroundTerminals/terminate` and reports `supportsTaskStop: true`,
and #27026 adds a Codex sub-agent's Stop; the sheet reads only the flags, so
those rows get a Stop with no phone change. Grok's commands and sub-agents
(#27022) arrive the same way.

**A Stop holds its button** from the press until the answer, and, when the
host confirmed it (`cancelled: true`), until the row leaves the Running list
(`use-mobile-background-task-stops.ts`, Orca #26780). A failed, unconfirmed or
nothing-stopped answer gives the button back at once, and so does a row that
leaves and comes back. There is no timer.

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
   - Orca does not always send the hook row. Where it sends a status built
     from the terminal title instead, the readers read the pane's last hook
     row through it; see "Orca's title stand-in" below.

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
  written after the row started: a row that started before it is a phantom
  Orca kept after missing the SubagentStop.
- A resume starts a new run. SendMessage's result says so as JSON,
  `{"success":true,"message":"Resuming agent a38e168","resumedAgentId":…}`
  (Claude Code 2.1.281–2.1.283), and an ending from before it belongs to the
  run it followed (`mobile-background-task-resumes.ts`). Orca only re-creates
  a row, with a new start, when the row had left: on 2026-09-28 a38e… stalled
  at 13:34 with no SubagentStop, the lead resumed it at 16:28, and its row
  still read 12:18, so the reader took the 13:34 failure for the end of the
  running run and the status row showed no task. The resumed run ends at its
  next notification or a TaskStop that went through, or when the roster
  drops its row. An id-only finished list (`done=`, earlier windows'
  endings) cannot say which run it names, so against a roster row it ends
  nothing; with no host status at all it does end the run, since a resumed
  run that finishes mid-turn has its notification dropped by Orca's reader
  and would otherwise show for ever.
  A resume counts only when its `resumedAgentId` is the agent a SendMessage
  of the same step addressed (by id, or `a<name>-<hex>` by name) and that
  call still waits for its result. A step is the stretch of calls and
  results between two messages with no tool block (the lead's reply, the
  next prompt, an interruption); calls and results interleave in it in any
  order, since a result can land before a later call of the same response.
  A command's printout of a resume passes only while a SendMessage to that
  very agent waits in the step; one beside a send to another agent is
  refused and logged. A queued message ("Message queued for delivery to …")
  starts no run. A result that claims a resume in another shape is not
  counted and is logged once; a teammate's resume names no task id and is
  left to the roster.
  Known limits:
  - A resumed run that stalls again, sending no SubagentStop, reads as
    running until Orca drops the row it kept, because `done=` names only the
    id and ends nothing against a row; a first run has the same gap.
  - A resume is missed, and the count stays what it was before resumes were
    read, when a message with no tool block sits between the SendMessage
    call and its result: one holding only text, or one with no blocks at
    all. Either ends the step.
  - A SendMessage whose result is not a resume of its agent keeps waiting
    until the step ends: a queued message ("Message queued for delivery"),
    a failed send, or a result record that never reaches the reader. A
    printout of that same agent's resume JSON later in the step then counts
    as its resume. Queued sends to running agents are routine, so this is
    the likeliest way in; it still needs that exact agent's resume printed.
- Each roster row the loaded window never showed launched is placed once,
  the first time the phone sees it with a window loaded
  (`mobile-background-task-memory.ts`). Orca's `startedAt` is when Orca
  first saw the row, which can be hours after the agent started, so a row
  is a reviewer only when everything that could make it the lead's is ruled
  out. The lead's own: the lead's transcript launched it (any result that
  opens with "Async agent launched successfully", whichever call it pairs
  with) or messaged it; or an unanswered foreground Agent call of the lead's
  was made up to 30 s before the row started (a foreground agent has no id
  anywhere until it ends; one row per call, earliest first, and a call whose
  agent was already up at the first look is used by it; an Agent call is
  answered only by a result shaped like an Agent result — its launch or
  spawn sentence, its report's id line and usage — or by a failure in plain
  call order, so a quick call's result landing first does not use it up,
  nor does a Read that prints an
  id). The benefit of the doubt, until the row stops: it was on the first
  roster the phone read; no other agent was running to have started it
  (none on the roster before it, none on this one started earlier); or it
  started before the loaded window reaches back to. Otherwise a subagent's,
  which stays so as the window slides. Rows are placed only on a settled
  transcript, never on the tail the chat cached when the user left and
  paints while the fresh read loads, nor on the tail it keeps when a
  re-subscribe comes back empty (`baseRetained`: live rows fold on after a
  gap). Not on a description (Orca's fold
  writes one for reviewers too), a status blip, or the first minute after
  opening: a settled window holds every launch since its oldest row. A
  teammate or named agent (`a<name>-<hex>`) always counts. A doubted row
  that stops loses the doubt: whoever resumes it next shows it.
- **What this cannot place.** If Orca loses its own roster (a restart with
  no saved snapshot) and lists the lead's long agents again later, stamped
  with the moment it saw them, they look like new rows with no launch in
  the window: they are not counted until they stop or the lead messages
  them. A reviewer already running when the phone first looks, or one that
  started before the window the phone reloads reaches back, is counted
  until it first stops. A question answered while the phone looked away
  reads as a missed `done` (below).
- The footer count caps the lead's named shells always. It pads unnamed ones
  up to its count while no subagent runs. While one does, it pads at most
  the unnamed shells the lead had when the footer last counted its shells
  alone (that reading less every named shell launched before it), since
  those can only finish. A reading keeps capping the shells launched before
  it while a dialog hides the footer; a held reading never speaks for the
  run boundary.
- "Launched before the working run" retires a shell only when no beacon
  list can speak for it, and the run is the one that followed the last
  `done`: a `waiting` or `blocked` the phone saw keeps the boundary it had,
  while a new working start with nothing seen between is taken as a missed
  `done` (a queued prompt starting the moment a turn ends, or the phone on
  another tab). The first working state the phone sees stands in, as
  before; after a `waiting` it has no start for, it retires nothing.
- Ids a window showed ending (a notification, a TaskStop that went through)
  are remembered for the session, so a slid window cannot bring them back.
- A TaskStop ends its task once its answer says it went through: anything
  but a failure, or TaskStop's own word that the task had already ended
  (`Task <id> is not running (status: completed|failed|killed)`). A stop the
  user turned down, cancelled or had denied, one that errored, and one still
  waiting on its permission prompt leave the task running (review,
  2026-09-30: a turned-down stop moved a running shell to Finished and the
  memory kept it retired). The answer is paired first in, first out, as for
  every call. The stop is placed at its call, and a notification the task
  sent while the stop waited keeps its own status and summary.
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

## Orca's title stand-in (2026-09-29)

Reported from the phone: "there are background processes running but the
chat UI doesn't show that". No "N running tasks", nothing running in the
sheet, while the desk's footer listed them.

Orca 1.4.216's mobile projection (`renewMobileAgentStatusFromPtyTitle` in
Orca's orca-runtime.ts, `SEa` in the 1.4.216 app.asar) sends a status built
from the terminal title in place of the pane's hook row when the title
changed after the row and the two disagree, or when the row is over 30
minutes old. It carries the title's state (`done` for an idle title), the
row's identity fields, `prompt: ''`, `stateHistory: []`, and nothing else:
no roster, no working mode.

That can happen at the end of every Claude turn. Claude Code animates its
title only while a turn loads, and its Stop hooks run inside that turn, so
the Stop row can reach Orca before the idle title (`✳ …`); any later title
change does the same. With background work running, the row
says `working` (`monitoring` for shells) and carries the roster; the phone
was sent a `done` with no roster in its place, until the next hook. A `done`
retires every shell and drops every roster row, so the count and the sheet
went empty for as long as the lead sat idle. Over a long tool call the same
stand-in, `working`, took the roster away mid-turn and restarted the run
boundary.

The task readers (the count, the sheet, the task memory, the run clock) now
read the pane's last hook row through a stand-in
(`mobile/src/session/agent-status-stand-in.ts`), but only when the phone can
know that row still stands:

- the phone watched the pane since the row: same pane, link up, the host's
  own tab list rather than the one the last visit cached;
- the row carries a prompt or a history, so it is told from a stand-in
  (Orca's headless builder sends hook rows with neither, and there a real
  "no roster" row has the stand-in's shape);
- the stand-in copies at least one of the row's `terminalHandle`,
  `worktreeId`, `tabId`, `terminalTitle` (the `done` Orca sends under a
  shell title once the agent has left copies none), and names the same agent
  and session;
- through a `done`, only while Orca says background work outlived the lead's
  turn.

The last rule is there because the row the phone last saw is often not the
Stop row. Orca coalesces the phone's tab snapshots (50 ms, at most 250 ms)
and builds each from its state at the flush, and every spinner frame
restamps the title, so a plain Stop row becomes a `working` stand-in on the
next frame and a `done` one when the title goes idle. The row held is then
the turn's last tool row, which says the lead was working, not what outlived
the turn: held through the `done`, a shell that finished mid-turn (its
notification an attachment Orca's reader drops, no beacon) stayed "running"
while the lead sat idle (the review of 09aa69a0). What does say it is the
tab's `turnCompletedAt`: Orca's hook listener stamps it on the row that holds
the pane `working` after the lead's Stop because background work is still
registered (vendored `claude-events.ts`), and Orca carries it on the TAB from
the live hook row, past its own stand-in, until that row is 30 minutes old.
The phone's tab comparison now counts it, or a frame where only it changed
never reached the chat.

With no such stamp the `done` is read as it comes, which is also what
retires the work of an agent that exited after a turn that held none: with
no renderer row for the pane, Orca's last resort (`buildPtyMobileAgentStatus`,
"what retires the card once the agent exits") is a `done` with the title
stand-in's exact shape.

The task memory no longer reads a stand-in's missing roster as a roster with
no one on it. It did, after a reconnect or on any stand-in read as it came:
every row the loaded window never showed launched lost the benefit of the
doubt, and when the next hook row listed it again it read as a reviewer's and
stayed hidden until it stopped. What the stand-in hid can still be read off
the first hook row after it: Orca drops a stopped subagent's row and starts
it afresh, so a doubted row back with another start stopped and was resumed
while the roster went unseen, and it keeps no doubt (a teammate's row keeps
its start, so its doubt stands). Only across a stand-in: with every hook row
seen, a new start is no stop. A `claude -p` the lead runs from its Bash tool
posts as the pane, and its SessionStart and its events naming another
session make Orca delete the pane's rows and re-create the lead's running
agents with new starts, while the phone keeps the nested run's statuses
from the task readers. The cost: when a stand-in does fall between that
re-creation and the next hook row the phone reads, or Orca re-lists rows
with new starts after losing its own roster (a restart with no saved
snapshot), a doubted row of the lead's loses the doubt.

The subagent run clock (`mobile-subagent-runs.ts`, `use-subagent-run-clock.ts`)
reads the same status. It never takes a stand-in for a roster: one read as it
comes is skipped, and one read through is the held row, so a subagent keeps
its run through either. A row whose host start moved since the last roster
the clock read is a new run, timed from that start, only when a stand-in read
as it comes hid the roster since, the rule the task memory keeps: the lead
resumed the subagent by SendMessage and the phone did not see it stop. A stop
the phone does see is a roster without the row, and the resume after it is a
new run anyway. With every roster seen, a moved start is the nested claude's
re-creation and the run goes on for as long as the nested claude runs: timed
from it, the sheet read "30s" beside the desk's "1h 15m" (the cross-branch
review of 2f526916 and 163ceb78). The clock compares with the last roster
read, not with the run it kept, because a re-created start stays for the
rest of the run: compared with the kept start, the next stand-in turned it
into a resume timed from the phone's clock, "0s" (the review of 7e632bbb).

A stand-in the task reader reads through never reaches the clock, the held
row does, and the clock is not told of one. Such a stand-in can hide a stop:
when the idle lead's last subagent stops, its SubagentStop row is the
all-clear `done`, and the spinner title of the turn Claude wakes the lead for
lands after it, inside Orca's flush, so the phone is sent a `working`
stand-in in its place. Telling the clock of every read-through stand-in
turned the nested run's re-creation into a resume wherever a stand-in fell
before it: after a permission prompt on the Bash that runs `claude -p` (a
`working` stand-in over the lead's own `waiting` row), or for a background
`claude -p` started after the lead's turn (its `done` stand-in). Telling it
only under Orca's turn end still did the second, and missed the hidden stop
after an interrupted turn, which Orca stamps no turn end on (the reviews of
078a79b9 and f69b5253). A nested run's statuses, and the stand-ins over them,
name the nested session and reach no task reader, so they neither end a run
nor hide the roster.

Its costs:
- The nested case holds only while the nested claude runs. The lead's first
  event after it (the PostToolUse of the Bash that ran it) takes the pane's
  session back, and Orca's listener deletes every row the replaced session
  held (`voidClaimsOfReplacedClaudeSession`), the lead's running subagent
  with them: a lead row that lists none, which the phone cannot tell from the
  subagent's stop. Its next tool call re-creates it, and the run is timed
  from there; the task memory drops it from the count on the same row, as on
  main. The review of 078a79b9 found no evidence on the phone that tells the
  two apart.
- A stand-in read as it comes before a nested claude's re-creation, after the
  lead's last roster read (a reconnect or a tab switch back), times the run
  from the re-creation, as the task memory drops its doubt.
- A subagent resumed after a stop hidden behind a stand-in read through (the
  woken lead above, after a finished or an interrupted turn) keeps its first
  run.
- The clock reads nothing while the chat shows another tab, is closed, or the
  link is down, and the first status back can be a hook row: a subagent
  resumed in that gap keeps its first run. Taking such a gap as a hidden
  roster would time every subagent a nested claude re-created while the user
  was away from its re-creation.

The two kept first runs show only once the loaded window has moved past the
lead's resume, or when the resume reader misses it (its own limit: a message
with no tool block between the SendMessage call and its result): the sheet
times a subagent by this clock only when the window holds neither its launch
nor the lead's SendMessage that resumed it. A subagent the phone first saw
already running has no start to restart from, and a moved start leaves it
unknown, as on main.

Every change to background work fires a hook (a launch is a tool call, an
agent's end is SubagentStop, a shell's end starts a turn), and a hook row
newer than the title takes the pane back, so the held row is the host's
latest word for as long as the phone watches. Otherwise the stand-in is read
as it comes, as before: after a tab switch, a reconnect, or a relaunch, the
tasks leave the count until the next hook row. The Working row, Stop and the
prompt reader keep reading the stand-in.

Known limits:

- Thirty minutes after the pane's last hook row, Orca drops the row and its
  `turnCompletedAt` from the tab, and a lead idle that long with only a shell
  running (nothing fires a hook) loses the shell from the count again.
- An agent that exits after a turn that held background work keeps that
  work listed until the watch breaks or those 30 minutes pass. A silent
  beacon is no sign of an exit: Claude unmounts its status line, and the
  beat, under every picker and dialog, and a terminal keeps the last beacon
  of a process long gone. A rule built on it (8c71e9fd) dropped the work
  of an idle lead with `/tasks` open on the desk, and of a hand-started
  `claude -c` in a terminal a phone-launched Claude had used (its re-review).
- Orca stamps the turn end for Claude only, so on a Codex tab a `done`
  stand-in is read as it comes and a sub-agent that outlived the lead's turn
  leaves the count while it stands. The `working` stand-in over a long tool
  call is read through on both.
- The watch is taken per render. A row applied in the same render as the
  stand-in after it (a burst after a stalled JS thread), or published during
  a relay-to-direct cutover that replays the subscription on a link that
  stayed up, is never seen, and the older row is read until the next hook
  row. When the row missed is the all-clear `done`, which carries that
  turn's `turnCompletedAt` too, until the lead's next turn or those 30
  minutes.
- The run clock's costs, above: the nested case holds only while the nested
  claude runs, a re-creation behind a stand-in read as it comes restarts the
  run, and a subagent resumed after a stop hidden behind a stand-in read
  through, or while the chat read nothing, keeps its first run.

Not watched live. The stand-in's fields are read off Orca's source and the
1.4.216 asar, and the order of the Stop row and the idle title off how
Claude Code 2.1.284 runs a turn; no phone has been seen receiving these
statuses, and the connected tablet has no Code UI installed.

Also found, not fixed: Claude Code 2.1.284's footer pill names only a list
of one kind in its own words ("N shells", "N shells, M monitors", "1
monitor"); a mix of kinds reads "N background tasks" (`Lwe` in the 2.1.284
binary). `parseClaudeRunningShellCount` reads only "N shells", so a mixed
pill gives the phone no footer count to pad from. No real screen of that
pill has been captured, so the parser is left alone.

Fixed 2026-09-30: a Monitor is a monitor, not a shell. The transcript reader
used to give a `Monitor started (task …)` launch the kind `shell`, so the
card drew it as "Shell" with the terminal glyph, and the footer fit counted it
against the pill's "N shells": a monitor beside one shell under "· 1 shell"
retired the monitor as finished while it still ran. It is now kind `monitor`
(the card's Activity glyph and "Monitor"; the Stop hook's `background_tasks`
types it `monitor` too), and the footer fit
(`mobile-background-task-footer.ts`) counts only kind `shell`. While any
monitor runs, the phone fits nothing to the footer's count, neither retiring
a shell nor padding an unnamed one, because the pill's wording beside a
monitor is known only from the binary. A real capture of that pill, with a
monitor and a shell running together, is still wanted; with one, the fit can
read the shell figure out of it instead of standing down.


## A Workflow is one task (2026-09-30)

Verified against Claude Code **2.1.284** (three real lead-transcript records,
`mobile/src/session/fixtures/claude-workflow-2.1.284.ts`), the 2.1.284 bundle as
a reviewer read it, and the vendored Orca source in `src/shared/`. Nothing here
was captured off a live host: where a claim rests on code, it says so.

The Claude app draws a running workflow as one card (name, "Workflow" and the
time, agent and token totals, the description, then a section per phase with a
square and a label for each agent). Code UI drew one raw "workflow-subagent"
Agent row and never the workflow itself. This is what the phone receives, and
so what the card can be made of. **The per-agent half of the Claude app's card
cannot be drawn from it**, and the card does not pretend to.

### What arrives, and where

| Source | What it carries for a workflow |
| --- | --- |
| Lead transcript, assistant `tool_use` named `Workflow` | `input.script` (its first statement is `export const meta = { name, description, phases: [{ title, detail, model }] }`, a pure literal) and `input.args`; a `scriptPath` re-run carries no script. Orca's mobile wire **cuts a tool input string at about 4000 characters** and ends it with `… (truncated)` (`MOBILE_BLOCK_CHAR_CAP`; the shape `mobile-native-chat-created-file-running-work.test.ts` pins), so a long script arrives cut; the meta opens the script and usually survives. |
| Its `tool_result` | Plain text: `Workflow launched in background. Task ID: <id>`, then `Summary:` (the meta description again), `Transcript dir:`, `Script file: …/<name>-<runId>.js`, `Run ID: wf_…`. The record's own `toolUseResult` JSON (`taskType: local_workflow`, `workflowName`) is not surfaced by Orca's reader, so the name comes from the meta, or failing that from the `Script file` line, which is named after the workflow. |
| Completion `<task-notification>` (a user-role row) | `<task-id>` (the launch's id), `<tool-use-id>`, `<status>`, `<summary>`, `<result>` (the model-written return value, 81 KB and cut in the record itself), `<diagnostics>`, then a `<usage>` block: `agent_count`, `agents_done`, `agents_error`, `agents_skipped`, `agents_empty_result`, `subagent_tokens`, `tool_uses`, `duration_ms`. The sweep the reference frames show read 37 agents, 4,853,603 tokens, 5,057,662 ms. |
| Host roster `agentStatus.subagents` | One row per LIVE lane: `id`, `agentType` (`workflow-subagent`), `model`, `state`, `startedAt`. **No `description`, no phase, no workflow id, no tokens.** |
| Per-agent `agent-<id>.meta.json` (on the desktop's disk) | `agentType`, `description` (the label), `workflowPhase`, `model`. The only place a label or phase is written per agent, and the phone cannot read it (below). |

### Why lanes never carry a label

The 2.1.284 workflow runner runs its agents inline and never registers them as
tasks, so they are never in the Stop payload's `background_tasks`, and
SubagentStart carries only `agent_id` and `agent_type`. Orca's only source for a
roster row's `description` is the inventory fold
(`foldClaudeBackgroundTasksIntoRoster`), which a lane never reaches. Worse, at
every lead Stop during a workflow the fold sees no agent-typed task (the
workflow itself is `local_workflow`, dropped by `isAgentChildWorkKind`) and runs
`roster.clear()`; lanes return, unlabelled, on their next tool event. So in
production a lane is `{ id, agentType: 'workflow-subagent', state, startedAt }`
and the roster blinks empty at each Stop. (An earlier version of this section
said the label arrives when a lead Stop's inventory lists it. That was wrong,
and the first cut of the card was built on labelled lanes, a shape that does not
occur; its tests now build lanes through the vendored roster.)

### Why the sheet showed one "workflow-subagent" row

1. The workflow itself is never on the roster (above), so it was never a task.
2. A lane's title fell back to its agent type, "workflow-subagent", because it
   never has a description.
3. The phone counts a roster row only when the lead's own transcript launched it
   (`createRosterOwnership`). A workflow's lanes are started by the runner, never
   by an `Agent` call, so only rows the phone saw on its first roster read
   ("preexisting") got the benefit of the doubt. This is inferred from the code,
   not captured: it fits one row showing while 13+ ran.
4. The roster drops a lane at SubagentStop, so a finished agent is not on it.

### "View transcript", and tokens

Not on the card, because neither is established. The launch result says agents'
transcripts live under `Transcript dir: <session>/subagents/workflows/<runId>`,
not at the `subagents/agent-<id>.jsonl` the existing path computes; the host's
by-id fallback might find them, untested. Orca's `NativeChatMessage` has no usage
field, so a transcript read carries no tokens anyway.

### What the card shows

`parseWorkflowMeta` (`mobile-workflow-meta.ts`), `mobile-background-task-workflows.ts`
and `MobileWorkflowCard.tsx`.

- **Name, description, phases**: the meta literal, read without evaluating it
  (objects, arrays, quoted strings, comments, trailing commas; a call, a computed
  value or an interpolation refuses the whole meta). Only a top-level
  `export const meta =` in code counts, not one named in a comment or a string.
  A script the wire cut ends in `… (truncated)`: what was read whole before the
  cut is kept, never half a string. With no readable meta the name is the
  `Script file` line's, the description the `Summary:` line, and there is no
  Phases section. Phases are titles only.
- **Time**: launch timestamp to now while running (the app's `1h 1m` format);
  the notification's `duration_ms` once finished.
- **Running count**: "N agents running" from the roster's live `workflow-subagent`
  rows, or nothing when it has none (never "0 agents", and a roster a lead Stop
  just cleared reads as none). At the 32-row roster cap
  (`AGENT_STATUS_MAX_SUBAGENTS`) the count is a floor: "32+".
- **What ends a running workflow (or a monitor).** The beacon has two lists.
  The status line's `live=` is sent on every repaint (every 5 s on the phone's
  flag) and is built from Bash launch sentences only, so it never names a
  workflow or a monitor; the Stop hook's `run=` (every `status: running` entry of
  `background_tasks`) can. A shell is judged by the freshest of the two, as
  before. A workflow or a monitor is judged by the last Stop's `run=` alone,
  kept apart from `live=` (`stopRunningTaskIds`, `stopRunningTaskIdsAt` on the
  beacon, replaced on every Stop). Before this, a `live=` repaint about 5 s after
  the launching turn ended retired the workflow as "Completed" and flickered it
  back at every later Stop (reviewed with the real Stop and status-line scripts,
  2026-09-30). It still ends on its own notification, a `done=`, a pane `done`,
  or a later Stop whose `run=` lacks it; a launch after the last Stop spoke is
  not judged by it. With no Stop yet, no `run=` retires it; its notification, a
  `done=` and a pane `done` still do.
- **Attribution rule.** A lane names no workflow, so lanes are counted on a card
  only when nothing says they could be another workflow's: exactly one workflow
  running in the loaded window; a Stop has spoken (`stopRunningTaskIds`) and
  every id on its `run=` is a launch the window showed (a workflow launched
  above the window is running and would be on that list, unlaunched here); the
  window reaches back to before that Stop (so a launch since then is in it, not
  above it); the lane started after this workflow's launch; the host does not
  say the pane is done. `live=` plays no part: it is rebuilt every repaint and
  cannot vouch for what ran before it. Otherwise the lanes are left as they
  were, ordinary agent rows, not attributed and not folded. Counted lanes are
  taken off the running list and not counted twice in "N running tasks". A lane
  a finished workflow left on a stale roster usually started before the next
  launch and is not counted on it; when two workflows overlapped it can have
  started after, and it is counted until the next Stop's roster clear drops it.
- **Finished**: the notification moves it to Finished. The `<usage>` block is
  read from after `</result>` (the result is model-written and can quote one),
  and gives "N agents", "N tokens", "N failed" (`agents_error`, danger tone) and
  "N skipped" when non-zero. The phase titles stay on the card.

### What the card does not show, and what would provide it

| Claude app | Code UI | Why |
| --- | --- | --- |
| Per-agent rows with label, tokens and time | none | Lanes carry no label, and the roster has no tokens or per-agent time. Needs the run's `journal.jsonl` (one line per finished agent, in the transcript dir) read through a host RPC, or Orca surfacing the runner's agents. |
| Per-phase `done/total`, squares (grey finished, blue running) | phase titles only | No phase on a lane, and a finished agent has no row. Needs `workflowPhase` on the roster row (it is in `agent-<id>.meta.json`) and finished lanes kept. |
| "22 agents" and "5.4M tokens" while running | "N agents running" when attributable, no tokens | Totals appear only in the completion notification. |
| Elapsed `61m 44s` | `1h 1m` | The app's own duration format. |

Known limits: a stopped or killed workflow shows "Completed" like a stopped
shell does (the notification's status is not read for it beyond `failed`). The
last Stop's `run=` names a workflow only if the hook's payload lists it as `status: running` (the real hook script names one entry of any type but a teammate); the entry's `type` string for a workflow is taken from the launch result's `taskType: local_workflow`, not captured from a Stop payload. The structured (SDK) lane's `kind:
workflow` rows are not folded: the wire gives them a name and a description only.
A workflow-lane row is also never allowed to vouch for a foreground `Agent` call
(`callStarted`): it came up beside the call and, with no `subagent_type` on the
call, took the vouch from the real agent, which was then dropped from the count.

## The card, laid out like the Claude app (2026-10-10)

From the user's screenshot of the Claude Android app's Background tasks sheet (dark):

- **The card** (`MobileBackgroundTaskCard.tsx`) is darker than the sheet (`bgSunken` on the
  drawer's `bgPanel`, in both themes), leads with the kind's glyph (a console for a shell, the
  hollow diamond for an agent, Activity for a monitor, ListTree for a workflow), puts the title in
  body text (two lines, then an ellipsis), and under it the kind and its live time ("Shell  41s",
  "Agent  13m 18s") or how it ended ("Shell  Completed", "Failed" in the danger tone).
- **Stop** (`MobileBackgroundTaskStopButton.tsx`): a round button at the card's top right, a circle
  outline holding a filled square in the muted foreground, about 24 dp, on a running card only,
  through the same per-task stop path. The workflow card uses the same button.
- **No "View transcript".** The link, and the tap on a card that opened a subagent's transcript
  (with the chevron on a finished one), were this fork's own addition and are gone at the user's
  request: Orca has neither. The run sheet's own transcript row (a run of Agent calls in the
  conversation) is a different surface and is unchanged.

## Stop all (2026-10-10)

The Running section's header carries a quiet "Stop all" at its right while at least one running
row takes a Stop and is not already stopping (`use-mobile-background-tasks-stop-all.ts`). Each task
goes through the same per-task stop as its own button, so the holds (Orca #26780) and the host's
answers are the ones a single press gets. More than one task is confirmed first (a system dialog,
"Stop N background tasks?", Cancel or Stop all); one task stops at once. A task whose Stop said why
it failed (a refusal, "Stop unconfirmed — check chat before retrying") is named on the sheet's
failure line, one line per task under "N of M tasks didn't stop."; a task the host answered with
nothing stopped and no words had already ended, and is not named. A row the host marks
`stoppable: false` and a finished row are never stopped. Upstream's strip offers its Stop all only
to a host with no per-row stop; this one is the user's own ask and works over the per-row stops.

## While the relay is down (2026-10-10)

With no connection to the desktop nothing on the sheet is current, so a running row does not keep
saying it runs: its time reads "Status unknown" (muted), it offers no Stop and the Running section
offers no Stop all (a Stop could not be sent), and the section says "Status unknown —
reconnecting". A finished row stays as it was: that is a fact already received. The connection is
the controller's `connState` and `useLastConnectedAt(hostId)`, handed down as
`nativeChatHostConnection` through the overlay, the view and the provider.

When the connection returns, the new `lastConnectedAt` re-reads the sheet at once, by itself: the
clock jumps to now (not the next tick) and every Stop hold from the old connection is let go, since
an answer for a Stop sent on a connection that is gone no longer holds a row
(`use-mobile-background-task-stops.ts`). The roster itself comes back on the lanes' own reconnect
paths (the structured subscribe re-attaches with a snapshot; the terminal lane re-reads its
transcript and the host status), so the sheet holds no load of its own that could fail and need
`shouldRefetchAfterReconnect`. Not changed: the status line's "N running tasks" count, which still
reads the last roster while disconnected.

